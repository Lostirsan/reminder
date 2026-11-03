import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autoStepFor, daysLate, inSendWindow, STEP_ORDER, todayIn } from "./reminders";
import { sendReminder, SendError } from "./send";
import { syncMoloni } from "./sync";
import type { Customer, Invoice, Organization, Step } from "./types";

const MIN_GAP_MS = 3 * 864e5; // at least 3 days between two different reminder steps
const MAX_PER_ORG = 40;        // per tick, to stay well inside a Worker request

type Sent = { invoice_id: string; step: Step; created_at: string };

/** Decides which reminder each open invoice needs now. Pure: tested without a database. */
export function planReminders(org: Organization, invoices: (Invoice & { customer: Customer })[], sent: Sent[], now = new Date()) {
  const today = todayIn(org.timezone, now);
  const byInvoice = new Map<string, Sent[]>();
  for (const s of sent) if (s.step !== "thanks") (byInvoice.get(s.invoice_id) ?? byInvoice.set(s.invoice_id, []).get(s.invoice_id)!).push(s);
  const plan: { invoice: Invoice & { customer: Customer }; step: Step; channels: ("whatsapp" | "email")[] }[] = [];
  for (const inv of invoices) {
    if (inv.status !== "open") continue;
    const step = autoStepFor(daysLate(inv.due_date, today));
    if (!step) continue;
    const history = byInvoice.get(inv.id) ?? [];
    // Never go back down the ladder, and never repeat a step already sent (manual or auto).
    if (history.some((h) => STEP_ORDER.indexOf(h.step) >= STEP_ORDER.indexOf(step))) continue;
    if (history.some((h) => now.getTime() - Date.parse(h.created_at) < MIN_GAP_MS)) continue;
    const channels: ("whatsapp" | "email")[] = [];
    if (org.channel_whatsapp && inv.customer.phone && inv.customer.whatsapp_opt_in) channels.push("whatsapp");
    if (org.channel_email && inv.customer.email) channels.push("email");
    if (channels.length) plan.push({ invoice: inv, step, channels });
  }
  return plan;
}

export async function runTick(db: SupabaseClient, now = new Date()) {
  const report = { synced: 0, syncErrors: 0, sent: 0, failed: 0, skippedOrgs: 0 };

  // 1. Pull fresh invoices from connected invoicing software.
  const { data: integrations } = await db.from("integrations").select("organization_id, provider").neq("status", "disconnected");
  for (const i of integrations ?? []) {
    if (i.provider !== "moloni") continue;
    try { await syncMoloni(db, i.organization_id); report.synced++; } catch { report.syncErrors++; }
  }

  // 2. Send due reminders for companies with automatic reminders on, in business hours.
  const { data: orgs } = await db.from("organizations").select("*").eq("auto_reminders", true);
  for (const org of (orgs ?? []) as Organization[]) {
    if (!inSendWindow(org.timezone, now)) { report.skippedOrgs++; continue; }
    const { data: invoices } = await db.from("invoices").select("*, customer:customers(*)").eq("organization_id", org.id).eq("status", "open");
    if (!invoices?.length) continue;
    const { data: sent } = await db.from("messages").select("invoice_id, step, created_at")
      .eq("organization_id", org.id).in("invoice_id", invoices.map((i) => i.id)).neq("status", "failed");
    const plan = planReminders(org, invoices as (Invoice & { customer: Customer })[], (sent ?? []) as Sent[], now).slice(0, MAX_PER_ORG);
    for (const p of plan) {
      const { customer, ...invoice } = p.invoice;
      for (const channel of p.channels) {
        try {
          const r = await sendReminder(db, { org, invoice: invoice as Invoice, customer }, channel, { step: p.step, trigger: "auto" });
          if (r?.status === "failed") report.failed++;
          else if (r) report.sent++;
        } catch (e) {
          if (!(e instanceof SendError)) report.failed++;
        }
      }
    }
  }
  return report;
}
