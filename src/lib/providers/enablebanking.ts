// Enable Banking (open banking, read-only account information under Enable Banking's licence).
// Plain fetch + Web Crypto (RS256 JWT), so it runs on Cloudflare Workers.
// Free "restricted production": real data, but only for bank accounts first linked in our own
// Enable Banking Control Panel. Full production for everyone needs a contract + company KYB.
import type { BankTx } from "../bank";

const BASE = "https://api.enablebanking.com";

export const enableBankingConfigured = () => Boolean(process.env.ENABLEBANKING_APP_ID && process.env.ENABLEBANKING_PRIVATE_KEY);

// ------------------------------------------------------------------ JWT (RS256)
const b64url = (bytes: Uint8Array | string) => {
  const u = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function derLength(n: number) {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
const der = (tag: number, body: Uint8Array) => new Uint8Array([tag, ...derLength(body.length), ...body]);

/** PEM (PKCS#8 "PRIVATE KEY" or PKCS#1 "RSA PRIVATE KEY") → PKCS#8 DER bytes. */
export function pemToPkcs8(pem: string) {
  const text = pem.replace(/\\n/g, "\n");
  const rsa = /BEGIN RSA PRIVATE KEY/.test(text);
  const body = text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  if (!rsa) return raw;
  // Wrap PKCS#1 in PKCS#8: SEQ { INT 0, SEQ { OID rsaEncryption, NULL }, OCTET STRING pkcs1 }
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algo = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const octet = der(0x04, raw);
  return der(0x30, new Uint8Array([...version, ...algo, ...octet]));
}

export async function makeJwt(appId: string, pem: string, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

export class EnableBankingError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const jwt = await makeJwt(process.env.ENABLEBANKING_APP_ID!, process.env.ENABLEBANKING_PRIVATE_KEY!);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new EnableBankingError(`Enable Banking ${method} ${path.split("?")[0]}: ${data.message || data.error || res.status}`, res.status);
  return data as T;
}

// ------------------------------------------------------------------ API
export type Aspsp = { name: string; country: string; logo?: string; maximum_consent_validity?: number; psu_types?: string[] };

export async function listBanks(country = "PT") {
  const r = await call<{ aspsps: Aspsp[] }>(`/aspsps?country=${country}`);
  return r.aspsps.sort((a, b) => a.name.localeCompare(b.name));
}

/** Starts the bank consent: returns the bank's login URL. */
export async function startAuth(p: { bank: Aspsp; redirectUrl: string; state: string; psuType: "business" | "personal"; now?: number }) {
  const now = p.now ?? Date.now();
  // 180 days, or less if the bank allows less (maximum_consent_validity is in seconds).
  const maxMs = Math.min(180 * 864e5, (p.bank.maximum_consent_validity ?? 180 * 86400) * 1000);
  const validUntil = new Date(now + maxMs - 60_000).toISOString();
  const r = await call<{ url: string }>("/auth", "POST", {
    access: { valid_until: validUntil },
    aspsp: { name: p.bank.name, country: p.bank.country },
    state: p.state,
    redirect_url: p.redirectUrl,
    psu_type: p.psuType,
  });
  return r.url;
}

export type EbSession = {
  session_id: string;
  accounts: { uid: string; account_id?: { iban?: string }; name?: string; currency?: string }[];
  aspsp?: { name: string; country: string };
  access?: { valid_until?: string };
};

export const createSession = (code: string) => call<EbSession>("/sessions", "POST", { code });
export const deleteSession = (id: string) => call<unknown>(`/sessions/${id}`, "DELETE").catch(() => null);

export type EbTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator?: "CRDT" | "DBIT";
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  debtor?: { name?: string } | null;
  remittance_information?: string[] | null;
  reference_number?: string | null;
  note?: string | null;
};

/** Booked incoming EUR payments of one account since dateFrom (YYYY-MM-DD). */
export async function incomingTransactions(accountUid: string, dateFrom: string, maxPages = 10) {
  const out: EbTransaction[] = [];
  let key: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (key) q.set("continuation_key", key);
    const r = await call<{ transactions: EbTransaction[]; continuation_key?: string | null }>(`/accounts/${accountUid}/transactions?${q}`);
    out.push(...(r.transactions ?? []));
    if (!r.continuation_key) break;
    key = r.continuation_key;
  }
  return out;
}

/** Enable Banking transaction → our row; null for debits, pending or non-EUR entries. */
export function mapTransaction(t: EbTransaction, accountUid: string): BankTx | null {
  if (t.credit_debit_indicator && t.credit_debit_indicator !== "CRDT") return null;
  if (t.status && t.status !== "BOOK") return null;
  if (t.transaction_amount?.currency && t.transaction_amount.currency !== "EUR") return null;
  const amount = Math.abs(Number(t.transaction_amount?.amount));
  const date = (t.booking_date || t.value_date || t.transaction_date || "").slice(0, 10);
  if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const description = [...(t.remittance_information ?? []), t.reference_number, t.note].filter(Boolean).join(" · ").slice(0, 500);
  const id = t.entry_reference || t.transaction_id || `${date}|${amount}|${description}`;
  return { externalId: `${accountUid}:${id}`.slice(0, 300), bookingDate: date, amount: Math.round(amount * 100) / 100, description, counterparty: t.debtor?.name ?? null };
}
