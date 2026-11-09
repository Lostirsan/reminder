import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "./crypto";
import { matchTransactions, type BankTx, type OpenInvoice } from "./bank";
import { eur, todayIn } from "./reminders";
import { loadBundle, logActivity, markPaid } from "./send";
import * as eb from "./providers/enablebanking";

export type BankSecret = { sessionId: string; accounts: string[]; bank: string; validUntil?: string };

export async function saveBankSecret(db: SupabaseClient, orgId: string, s: BankSecret) {
  await db.from("integration_secrets").upsert({
    organization_id: orgId, provider: "enablebanking", ciphertext: await encryptJson(s), updated_at: new Date().toISOString(),
  });
}

/** Stores new incoming payments (duplicates are skipped) and returns how many were new. */
export async function storeTransactions(db: SupabaseClient, orgId: string, source: "upload" | "enablebanking", txs: BankTx[]) {
  if (!txs.length) return 0;
  const rows = txs.map((t) => ({
    organization_id: orgId, source, external_id: t.externalId, booking_date: t.bookingDate,
    amount: t.amount, description: t.description, counterparty: t.counterparty,
  }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await db.from("bank_transactions")
      .upsert(rows.slice(i, i + 200), { onConflict: "organization_id,source,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    added += data?.length ?? 0;
  }
  return added;
}

/**
 * Matches unmatched incoming payments of the last 120 days against open invoices. Exact matches
 * (number + amount) close the invoice and stop reminders; the rest wait for the owner.
 */
export async function reconcile(db: SupabaseClient, orgId: string) {
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const [{ data: txRows }, { data: invRows }] = await Promise.all([
    db.from("bank_transactions").select("*").eq("organization_id", orgId).eq("match_status", "unmatched").gte("booking_date", since).order("booking_date"),
    db.from("invoices").select("id, number, amount, customer:customers(name)").eq("organization_id", orgId).in("status", ["open", "paused"]),
  ]);
  const counts = { matched: 0, suggested: 0 };
  if (!txRows?.length || !invRows?.length) return counts;
  // Invoices already suggested for another payment wait for the owner's answer.
  const { data: pending } = await db.from("bank_transactions").select("invoice_id").eq("organization_id", orgId).eq("match_status", "suggested");
  const busy = new Set((pending ?? []).map((p) => p.invoice_id as string));
  const invoices: OpenInvoice[] = invRows
    .filter((i) => !busy.has(i.id as string))
    .map((i) => ({ id: i.id as string, number: i.number as string, amount: Number(i.amount), customerName: (i.customer as unknown as { name: string } | null)?.name ?? "" }));
  const txs: (BankTx & { id: string })[] = txRows.map((t) => ({
    id: t.id, externalId: t.external_id, bookingDate: t.booking_date, amount: Number(t.amount), description: t.description, counterparty: t.counterparty,
  }));
  const matches = matchTransactions(txs, invoices);
  for (const [i, m] of matches.entries()) {
    if (m.status === "unmatched" || !m.invoiceId) continue;
    const tx = txs[i];
    await db.from("bank_transactions").update({ match_status: m.status, invoice_id: m.invoiceId }).eq("id", tx.id);
    if (m.status === "matched") {
      const b = await loadBundle(db, orgId, m.invoiceId);
      if (b && (await markPaid(db, b, `Found in bank: ${tx.bookingDate} · ${eur(tx.amount)} · ${tx.description || tx.counterparty || ""}`.trim()))) counts.matched++;
    } else {
      await logActivity(db, orgId, m.invoiceId, "bank", `Possible payment in bank: ${tx.bookingDate} · ${eur(tx.amount)} · ${tx.counterparty || tx.description}. Confirm it on the Bank page.`);
      counts.suggested++;
    }
  }
  return counts;
}

/** Owner's answer to a suggested match: confirm closes the invoice; reject leaves the payment unlinked. */
export async function answerSuggestion(db: SupabaseClient, orgId: string, txId: string, confirm: boolean) {
  const { data: tx } = await db.from("bank_transactions").select("*").eq("organization_id", orgId).eq("id", txId).maybeSingle();
  if (!tx || tx.match_status !== "suggested" || !tx.invoice_id) return false;
  if (confirm) {
    await db.from("bank_transactions").update({ match_status: "confirmed" }).eq("id", tx.id);
    const b = await loadBundle(db, orgId, tx.invoice_id);
    if (b) await markPaid(db, b, `Bank payment confirmed: ${tx.booking_date} · ${eur(Number(tx.amount))}`);
  } else {
    await db.from("bank_transactions").update({ match_status: "ignored", invoice_id: null }).eq("id", tx.id);
  }
  return true;
}

const SYNC_EVERY_MS = 6 * 3600e3; // banks allow ~4 unattended reads a day (PSD2)

/** Reads new incoming payments from the connected bank, then reconciles. */
export async function syncBank(db: SupabaseClient, orgId: string, opts: { force?: boolean } = {}) {
  const { data: integ } = await db.from("integrations").select("*").eq("organization_id", orgId).eq("provider", "enablebanking").maybeSingle();
  if (!integ) throw new Error("Bank is not connected");
  // After an error (e.g. consent expired) wait for the owner: reconnect or "Sincronizar".
  if (!opts.force && integ.status === "error") return null;
  if (!opts.force && integ.last_sync_at && Date.now() - Date.parse(integ.last_sync_at) < SYNC_EVERY_MS) return null;
  const { data: secret } = await db.from("integration_secrets").select("ciphertext").eq("organization_id", orgId).eq("provider", "enablebanking").maybeSingle();
  if (!secret) throw new Error("Bank is not connected");
  const s = await decryptJson<BankSecret>(secret.ciphertext);
  try {
    if (s.validUntil && Date.parse(s.validUntil) < Date.now()) throw new Error("consent_expired");
    const last = integ.last_sync_at ? Date.parse(integ.last_sync_at) - 5 * 864e5 : Date.now() - 60 * 864e5;
    const from = todayIn("Europe/Lisbon", new Date(Math.max(last, Date.now() - 90 * 864e5)));
    const txs: BankTx[] = [];
    for (const uid of s.accounts) {
      for (const t of await eb.incomingTransactions(uid, from)) {
        const m = eb.mapTransaction(t, uid);
        if (m) txs.push(m);
      }
    }
    const added = await storeTransactions(db, orgId, "enablebanking", txs);
    const r = await reconcile(db, orgId);
    await db.from("integrations").update({ status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
      .eq("organization_id", orgId).eq("provider", "enablebanking");
    if (added) await logActivity(db, orgId, null, "bank", `Bank: ${added} new incoming payments, ${r.matched} invoices paid, ${r.suggested} to confirm`);
    return { added, ...r };
  } catch (e) {
    const expired = (e as Error).message === "consent_expired" || (e instanceof eb.EnableBankingError && (e.status === 401 || e.status === 403));
    await db.from("integrations").update({ status: "error", last_error: expired ? "consent_expired" : (e as Error).message.slice(0, 300) })
      .eq("organization_id", orgId).eq("provider", "enablebanking");
    throw e;
  }
}
