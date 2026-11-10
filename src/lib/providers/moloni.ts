// Moloni API (https://www.moloni.pt/dev/). The company owner connects their account with OAuth
// (authorization code); we keep the tokens encrypted and read invoices and customers.
// MOLONI_CLIENT_ID / MOLONI_CLIENT_SECRET come from the Moloni developer area, where the
// redirect URL <APP_URL>/api/integrations/moloni/callback must be registered.

const BASE = "https://api.moloni.pt/v1";

export const moloniConfigured = () => Boolean(process.env.MOLONI_CLIENT_ID && process.env.MOLONI_CLIENT_SECRET);

export type MoloniCompany = { id: number; name: string; vat?: string };
/** companyId is unset until the owner picks one when the login has several companies. */
export type MoloniTokens = {
  access: string; refresh: string; exp: number;
  companyId?: number; companyName?: string; companies?: MoloniCompany[];
};

export function authorizeUrl(redirectUri: string, state: string) {
  const qs = new URLSearchParams({ response_type: "code", client_id: process.env.MOLONI_CLIENT_ID!, redirect_uri: redirectUri, state });
  return `${BASE}/authorize/?${qs}`;
}

async function grant(params: Record<string, string>): Promise<MoloniTokens> {
  const qs = new URLSearchParams({ client_id: process.env.MOLONI_CLIENT_ID!, client_secret: process.env.MOLONI_CLIENT_SECRET!, ...params });
  const res = await fetch(`${BASE}/grant/?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Moloni login failed: ${data.error_description || data.error || res.status}`);
  return { access: data.access_token, refresh: data.refresh_token, exp: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
}

export const exchangeCode = (code: string, redirectUri: string) =>
  grant({ grant_type: "authorization_code", code, redirect_uri: redirectUri });

/** A client bound to one company's tokens. `onRefresh` persists refreshed tokens. */
export function moloniClient(tokens: MoloniTokens, onRefresh: (t: MoloniTokens) => Promise<void>) {
  let t = tokens;
  async function token() {
    if (Date.now() < t.exp) return t.access;
    const fresh = await grant({ grant_type: "refresh_token", refresh_token: t.refresh });
    t = { ...t, ...fresh };
    await onRefresh(t);
    return t.access;
  }
  async function call<T>(endpoint: string, body: Record<string, string | number> = {}): Promise<T> {
    const res = await fetch(`${BASE}/${endpoint}/?access_token=${await token()}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data === null || (data && !Array.isArray(data) && data.error)) {
      throw new Error(`Moloni ${endpoint}: ${JSON.stringify(data)?.slice(0, 200) || res.status}`);
    }
    return data as T;
  }
  return {
    get tokens() { return t; },
    /** Every company this Moloni login can access (a login can hold several, e.g. the demo company). */
    async companies(): Promise<MoloniCompany[]> {
      const list = await call<{ company_id: number; name: string; vat?: string }[]>("companies/getAll");
      if (!Array.isArray(list) || !list.length) throw new Error("This Moloni login has no companies");
      return list.map((c) => ({ id: Number(c.company_id), name: c.name, vat: c.vat ? String(c.vat) : undefined }));
    },
    /** All finalised invoices (paid and unpaid), newest first, up to `max`. */
    async invoices(companyId: number, max = 500) {
      const out: MoloniInvoice[] = [];
      for (let offset = 0; offset < max; offset += 50) {
        const page = await call<MoloniInvoice[]>("invoices/getAll", { company_id: companyId, qty: 50, offset });
        if (!Array.isArray(page)) break;
        out.push(...page);
        if (page.length < 50) break;
      }
      return out;
    },
    customer(companyId: number, customerId: number) {
      return call<MoloniCustomer>("customers/getOne", { company_id: companyId, customer_id: customerId });
    },
  };
}

export type MoloniInvoice = {
  document_id: number;
  customer_id: number;
  number: number | string;
  document_set_name?: string;
  document_set?: { name?: string };
  entity_name?: string;
  date?: string;
  expiration_date?: string;
  net_value?: number | string;
  gross_value?: number | string;
  total_value?: number | string;
  reconciled_value?: number | string;
  status?: number | string;
};
export type MoloniCustomer = { customer_id: number; name: string; contact_name?: string; phone?: string; email?: string; contact_email?: string };

const num = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));

/** Normalises a Moloni invoice: open amount, due date, number. Skips drafts. */
export function mapInvoice(d: MoloniInvoice) {
  if (d.status !== undefined && Number(d.status) !== 1) return null; // only finalised documents
  const total = num(d.net_value ?? d.gross_value ?? d.total_value);
  const open = Math.round((total - num(d.reconciled_value)) * 100) / 100;
  return {
    externalId: String(d.document_id),
    customerExternalId: String(d.customer_id),
    customerName: d.entity_name || "Cliente",
    number: [d.document_set_name || d.document_set?.name, d.number].filter(Boolean).join(" ") || String(d.document_id),
    open,
    issueDate: (d.date || "").slice(0, 10) || null,
    dueDate: (d.expiration_date || d.date || "").slice(0, 10),
  };
}
