import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "./crypto";
import { contactOf, mapInvoice, moloniClient, type MoloniInvoice, type MoloniTokens } from "./providers/moloni";

const DETAIL_BUDGET = 20;
const CONTACT_BUDGET = 5;
import { loadBundle, logActivity, markPaid } from "./send";

export async function saveMoloniTokens(db: SupabaseClient, orgId: string, t: MoloniTokens) {
  await db.from("integration_secrets").upsert({
    organization_id: orgId, provider: "moloni", ciphertext: await encryptJson(t), updated_at: new Date().toISOString(),
  });
}

/** Decrypted Moloni tokens of an organisation, or null when it is not connected. */
export async function loadMoloniTokens(db: SupabaseClient, orgId: string) {
  const { data } = await db.from("integration_secrets").select("ciphertext").eq("organization_id", orgId).eq("provider", "moloni").maybeSingle();
  return data ? decryptJson<MoloniTokens>(data.ciphertext) : null;
}

/** Pulls invoices from Moloni into the database: new unpaid ones are added, paid ones are closed. */
export async function syncMoloni(db: SupabaseClient, orgId: string) {
  const tokens = await loadMoloniTokens(db, orgId);
  if (!tokens) throw new Error("Moloni is not connected");
  const companyId = tokens.companyId;
  if (!companyId) throw new Error("Choose which Moloni company to sync"); // picker pending: not an error state
  const client = moloniClient(tokens, (t) => saveMoloniTokens(db, orgId, t));
  const counts = { added: 0, updated: 0, paid: 0 };
  try {
    // invoices/getAll has no reconciled_value, so without getOne every invoice would look unpaid forever.
    // Workers allow few subrequests per run: fetch at most DETAIL_BUDGET details, newest first; the rest
    // are picked up by the next sync (every 15 minutes).
    const list = (await client.invoices(companyId)).filter((d) => d.status === undefined || Number(d.status) === 1);
    const full: MoloniInvoice[] = [];
    let budget = DETAIL_BUDGET;
    for (const d of list) {
      if (d.reconciled_value !== undefined) full.push(d);
      else if (budget-- > 0) full.push({ ...d, ...(await client.invoice(companyId, d.document_id)) });
    }
    const docs = full.map(mapInvoice).filter((d): d is NonNullable<typeof d> => Boolean(d && d.dueDate));

    const [{ data: existing }, { data: customers }] = await Promise.all([
      db.from("invoices").select("id, external_id, status, amount, due_date").eq("organization_id", orgId).eq("source", "moloni"),
      db.from("customers").select("id, external_id, contacts_custom, contacts_checked_at").eq("organization_id", orgId).eq("source", "moloni"),
    ]);
    const invByExt = new Map((existing ?? []).map((i) => [i.external_id as string, i]));
    const custByExt = new Map((customers ?? []).map((c) => [c.external_id as string, c.id as string]));

    for (const d of docs) {
      const inv = invByExt.get(d.externalId);
      if (d.open > 0.01) {
        if (inv) {
          if (Number(inv.amount) !== d.open || inv.due_date !== d.dueDate) {
            await db.from("invoices").update({ amount: d.open, due_date: d.dueDate }).eq("id", inv.id);
            counts.updated++;
          }
          continue;
        }
        let customerId = custByExt.get(d.customerExternalId);
        if (!customerId) {
          const c = await client.customer(companyId, Number(d.customerExternalId)).catch(() => null);
          const { data: row, error } = await db.from("customers").insert({
            organization_id: orgId, source: "moloni", external_id: d.customerExternalId,
            name: c?.name || d.customerName, ...(c ? contactOf(c) : {}),
            contacts_checked_at: c ? new Date().toISOString() : null,
          }).select("id").single();
          if (error) throw error;
          customerId = row.id as string;
          custByExt.set(d.customerExternalId, customerId);
        }
        const { error } = await db.from("invoices").insert({
          organization_id: orgId, customer_id: customerId, source: "moloni", external_id: d.externalId,
          number: d.number, amount: d.open, issue_date: d.issueDate, due_date: d.dueDate,
        });
        if (error) throw error;
        counts.added++;
      } else if (inv && (inv.status === "open" || inv.status === "paused")) {
        const b = await loadBundle(db, orgId, inv.id);
        if (b && (await markPaid(db, b, "Paid in Moloni"))) counts.paid++;
      }
    }
    // Customers without own contacts follow Moloni: refresh those with open invoices, least recently
    // checked first (a few per run because of the Workers subrequest limit).
    const openCustomers = new Set(docs.filter((d) => d.open > 0.01).map((d) => d.customerExternalId));
    const due = (customers ?? [])
      .filter((c) => !c.contacts_custom && openCustomers.has(c.external_id as string))
      .sort((a, b) => String(a.contacts_checked_at ?? "").localeCompare(String(b.contacts_checked_at ?? "")))
      .slice(0, CONTACT_BUDGET);
    for (const c of due) {
      const m = await client.customer(companyId, Number(c.external_id)).catch(() => null);
      if (!m) continue;
      await db.from("customers").update({ ...contactOf(m), contacts_checked_at: new Date().toISOString() })
        .eq("id", c.id).eq("contacts_custom", false);
    }
    await db.from("integrations").update({ status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
      .eq("organization_id", orgId).eq("provider", "moloni");
    if (counts.added || counts.paid) await logActivity(db, orgId, null, "sync", `Moloni: +${counts.added} new, ${counts.paid} paid, ${counts.updated} updated`);
    return counts;
  } catch (e) {
    await db.from("integrations").update({ status: "error", last_error: (e as Error).message.slice(0, 300) })
      .eq("organization_id", orgId).eq("provider", "moloni");
    throw e;
  }
}
