"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg } from "@/lib/auth";
import { loadBundle, logActivity, markPaid, sendReminder, SendError } from "@/lib/send";
import { syncMoloni } from "@/lib/sync";
import { normalizePhone } from "@/lib/reminders";
import type { ActionState } from "@/lib/types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

async function origin() {
  const h = await headers();
  return process.env.APP_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

async function fail(code: string, detail?: string): Promise<ActionState> {
  const t = await getTranslations("errors");
  const known = t.has(code) ? t(code) : null;
  return { error: known ? (detail ? `${known} (${detail})` : known) : detail || code };
}

// ------------------------------------------------------------------ language & auth
export async function setLocale(formData: FormData) {
  const l = str(formData, "locale");
  if (l === "pt" || l === "en") (await cookies()).set("locale", l, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const next = str(formData, "next") || "/app";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message ?? "oauth")}`);
  redirect(data.url);
}

export async function signInWithEmail(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = str(formData, "email");
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail("bad_email");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/app` },
  });
  if (error) return fail("generic", error.message);
  return { ok: (await getTranslations("login"))("linkSent", { email }) };
}

// ------------------------------------------------------------------ company
export async function createOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const nif = str(formData, "nif").replace(/\s/g, "");
  if (nif && !/^\d{9}$/.test(nif)) return fail("bad_nif");
  const { error } = await supabase.rpc("create_organization", {
    p_name: str(formData, "name"),
    p_sender_name: str(formData, "sender_name"),
    p_nif: nif,
    p_locale: str(formData, "locale") === "en" ? "en" : "pt",
  });
  if (error) return fail(error.message.split(":")[0], error.message);
  redirect("/app");
}

export async function updateSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, org } = await requireOrg();
  const nif = str(formData, "nif").replace(/\s/g, "");
  if (nif && !/^\d{9}$/.test(nif)) return fail("bad_nif");
  const rate = Number(str(formData, "late_interest_rate").replace(",", "."));
  if (!Number.isFinite(rate) || rate < 0 || rate > 50) return fail("bad_rate");
  const { error } = await supabase.from("organizations").update({
    name: str(formData, "name") || org.name,
    sender_name: str(formData, "sender_name") || org.sender_name,
    nif: nif || null,
    locale: str(formData, "locale") === "en" ? "en" : "pt",
    auto_reminders: formData.get("auto_reminders") === "on",
    mention_interest: formData.get("mention_interest") === "on",
    channel_whatsapp: formData.get("channel_whatsapp") === "on",
    channel_email: formData.get("channel_email") === "on",
    late_interest_rate: rate,
  }).eq("id", org.id);
  if (error) return fail("generic", error.message);
  revalidatePath("/app", "layout");
  return { ok: (await getTranslations("common"))("saved") };
}

export async function deleteOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, org } = await requireOrg();
  if (str(formData, "confirm") !== org.name) return fail("confirm_name");
  const { error } = await supabase.rpc("delete_organization", { p_org: org.id });
  if (error) return fail(error.message.split(":")[0], error.message);
  redirect("/onboarding");
}

// ------------------------------------------------------------------ invoices
export async function addInvoice(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, org } = await requireOrg();
  const amount = Number(str(formData, "amount").replace(",", "."));
  const due = str(formData, "due_date");
  const phoneRaw = str(formData, "phone");
  const phone = normalizePhone(phoneRaw);
  if (!str(formData, "customer") || !str(formData, "number")) return fail("required");
  if (!(amount > 0)) return fail("bad_amount");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail("bad_date");
  if (phoneRaw && !phone) return fail("bad_phone");
  const { data: c, error: ce } = await supabase.from("customers").insert({
    organization_id: org.id,
    name: str(formData, "customer"),
    contact_name: str(formData, "contact_name") || null,
    phone,
    email: str(formData, "email") || null,
    locale: str(formData, "customer_locale") === "en" ? "en" : "pt",
  }).select("id").single();
  if (ce) return fail("generic", ce.message);
  const { data: inv, error } = await supabase.from("invoices").insert({
    organization_id: org.id, customer_id: c.id, number: str(formData, "number"), amount, due_date: due,
  }).select("id").single();
  if (error) return fail("generic", error.message);
  redirect(`/app/invoices/${inv.id}`);
}

