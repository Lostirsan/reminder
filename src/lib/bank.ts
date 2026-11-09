// Bank statement parsing and payment matching. Pure functions (no I/O): unit-tested, and shared by
// the CSV upload and the Enable Banking sync.

export type BankTx = {
  externalId: string;
  bookingDate: string; // YYYY-MM-DD
  amount: number;      // credits only, > 0
  description: string;
  counterparty: string | null;
};

export type OpenInvoice = { id: string; number: string; amount: number; customerName: string };

export type Match = { status: "matched" | "suggested" | "unmatched"; invoiceId: string | null };

// ------------------------------------------------------------------ helpers
const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Upper case, no accents, only letters and digits. */
export const compact = (s: string) => deaccent(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "1.234,56", "1,234.56", "-50,00 €", "+12.5" → number; null when it isn't a number. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s €]|EUR/gi, "");
  if (!s) return null;
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    s = s.split(dec === "," ? "." : ",").join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    // Portuguese decimal comma, unless it's clearly a thousands separator (1,234,567).
    s = /^\d{1,3}(,\d{3})+$/.test(s) && !/,\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // 1.234 → thousands separator (PT style)
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/** "31-10-2026", "31/10/2026 14:02", "2026-10-31T…", "31.10.26" → "2026-10-31". */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function iso(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Small stable hash (FNV-1a, 2×32 bit) for dedupe keys of uploaded rows. */
export function hashKey(s: string) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ------------------------------------------------------------------ CSV
/** Splits CSV text into rows, honouring quotes. Picks ';', ',' or tab, whichever fits best. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const sample = clean.split("\n").slice(0, 40).join("\n");
  const count = (ch: string) => sample.split(ch).length - 1;
  const delim = [";", "\t", ","].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

type Columns = { date: number; desc: number[]; amount?: number; credit?: number; debit?: number; party?: number };

const h = (s: string) => deaccent(s).toLowerCase().replace(/\s+/g, " ").trim();
function findColumns(header: string[]): Columns | null {
  const names = header.map(h);
  const idx = (re: RegExp, skip: number[] = []) => names.findIndex((n, i) => !skip.includes(i) && re.test(n));
  // Prefer the booking date over the value date when both exist.
  let date = idx(/^(data (de )?(mov|lanc|operac|contab)|data$|date$|booking date|started date|completed date|transaction date)/);
  if (date < 0) date = idx(/data|date/);
  if (date < 0) return null;
  const used = [date];
  const credit = idx(/^(credito|creditos|credit|entradas?|paid in|money in|recebimentos?)\b/, used);
  const debit = idx(/^(debito|debitos|debit|saidas?|paid out|money out|pagamentos?)\b/, used);
  const amount = idx(/^(montante|valor|importancia|amount|quantia)( |$|\()/, used);
  if (credit < 0 && amount < 0) return null;
  used.push(credit, debit, amount);
  const party = idx(/ordenante|contraparte|remetente|payer|counterparty|nome/, used);
  used.push(party);
  const desc = names.map((n, i) => (/descri|movimento|historico|detalhe|referencia|description|details|concept|narrative|reference|observa/.test(n) && !used.includes(i) && !/data|date|saldo|balance/.test(n) ? i : -1)).filter((i) => i >= 0);
  return { date, desc, credit: credit >= 0 ? credit : undefined, debit: debit >= 0 ? debit : undefined, amount: amount >= 0 ? amount : undefined, party: party >= 0 ? party : undefined };
}

/**
 * Reads a bank statement export (CSV from any Portuguese homebanking, Revolut, …) and returns the
 * incoming payments. Header row is found automatically; debits and unreadable rows are skipped.
 */
export function parseStatement(text: string): { txs: BankTx[]; error?: "no_header" | "no_rows" } {
  const rows = parseCsv(text);
  let cols: Columns | null = null, start = -1;
  for (let i = 0; i < Math.min(rows.length, 40) && !cols; i++) {
    cols = findColumns(rows[i]);
    if (cols) start = i + 1;
  }
  if (!cols) return { txs: [], error: "no_header" };
  const txs: BankTx[] = [];
  const seen = new Map<string, number>();
  for (const r of rows.slice(start)) {
    const date = parseDate(r[cols.date]);
    if (!date) continue;
    let amount: number | null = null;
    if (cols.credit !== undefined) {
      amount = parseAmount(r[cols.credit]);
      if (amount !== null) amount = Math.abs(amount);
    }
    if ((amount === null || amount === 0) && cols.amount !== undefined) amount = parseAmount(r[cols.amount]);
    if (amount === null || amount <= 0) continue;
    amount = Math.round(amount * 100) / 100;
    const description = cols.desc.map((i) => r[i]).filter(Boolean).join(" · ").slice(0, 500);
    const counterparty = cols.party !== undefined ? r[cols.party]?.slice(0, 200) || null : null;
    const base = `${date}|${amount.toFixed(2)}|${compact(description)}|${compact(counterparty ?? "")}`;
    const n = (seen.get(base) ?? 0) + 1; // two identical rows on one day are two payments
    seen.set(base, n);
    txs.push({ externalId: `csv:${hashKey(`${base}|${n}`)}`, bookingDate: date, amount, description, counterparty });
  }
  return txs.length ? { txs } : { txs, error: "no_rows" };
}

// ------------------------------------------------------------------ matching
/** Ways the invoice number may appear in a transfer description: "FT 2026/131" → FT2026131, 2026131. */
export function invoiceKeys(number: string) {
  const full = compact(number);
  const keys = new Set<string>();
  if (full.length >= 3) keys.add(full);
  const digits = number.replace(/^[^\d]*/, "");
  const d = compact(digits);
  if (d.length >= 4 && d !== full) keys.add(d);
  return [...keys];
}

/** True when key occurs in text and isn't part of a longer number (FT2026/13 vs FT2026/131). */
export function containsKey(text: string, key: string) {
  let from = 0;
  for (;;) {
    const i = text.indexOf(key, from);
    if (i < 0) return false;
    const after = text[i + key.length];
    const before = text[i - 1];
    const okAfter = after === undefined || !/\d/.test(after);
    const okBefore = !/^\d/.test(key) || before === undefined || !/\d/.test(before);
    if (okAfter && okBefore) return true;
    from = i + 1;
  }
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Pairs incoming payments with open invoices.
 * - invoice number in the description and the same amount → matched (the invoice closes itself);
 * - number but another amount, or the same amount only once among open invoices → suggested;
 * - otherwise unmatched. One invoice is used at most once per run.
 */
export function matchTransactions(txs: BankTx[], invoices: OpenInvoice[]): Match[] {
  const used = new Set<string>();
  const prepared = invoices.map((inv) => ({ inv, keys: invoiceKeys(inv.number), name: compact(inv.customerName) }));
  const firstPass = txs.map((tx) => {
    const text = compact(`${tx.description} ${tx.counterparty ?? ""}`);
    const byNumber = prepared.filter((p) => p.keys.some((k) => containsKey(text, k)));
    const exact = byNumber.find((p) => sameAmount(p.inv.amount, tx.amount));
    return { tx, text, byNumber, exact };
  });
  const out: Match[] = firstPass.map(() => ({ status: "unmatched", invoiceId: null }));
  // Exact matches first, so a weaker guess never takes an invoice an exact payment needs.
  firstPass.forEach((f, i) => {
    if (f.exact && !used.has(f.exact.inv.id)) { used.add(f.exact.inv.id); out[i] = { status: "matched", invoiceId: f.exact.inv.id }; }
  });
  firstPass.forEach((f, i) => {
    if (out[i].status !== "unmatched") return;
    const numbered = f.byNumber.find((p) => !used.has(p.inv.id));
    if (numbered) { used.add(numbered.inv.id); out[i] = { status: "suggested", invoiceId: numbered.inv.id }; return; }
    const sameAmt = prepared.filter((p) => !used.has(p.inv.id) && sameAmount(p.inv.amount, f.tx.amount));
    const pick = sameAmt.length === 1 ? sameAmt[0]
      : sameAmt.find((p) => nameTokens(p.name, f.text));
    if (pick) { used.add(pick.inv.id); out[i] = { status: "suggested", invoiceId: pick.inv.id }; }
  });
  return out;
}

/** Customer name appears in the payment text (whole compacted name, or its first long word). */
function nameTokens(name: string, text: string) {
  if (name.length >= 4 && text.includes(name)) return true;
  return false;
}

/** "PT50000201231234567890154" → "PT50 0002 0123 1234 5678 9015 4". */
export const formatIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

/** Normalizes and checks an IBAN (mod-97). Returns null when invalid. */
export function normalizeIban(raw: string | null | undefined) {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return null;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? s : null;
}
