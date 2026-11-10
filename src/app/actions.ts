"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg } from "@/lib/auth";
import { loadBundle, logActivity, markPaid, sendReminder, SendError } from "@/lib/send";
import { loadMoloniTokens, saveMoloniTokens, syncMoloni } from "@/lib/sync";
import { answerSuggestion, reconcile, storeTransactions, syncBank } from "@/lib/banksync";
import { normalizeIban, parseStatement } from "@/lib/bank";
import { deleteSession } from "@/lib/providers/enablebanking";
import { decryptJson } from "@/lib/crypto";
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
  if (error) return fail(/rate limit/i.test(error.message) ? "rate_limit" : "generic", error.message);
  return { ok: (await getTranslations("login"))("codeSent", { email }), email };
}

/** Second step: the 6-digit code from the same email (works on any device, unlike the link). */
export async function verifyEmailCode(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = str(formData, "email");
  const token = str(formData, "code").replace(/\D/g, "");
  if (!/^\d{6,10}$/.test(token)) return { ...(await fail("bad_code")), email };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ...(await fail("bad_code")), email };
  const next = str(formData, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/app");
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

/** Where customers pay: IBAN (+ holder) for transfers, optional MB WAY phone. */
export async function updatePaymentDetails(_: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, org } = await requireOrg();
  const ibanRaw = str(formData, "iban");
  const iban = normalizeIban(ibanRaw);
  if (ibanRaw && !iban) return fail("bad_iban");
  const mbRaw = str(formData, "mbway_phone");
  const mbway = normalizePhone(mbRaw);
  if (mbRaw && !mbway) return fail("bad_phone");
  const { error } = await supabase.from("organizations").update({
    iban, account_holder: str(formData, "account_holder") || null, mbway_phone: mbway,
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
    whatsapp_opt_in: formData.get("whatsapp_opt_in") === "on",
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
    whatsapp_opt_in: formData.get("whatsapp_opt_in") === "on",
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
    } else if (op === "claim_reject") {
      await admin.from("invoices").update({ payer_claimed_at: null }).eq("id", id);
      await logActivity(admin, org.id, id, "claim", "Payment not received yet: reminders continue");
    } else if (op === "reopen") {
      await admin.from("invoices").update({ status: "open", paid_at: null, payer_claimed_at: null }).eq("id", id);
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
      phone: testPhone ?? `35191000000${i}`, whatsapp_opt_in: true, email: process.env.EMAIL_TEST_RECIPIENT || `demo${i}@example.com`,
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

/** When a Moloni login has several companies, the owner picks the one to sync. */
export async function selectMoloniCompany(formData: FormData): Promise<void> {
  const { org } = await requireOrg();
  const admin = createAdminClient();
  const tokens = await loadMoloniTokens(admin, org.id);
  const company = tokens?.companies?.find((c) => c.id === Number(formData.get("company_id")));
  if (!tokens || !company) return;
  await saveMoloniTokens(admin, org.id, { ...tokens, companyId: company.id, companyName: company.name });
  await admin.from("integrations").update({ account_label: company.name, last_error: null })
    .eq("organization_id", org.id).eq("provider", "moloni");
  await logActivity(admin, org.id, null, "integration", `Moloni company: ${company.name}`);
  try { await syncMoloni(admin, org.id); } catch { /* error is stored on the integration row */ }
  revalidatePath("/app", "layout");
}

export async function disconnectMoloni(): Promise<void> {
  const { org } = await requireOrg();
  const admin = createAdminClient();
  await admin.from("integrations").delete().eq("organization_id", org.id).eq("provider", "moloni");
  await logActivity(admin, org.id, null, "integration", "Moloni disconnected");
  revalidatePath("/app/settings");
}

// ------------------------------------------------------------------ bank
const MAX_STATEMENT_BYTES = 2_000_000;
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

/** CSV bank statement upload: stores incoming payments and closes the invoices they pay. */
export async function uploadStatement(_: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireOrg();
  const t = await getTranslations("bank");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("no_file");
  if (file.size > MAX_STATEMENT_BYTES) return fail("file_too_big");
  if (/\.(xlsx?|pdf)$/i.test(file.name)) return fail("not_csv");
  const buf = new Uint8Array(await file.arrayBuffer());
  // Portuguese banks often export Windows-1252 (Latin-1); fall back when UTF-8 has broken characters.
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("\ufffd")) {
    try { text = new TextDecoder("windows-1252").decode(buf); } catch { text = latin1(buf); }
  }
  const { txs, error } = parseStatement(text);
  if (error) return fail(error === "no_header" ? "csv_no_header" : "csv_no_rows");
  const admin = createAdminClient();
  const added = await storeTransactions(admin, org.id, "upload", txs);
  const r = await reconcile(admin, org.id);
  await logActivity(admin, org.id, null, "bank", `Statement ${file.name}: ${txs.length} incoming, ${added} new, ${r.matched} invoices paid, ${r.suggested} to confirm`);
  revalidatePath("/app", "layout");
  return { ok: t("uploaded", { found: txs.length, added, matched: r.matched, suggested: r.suggested }) };
}

export async function answerBankMatch(_: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await requireOrg();
  const ok = await answerSuggestion(createAdminClient(), org.id, str(formData, "tx_id"), str(formData, "op") === "confirm");
  if (!ok) return fail("not_found");
  revalidatePath("/app", "layout");
  return { ok: (await getTranslations("common"))("saved") };
}

export async function syncBankNow(): Promise<void> {
  const { org } = await requireOrg();
  try { await syncBank(createAdminClient(), org.id, { force: true }); } catch { /* error is stored on the integration row */ }
  revalidatePath("/app", "layout");
}

export async function disconnectBank(): Promise<void> {
  const { org } = await requireOrg();
  const admin = createAdminClient();
  const { data: secret } = await admin.from("integration_secrets").select("ciphertext").eq("organization_id", org.id).eq("provider", "enablebanking").maybeSingle();
  if (secret) {
    try { await deleteSession((await decryptJson<{ sessionId: string }>(secret.ciphertext)).sessionId); } catch { /* already gone */ }
  }
  await admin.from("integrations").delete().eq("organization_id", org.id).eq("provider", "enablebanking");
  await logActivity(admin, org.id, null, "integration", "Bank disconnected");
  revalidatePath("/app/bank");
}
