import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { containsKey, invoiceKeys, matchTransactions, normalizeIban, parseAmount, parseDate, parseStatement, type BankTx } from "@/lib/bank";
import { makeJwt, mapTransaction } from "@/lib/providers/enablebanking";
import { composeMessage } from "@/lib/reminders";

describe("amounts and dates", () => {
  it("reads Portuguese and English number formats", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("380,00 €")).toBe(380);
    expect(parseAmount("-50,5")).toBe(-50.5);
    expect(parseAmount("+12.30")).toBe(12.3);
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("reads dates", () => {
    expect(parseDate("31-10-2026")).toBe("2026-10-31");
    expect(parseDate("01/11/2026 14:02")).toBe("2026-11-01");
    expect(parseDate("2026-11-03T10:00:00")).toBe("2026-11-03");
    expect(parseDate("03.11.26")).toBe("2026-11-03");
    expect(parseDate("Saldo")).toBeNull();
  });
  it("validates IBANs", () => {
    expect(normalizeIban("pt50 0002 0123 1234 5678 9015 4")).toBe("PT50000201231234567890154");
    expect(normalizeIban("PT50000201231234567890155")).toBeNull();
  });
});

describe("statement parsing", () => {
  it("CGD/Millennium style: preamble lines, ';', separate debit/credit columns", () => {
    const csv = [
      "Consultar movimentos de contas",
      "Conta ;0123456789",
      "",
      "Data mov. ;Data valor ;Descrição ;Débito ;Crédito ;Saldo contabilístico ",
      "05-11-2026;05-11-2026;TRF DE TASCA DO RUI FT 2026/131;;380,00;1.500,00",
      "05-11-2026;05-11-2026;COMPRA CONTINENTE;23,45;;1.120,00",
      "06-11-2026;06-11-2026;MB WAY DE HELENA COSTA;;212,80;1.332,80",
    ].join("\n");
    const { txs, error } = parseStatement(csv);
    expect(error).toBeUndefined();
    expect(txs.map((t) => [t.bookingDate, t.amount, t.description])).toEqual([
      ["2026-11-05", 380, "TRF DE TASCA DO RUI FT 2026/131"],
      ["2026-11-06", 212.8, "MB WAY DE HELENA COSTA"],
    ]);
  });
  it("signed amount column (Revolut style, ',')", () => {
    const csv = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n" +
      "TRANSFER,Current,2026-11-04 10:00:00,2026-11-04 10:01:00,Payment from Hotel Rio Azul,1240.50,0.00,EUR,COMPLETED,2000\n" +
      "CARD_PAYMENT,Current,2026-11-04 12:00:00,2026-11-04 12:01:00,Lidl,-10.00,0.00,EUR,COMPLETED,1990\n";
    const { txs } = parseStatement(csv);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ bookingDate: "2026-11-04", amount: 1240.5, description: "Payment from Hotel Rio Azul" });
  });
  it("stable dedupe ids, but two identical payments on one day stay two", () => {
    const csv = "Data;Descrição;Montante\n01-11-2026;TRF X;10,00\n01-11-2026;TRF X;10,00\n";
    const a = parseStatement(csv).txs, b = parseStatement(csv).txs;
    expect(a.map((t) => t.externalId)).toEqual(b.map((t) => t.externalId));
    expect(new Set(a.map((t) => t.externalId)).size).toBe(2);
  });
  it("reports files without a header", () => {
    expect(parseStatement("hello;world\n1;2").error).toBe("no_header");
  });
});

