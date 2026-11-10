import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { fromHeader, renderEmailHtml } from "@/lib/email";
import { mapEvent, verifyWebhook } from "@/lib/providers/resend";
import { composeMessage } from "@/lib/reminders";

const base = {
  locale: "pt" as const, contactName: "Rui <Silva>", invoiceNumber: "FT 2026/7", amount: 250,
  dueDate: "2026-11-01", days: 2, payUrl: "https://app.example/pay/abc", senderName: "Café & Cia",
  mentionInterest: false, interestRate: 10.4,
};

describe("reminder email html", () => {
  it("escapes names, turns the pay link into a button and keeps the footer polite", () => {
    const msg = composeMessage({ ...base, step: "d1", online: true });
    const html = renderEmailHtml({ text: msg.text, payUrl: base.payUrl, step: "d1", locale: "pt", senderName: base.senderName, replyTo: "dono@cafe.pt" });
    expect(html).toContain("Rui &lt;Silva&gt;");
    expect(html).not.toContain("<Silva>");
    expect(html).toContain('href="https://app.example/pay/abc"');
    expect(html).toContain(">Pagar com MB WAY ou Multibanco</a>");
    expect(html).toContain("Se já efetuou o pagamento");
    expect(html).toContain("dono@cafe.pt");
    expect(html).toContain("Café &amp; Cia");
    expect(html).not.toMatch(/juros|indemniza/);
  });
  it("transfer-only invoices show the IBAN and a details button", () => {
    const msg = composeMessage({ ...base, step: "d5", online: false, transfer: { iban: "PT50000201231234567890154", mbwayPhone: null } });
    const html = renderEmailHtml({ text: msg.text, payUrl: base.payUrl, step: "d5", locale: "pt", senderName: "S" });
    expect(html).toContain("PT50 0002 0123 1234 5678 9015 4");
    expect(html).toContain(">Detalhes e &quot;Já paguei&quot;</a>");
  });
  it("thank-you has no pay button or 'already paid' footer", () => {
    const msg = composeMessage({ ...base, step: "thanks" });
    const html = renderEmailHtml({ text: msg.text, payUrl: base.payUrl, step: "thanks", locale: "pt", senderName: "S" });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Se já efetuou");
  });
  it("uses the supplier's name with the configured address", () => {
    expect(fromHeader('Padaria "Sol"', "Pago a Tempo <lembretes@pagoatempo.pt>")).toBe('"Padaria Sol" <lembretes@pagoatempo.pt>');
    expect(fromHeader("X", "lembretes@pagoatempo.pt")).toBe('"X" <lembretes@pagoatempo.pt>');
  });
});

describe("resend webhook", () => {
  const key = Buffer.from("0123456789abcdef0123456789abcdef");
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "e1" } });
  const ts = "1800000000";
  const sig = createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64");
  it("accepts a valid Svix signature, also among several", async () => {
    expect(await verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, 300, 1_800_000_000_000)).toBe(true);
    expect(await verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,bad v1,${sig}` }, secret, 300, 1_800_000_000_000)).toBe(true);
  });
  it("rejects tampering, wrong id, old timestamps and missing secret", async () => {
    const h = { id: "msg_1", timestamp: ts, signature: `v1,${sig}` };
    expect(await verifyWebhook(body + " ", h, secret, 300, 1_800_000_000_000)).toBe(false);
    expect(await verifyWebhook(body, { ...h, id: "msg_2" }, secret, 300, 1_800_000_000_000)).toBe(false);
    expect(await verifyWebhook(body, h, secret, 300, 1_800_001_000_000)).toBe(false);
    expect(await verifyWebhook(body, h, "", 300, 1_800_000_000_000)).toBe(false);
  });
  it("maps events", () => {
    expect(mapEvent("email.delivered")).toBe("delivered");
    expect(mapEvent("email.bounced")).toBe("failed");
    expect(mapEvent("email.complained")).toBe("failed");
    expect(mapEvent("email.sent")).toBeNull();
  });
});
