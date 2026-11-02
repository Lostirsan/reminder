// Moloni API client (https://www.moloni.pt/dev/). Uses the OAuth "password" grant,
// which Moloni allows for a developer's own account. Read-only: lists invoices and customers.
import { config } from "./config.js";

const BASE = "https://api.moloni.pt/v1";
let token = null; // { access, refresh, exp }

async function grant(params) {
  const qs = new URLSearchParams({
    client_id: config.moloni.developerId,
    client_secret: config.moloni.clientSecret,
    ...params,
  });
  const res = await fetch(`${BASE}/grant/?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Moloni login failed: ${data.error_description || data.error || res.status}`);
  }
  token = { access: data.access_token, refresh: data.refresh_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
}

async function accessToken() {
  if (token && Date.now() < token.exp) return token.access;
  if (token?.refresh) {
    try { await grant({ grant_type: "refresh_token", refresh_token: token.refresh }); return token.access; } catch { /* fall back to password */ }
  }
  await grant({ grant_type: "password", username: config.moloni.username, password: config.moloni.password });
  return token.access;
}

async function call(endpoint, body = {}) {
  const res = await fetch(`${BASE}/${endpoint}/?access_token=${await accessToken()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null || (data && data.error)) {
    throw new Error(`Moloni ${endpoint} failed: ${JSON.stringify(data)?.slice(0, 300) || res.status}`);
  }
  return data;
}

let companyId = null;
async function company() {
  if (companyId) return companyId;
  if (config.moloni.companyId) return (companyId = config.moloni.companyId);
  const list = await call("companies/getAll");
  if (!Array.isArray(list) || !list.length) throw new Error("Moloni: this login has no companies. Ask apoio@moloni.pt for demo company access.");
  companyId = list[0].company_id;
  return companyId;
}

const num = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));

export async function listOpenInvoices() {
  const cid = await company();
  const docs = await call("invoices/getAll", { company_id: cid, qty: 50, offset: 0 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const out = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    const total = num(d.net_value ?? d.gross_value ?? d.total_value);
    const paid = num(d.reconciled_value);
    const open = Math.round((total - paid) * 100) / 100;
    if (open <= 0.01) continue;
    if (d.status !== undefined && Number(d.status) !== 1) continue; // only finalised documents
    const due = new Date(d.expiration_date || d.date);
    out.push({
      id: `moloni-${d.document_id}`,
      source: "moloni",
      documentId: d.document_id,
      customerId: d.customer_id,
      number: [d.document_set_name || d.document_set?.name, d.number].filter(Boolean).join(" "),
      client: d.entity_name || "Cliente",
      contact: "",
      phone: "",
      amount: open,
      dueDate: due.toISOString().slice(0, 10),
      daysLate: Math.round((today - due) / 864e5),
    });
  }
  // Enrich with customer contact (phone/contact name). Errors here are non-fatal.
  await Promise.all(out.map(async (inv) => {
    try {
      const c = await call("customers/getOne", { company_id: cid, customer_id: inv.customerId });
      inv.contact = c.contact_name || "";
      inv.phone = c.phone || "";
    } catch { /* keep defaults */ }
  }));
  return out.sort((a, b) => b.daysLate - a.daysLate);
}