describe("matching", () => {
  const inv = (id: string, number: string, amount: number, customerName = "Cliente") => ({ id, number, amount, customerName });
  const tx = (amount: number, description: string, counterparty: string | null = null): BankTx =>
    ({ externalId: description, bookingDate: "2026-11-05", amount, description, counterparty });

  it("finds invoice numbers in many spellings, not inside longer numbers", () => {
    expect(invoiceKeys("FT 2026/131")).toEqual(["FT2026131", "2026131"]);
    expect(containsKey("TRFFT2026131TASCA", "FT2026131")).toBe(true);
    expect(containsKey("PAGAMENTO2026131", "2026131")).toBe(true);
    expect(containsKey("FT20261310", "FT2026131")).toBe(false);
    expect(containsKey("12026131", "2026131")).toBe(false);
  });
  it("number + amount → matched; number only → suggested; amount only once → suggested", () => {
    const invoices = [inv("a", "FT 2026/131", 380), inv("b", "FT 2026/118", 1240.5), inv("c", "FT 2026/109", 96.4), inv("d", "FT 2026/097", 50)];
    const r = matchTransactions([
      tx(380, "TRF FT 2026/131"),
      tx(600, "pagamento parcial 2026/118"),
      tx(96.4, "TRANSFERENCIA"),
      tx(12, "nada"),
    ], invoices);
    expect(r).toEqual([
      { status: "matched", invoiceId: "a" },
      { status: "suggested", invoiceId: "b" },
      { status: "suggested", invoiceId: "c" },
      { status: "unmatched", invoiceId: null },
    ]);
  });
  it("same amount on two invoices: uses the customer name, else leaves it", () => {
    const invoices = [inv("a", "FT 1", 100, "Tasca do Rui"), inv("b", "FT 2", 100, "Café Arcada")];
    expect(matchTransactions([tx(100, "MB WAY", "CAFE ARCADA LDA")], invoices)).toEqual([{ status: "suggested", invoiceId: "b" }]);
    expect(matchTransactions([tx(100, "MB WAY", "JOAO")], invoices)).toEqual([{ status: "unmatched", invoiceId: null }]);
  });
  it("one invoice is never used twice; exact matches win", () => {
    const invoices = [inv("a", "FT 2026/131", 380)];
    const r = matchTransactions([tx(380, "transferencia"), tx(380, "FT 2026/131")], invoices);
    expect(r).toEqual([{ status: "unmatched", invoiceId: null }, { status: "matched", invoiceId: "a" }]);
  });
});

describe("enable banking", () => {
  it("signs an RS256 JWT that verifies with the public key (PKCS#8 and PKCS#1 PEM)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    for (const type of ["pkcs8", "pkcs1"] as const) {
      const pem = privateKey.export({ type, format: "pem" }) as string;
      const jwt = await makeJwt("app-123", pem.replace(/\n/g, "\\n"), 1_800_000_000);
      const [h, p, s] = jwt.split(".");
      expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-123" });
      expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ iss: "enablebanking.com", aud: "api.enablebanking.com", exp: 1_800_003_600 });
      expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
    }
  });
  it("maps only booked EUR credits", () => {
    const base = { transaction_amount: { amount: "380.00", currency: "EUR" }, credit_debit_indicator: "CRDT" as const, status: "BOOK", booking_date: "2026-11-05", entry_reference: "E1", remittance_information: ["FT 2026/131"], debtor: { name: "Tasca do Rui" } };
    expect(mapTransaction(base, "acc")).toEqual({ externalId: "acc:E1", bookingDate: "2026-11-05", amount: 380, description: "FT 2026/131", counterparty: "Tasca do Rui" });
    expect(mapTransaction({ ...base, credit_debit_indicator: "DBIT" }, "acc")).toBeNull();
    expect(mapTransaction({ ...base, status: "PDNG" }, "acc")).toBeNull();
    expect(mapTransaction({ ...base, transaction_amount: { amount: "1", currency: "USD" } }, "acc")).toBeNull();
  });
});

describe("reminder text without online payment", () => {
  const base = {
    contactName: "Rui", invoiceNumber: "FT 2026/131", amount: 380, dueDate: "2026-11-01", days: 4,
    payUrl: "https://app.example/pay/abc", senderName: "Distribuidora", mentionInterest: true, interestRate: 10.4,
  };
  it("puts IBAN, MB WAY and the invoice number in the text", () => {
    const m = composeMessage({ ...base, locale: "pt", step: "d1", online: false, transfer: { iban: "PT50000201231234567890154", mbwayPhone: "351912345678" } });
    expect(m.text).toContain("IBAN PT50 0002 0123 1234 5678 9015 4");
    expect(m.text).toContain("MB WAY para 912 345 678");
    expect(m.text).toContain("Na descrição indique: FT 2026/131");
    expect(m.text).toContain("https://app.example/pay/abc");
    expect(m.text).not.toContain("Pagar com MB WAY ou Multibanco");
  });
  it("keeps the Stripe line when online payment exists", () => {
    const m = composeMessage({ ...base, locale: "en", step: "d1" });
    expect(m.text).toContain("Pay with MB WAY or Multibanco: https://app.example/pay/abc");
  });
});
