import { getLocale, getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { deleteOrganization, disconnectMoloni, selectMoloniCompany, syncNow, updatePaymentDetails, updateSettings } from "@/app/actions";
import { formatIban } from "@/lib/bank";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, buttonClass, Card, Field, inputClass, PageTitle } from "@/components/ui";
import { moloniConfigured } from "@/lib/providers/moloni";
import { stripeConfigured } from "@/lib/providers/stripe";
import { resendConfigured } from "@/lib/providers/resend";
import { whatsappProvider } from "@/lib/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMoloniTokens } from "@/lib/sync";

function Toggle({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-1 h-4 w-4 accent-emerald-700 dark:accent-emerald-500" />
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}</span>
    </label>
  );
}

export default async function Settings({ searchParams }: PageProps<"/app/settings">) {
  const { supabase, org } = await requireOrg();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const sp = await searchParams;
  const { data: moloni } = await supabase.from("integrations").select("*").eq("provider", "moloni").maybeSingle();
  const moloniTokens = moloni ? await loadMoloniTokens(createAdminClient(), org.id).catch(() => null) : null;
  const moloniChoices = moloniTokens && !moloniTokens.companyId ? moloniTokens.companies ?? [] : [];
  const wa = whatsappProvider();
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle>{t("title")}</PageTitle>
      <Card>
        <h2 className="font-semibold">{t("company")}</h2>
        <ActionForm action={updateSettings} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")}><input name="name" defaultValue={org.name} required className={inputClass} /></Field>
            <Field label={t("sender")} hint={t("senderHint")}><input name="sender_name" defaultValue={org.sender_name} required className={inputClass} /></Field>
            <Field label="NIF"><input name="nif" defaultValue={org.nif ?? ""} inputMode="numeric" className={inputClass} /></Field>
            <Field label={t("language")}>
              <select name="locale" defaultValue={org.locale} className={inputClass}>
                <option value="pt">Português</option><option value="en">English</option>
              </select>
            </Field>
          </div>
          <h3 className="pt-2 font-semibold">{t("reminders")}</h3>
          <Toggle name="auto_reminders" checked={org.auto_reminders} label={t("auto")} hint={t("autoHint")} />
          <Toggle name="channel_whatsapp" checked={org.channel_whatsapp} label="WhatsApp" />
          <Toggle name="channel_email" checked={org.channel_email} label="Email" />
          <Toggle name="mention_interest" checked={org.mention_interest} label={t("interest")} hint={t("interestHint")} />
          <div className="max-w-xs">
            <Field label={t("rate")} hint={t("rateHint")}><input name="late_interest_rate" defaultValue={String(org.late_interest_rate)} inputMode="decimal" className={inputClass} /></Field>
          </div>
          <SubmitButton>{t("save")}</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <h2 id="payments" className="font-semibold">{t("paymentsTitle")}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("paymentsText")}</p>
        <ActionForm action={updatePaymentDetails} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="IBAN"><input name="iban" defaultValue={org.iban ? formatIban(org.iban) : ""} placeholder="PT50 …" className={inputClass} /></Field>
            <Field label={t("holder")}><input name="account_holder" defaultValue={org.account_holder ?? ""} className={inputClass} /></Field>
            <Field label={t("mbway")} hint={t("mbwayHint")}><input name="mbway_phone" type="tel" defaultValue={org.mbway_phone ? `+${org.mbway_phone}` : ""} className={inputClass} /></Field>
          </div>
          <SubmitButton>{t("save")}</SubmitButton>
        </ActionForm>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t("paymentsBankHint")} <a href="/app/bank" className="text-emerald-700 dark:text-emerald-400 hover:underline">{t("bankPage")}</a></p>
      </Card>

      <Card>
        <h2 id="integrations" className="font-semibold">{t("integrations")}</h2>
        {sp.moloni === "error" && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{t("moloniFailed")} {typeof sp.reason === "string" && sp.reason}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div>
            <div className="font-medium">Moloni</div>
            {moloni ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                <Badge tone={moloni.status === "connected" ? "green" : "red"}>{t(`int.${moloni.status}`)}</Badge>{" "}
                {moloni.account_label} {moloni.last_sync_at && `· ${t("lastSync")} ${when(moloni.last_sync_at)}`}
                {moloni.last_error && <span className="block text-red-600 dark:text-red-400">{moloni.last_error}</span>}
              </div>
            ) : (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{moloniConfigured() ? t("moloniHint") : t("moloniNotSetUp")}</div>
            )}
          </div>
          <div className="flex gap-2">
            {moloni ? (
              <>
                <form action={syncNow}><button className={buttonClass.secondary}>{t("syncNow")}</button></form>
                <form action={disconnectMoloni}><button className={buttonClass.secondary}>{t("disconnect")}</button></form>
              </>
            ) : moloniConfigured() ? (
              <a href="/api/integrations/moloni/connect" className={buttonClass.primary}>{t("connect")}</a>
            ) : null}
          </div>
          {moloniChoices.length > 0 && (
            <form action={selectMoloniCompany} className="flex w-full flex-wrap items-end gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
              <Field label={t("moloniPick")} hint={t("moloniPickHint")}>
                <select name="company_id" className={inputClass} defaultValue={moloniChoices.find((c) => /demonstra/i.test(c.name))?.id ?? moloniChoices[0].id}>
                  {moloniChoices.map((c) => <option key={c.id} value={c.id}>{c.name}{c.vat ? ` · ${c.vat}` : ""}</option>)}
                </select>
              </Field>
              <button className={buttonClass.primary}>{t("moloniPickButton")}</button>
            </form>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 p-4 text-sm text-zinc-500 dark:text-zinc-400">
          <span>InvoiceXpress · TOConline</span><span>{t("soon")}</span>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">{t("channels")}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>WhatsApp: {wa ? <Badge tone="green">{wa === "twilio" ? "Twilio" : "Meta"}</Badge> : <Badge tone="zinc">{t("demoMode")}</Badge>}</li>
          <li>Email: {resendConfigured() ? <Badge tone="green">Resend</Badge> : <Badge tone="zinc">{t("demoMode")}</Badge>}</li>
          <li>{t("payments")}: {stripeConfigured() ? <Badge tone="green">Stripe · MB WAY / Multibanco</Badge> : org.iban ? <Badge tone="green">{t("transferOnly")}</Badge> : <Badge tone="zinc">{t("demoMode")}</Badge>}</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t("channelsHint")}</p>
      </Card>

      <Card className="border-red-200 dark:border-red-900">
        <h2 className="font-semibold text-red-700 dark:text-red-400">{t("danger")}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("deleteHint")}</p>
        <ActionForm action={deleteOrganization} className="mt-3 flex flex-wrap gap-2">
          <input name="confirm" placeholder={org.name} className={`${inputClass} max-w-xs`} />
          <SubmitButton variant="danger">{t("delete")}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
