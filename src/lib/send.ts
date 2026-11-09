import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { composeMessage, daysLate, normalizePhone, stepFor, todayIn } from "./reminders";
import type { Channel, Customer, Invoice, Organization, Step } from "./types";
import * as twilio from "./providers/twilio";
import * as meta from "./providers/meta";
import * as resend from "./providers/resend";
import { stripeConfigured } from "./providers/stripe";

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
export const payUrl = (inv: Pick<Invoice, "pay_token">) => `${appUrl()}/pay/${inv.pay_token}`;

export type Bundle = { org: Organization; invoice: Invoice; customer: Customer };

/** Loads an invoice with its customer and organization, scoped to the organization. */
export async function loadBundle(db: SupabaseClient, orgId: string, invoiceId: string): Promise<Bundle | null> {
  const { data } = await db
    .from("invoices")
    .select("*, customer:customers(*), org:organizations(*)")
    .eq("organization_id", orgId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!data) return null;
  const { customer, org, ...invoice } = data as Invoice & { customer: Customer; org: Organization };
  return { org, invoice, customer };
}

export async function logActivity(db: SupabaseClient, orgId: string, invoiceId: string | null, kind: string, detail: string) {
  await db.from("activity").insert({ organization_id: orgId, invoice_id: invoiceId, kind, detail: detail.slice(0, 500) });
}

export function whatsappProvider() {
  if (twilio.twilioConfigured()) return "twilio" as const;
  if (meta.metaConfigured()) return "meta" as const;
  return null;
}

export function composeFor(b: Bundle, step?: Step) {
  const today = todayIn(b.org.timezone);
  const days = daysLate(b.invoice.due_date, today);
  const s = step ?? stepFor(days);
  return {
    step: s,
    days,
    ...composeMessage({
      locale: b.customer.locale,
      step: s,
      contactName: b.customer.contact_name || b.customer.name,
      invoiceNumber: b.invoice.number,
      amount: Number(b.invoice.amount),
      dueDate: b.invoice.due_date,
      days,
      payUrl: payUrl(b.invoice),
      senderName: b.org.sender_name,
      mentionInterest: b.org.mention_interest,
      interestRate: Number(b.org.late_interest_rate),
      online: stripeConfigured(),
      transfer: b.org.iban ? { iban: b.org.iban, mbwayPhone: b.org.mbway_phone } : null,
    }),
  };
}

export class SendError extends Error {}

/**
 * Sends one reminder and records it. Auto sends are claimed once per (invoice, step, channel):
 * returns null when another run already claimed it. Without a configured provider the message
 * is recorded as "simulated", so the app is usable in a demo.
 */
export async function sendReminder(
  db: SupabaseClient,
  b: Bundle,
  channel: Exclude<Channel, "walink">,
  opts: { step?: Step; trigger?: "manual" | "auto" } = {},
) {
  const trigger = opts.trigger ?? "manual";
  const msg = composeFor(b, opts.step);
  let recipient: string | null;
  if (channel === "whatsapp") {
    recipient = normalizePhone(b.customer.phone);
    if (!recipient) throw new SendError("no_phone");
    if (!b.customer.whatsapp_opt_in) throw new SendError("no_optin");
    recipient = normalizePhone(process.env.WHATSAPP_TEST_RECIPIENT) || recipient;
  } else {
    recipient = b.customer.email?.trim() || null;
    if (!recipient) throw new SendError("no_email");
    recipient = process.env.EMAIL_TEST_RECIPIENT?.trim() || recipient;
  }
  const provider = channel === "whatsapp" ? whatsappProvider() : resend.resendConfigured() ? "resend" : null;

  const { data: row, error } = await db
    .from("messages")
    .insert({
      organization_id: b.org.id,
      invoice_id: b.invoice.id,
      channel,
      step: msg.step,
      trigger,
      status: "queued",
      provider,
      recipient,
      body: channel === "email" ? `${msg.subject}\n\n${msg.text}` : msg.text,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // already claimed by an earlier run
    throw error;
  }

  let status: "sent" | "failed" | "simulated" = "simulated";
  let providerId: string | null = null;
  let err: string | null = null;
  try {
    if (provider === "twilio") providerId = await twilio.sendWhatsApp(recipient, msg.text, msg.params, `${appUrl()}/api/webhooks/twilio`);
    else if (provider === "meta") providerId = await meta.sendWhatsApp(recipient, msg.text, msg.params);
    else if (provider === "resend") providerId = await resend.sendEmail(recipient, msg.subject, msg.text);
    if (provider) status = "sent";
  } catch (e) {
    status = "failed";
    err = (e as Error).message;
  }
  await db.from("messages").update({ status, provider_id: providerId, error: err }).eq("id", row.id);
  const label = `${channel === "whatsapp" ? "WhatsApp" : "Email"} · ${msg.step} · ${trigger}`;
  await logActivity(db, b.org.id, b.invoice.id, status === "failed" ? "error" : channel,
    status === "failed" ? `${label}: ${err}` : `${label} → ${recipient}${status === "simulated" ? " (simulated)" : ""}`);
  return { id: row.id as string, status, error: err, text: msg.text };
}

/** wa.me link: opens the owner's own WhatsApp with the text prefilled. No API, no business account. */
export async function whatsappLink(db: SupabaseClient, b: Bundle) {
  const phone = normalizePhone(b.customer.phone);
  if (!phone) throw new SendError("no_phone");
  const msg = composeFor(b);
  await db.from("messages").insert({
    organization_id: b.org.id, invoice_id: b.invoice.id, channel: "walink", step: msg.step,
    trigger: "manual", status: "sent", provider: "wa.me", recipient: phone, body: msg.text,
  });
  await logActivity(db, b.org.id, b.invoice.id, "whatsapp", `wa.me link · ${msg.step}`);
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg.text)}`;
}

/** Marks an invoice paid (idempotent) and thanks the customer once. */
export async function markPaid(db: SupabaseClient, b: Bundle, how: string) {
  const { data } = await db
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", b.invoice.id)
    .neq("status", "paid")
    .select("id");
  if (!data?.length) return false;
  await logActivity(db, b.org.id, b.invoice.id, "paid", how);
  const channel = b.org.channel_whatsapp && b.customer.phone && b.customer.whatsapp_opt_in && whatsappProvider() ? "whatsapp"
    : b.org.channel_email && b.customer.email && resend.resendConfigured() ? "email" : null;
  if (channel) {
    try { await sendReminder(db, b, channel, { step: "thanks", trigger: "auto" }); } catch { /* thank-you is optional */ }
  }
  return true;
}