export async function updateCustomer(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireOrg();
  const phoneRaw = str(formData, "phone");
  const phone = normalizePhone(phoneRaw);
  if (phoneRaw && !phone) return fail("bad_phone");
  const { error } = await supabase.from("customers").update({
    contact_name: str(formData, "contact_name") || null,
    phone,
    email: str(formData, "email") || null,
    locale: str(formData, "locale") === "en" ? "en" : "pt",
  }).eq("id", str(formData, "customer_id"));
  if (error) return fail("generic", error.message);
  revalidatePath("/app", "layout");
  return { ok: (await getTranslations("common"))("saved") };
}

export async function invoiceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, org } = await requireOrg();
  const id = str(formData, "invoice_id");
  const op = str(formData, "op");
  // Membership check through RLS, then the server client writes the log and messages.
  const { data: visible } = await supabase.from("invoices").select("id").eq("id", id).maybeSingle();
  if (!visible) return fail("not_found");
  const admin = createAdminClient();
  const b = await loadBundle(admin, org.id, id);
  if (!b) return fail("not_found");
  const t = await getTranslations("invoice");
  try {
    if (op === "whatsapp" || op === "email") {
      const r = await sendReminder(admin, b, op);
      revalidatePath(`/app/invoices/${id}`);
      if (r?.status === "failed") return fail("send_failed", r.error ?? undefined);
      return { ok: r?.status === "simulated" ? t("sentSimulated") : t("sent") };
    }
    if (op === "paid") await markPaid(admin, b, "Marked as paid manually");
    else if (op === "pause" || op === "resume") {
      await admin.from("invoices").update({ status: op === "pause" ? "paused" : "open" }).eq("id", id);
      await logActivity(admin, org.id, id, "status", op === "pause" ? "Reminders paused" : "Reminders resumed");
    } else if (op === "reopen") {
      await admin.from("invoices").update({ status: "open", paid_at: null }).eq("id", id);
      await logActivity(admin, org.id, id, "status", "Reopened");
    } else if (op === "delete") {
      await supabase.from("invoices").delete().eq("id", id);
      redirect("/app");
    } else return fail("generic", op);
  } catch (e) {
    if (e instanceof SendError) return fail(e.message);
    throw e;
  }
  revalidatePath(`/app/invoices/${id}`);
  return { ok: (await getTranslations("common"))("saved") };
}

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export async function loadDemoData() {
  const { supabase, org } = await requireOrg();
  const testPhone = normalizePhone(process.env.WHATSAPP_TEST_RECIPIENT);
  const rows: [string, string, number, number, string][] = [
    ["Tasca do Rui", "Rui", 380.0, -2, "FT 2026/131"],
    ["Hotel Rio Azul", "Marta", 1240.5, 3, "FT 2026/118"],
    ["Café Arcada", "António", 96.4, 7, "FT 2026/109"],
    ["Restaurante Ponte Velha", "Joana", 2115.0, 41, "FT 2026/097"],
    ["Pastelaria Sé", "Helena", 212.8, 15, "FT 2026/140"],
  ];
  for (const [i, [name, contact, amount, late, number]] of rows.entries()) {
    const { data: c } = await supabase.from("customers").insert({
      organization_id: org.id, source: "demo", external_id: `demo-${i}`, name, contact_name: contact,
      phone: testPhone ?? `35191000000${i}`, email: process.env.EMAIL_TEST_RECIPIENT || `demo${i}@example.com`,
    }).select("id").single();
    if (c) await supabase.from("invoices").insert({
      organization_id: org.id, customer_id: c.id, source: "demo", external_id: `demo-${i}`,
      number, amount, due_date: day(-late), issue_date: day(-late - 30),
    });
  }
  revalidatePath("/app");
}

// ------------------------------------------------------------------ integrations
export async function syncNow(): Promise<void> {
  const { org } = await requireOrg();
  try { await syncMoloni(createAdminClient(), org.id); } catch { /* error is stored on the integration row */ }
  revalidatePath("/app", "layout");
}

export async function disconnectMoloni(): Promise<void> {
  const { org } = await requireOrg();
  const admin = createAdminClient();
  await admin.from("integrations").delete().eq("organization_id", org.id).eq("provider", "moloni");
  await logActivity(admin, org.id, null, "integration", "Moloni disconnected");
  revalidatePath("/app/settings");
}
