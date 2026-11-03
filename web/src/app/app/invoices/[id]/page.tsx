import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { eur, formatDate, lateInterest } from "@/lib/reminders";
import { composeFor, payUrl, whatsappProvider } from "@/lib/send";
import { resendConfigured } from "@/lib/providers/resend";
import { invoiceAction, updateCustomer } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, buttonClass, Card, Field, inputClass, PageTitle } from "@/components/ui";
import { StatusBadge } from "@/components/InvoiceBits";
import type { Activity, Customer, Invoice, Locale, Message } from "@/lib/types";

export default async function InvoicePage({ params }: PageProps<"/app/invoices/[id]">) {
  const { id } = await params;
  const { supabase, org } = await requireOrg();
  const t = await getTranslations("invoice");
  const ts = await getTranslations("step");
  const locale = (await getLocale()) as Locale;
  const { data } = await supabase.from("invoices").select("*, customer:customers(*)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const { customer, ...invoice } = data as Invoice & { customer: Customer };
  const [{ data: messages }, { data: activity }] = await Promise.all([
    supabase.from("messages").select("*").eq("invoice_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("activity").select("*").eq("invoice_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const preview = composeFor({ org, invoice, customer });
  const li = lateInterest(Number(invoice.amount), preview.days, Number(org.late_interest_rate));
  const isOpen = invoice.status === "open" || invoice.status === "paused";
  const wa = whatsappProvider();
  const mail = resendConfigured();
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  const msgTone = (s: Message["status"]) => (s === "failed" ? "red" : s === "simulated" ? "zinc" : s === "queued" ? "amber" : "green");

  return (
    <div>
      <Link href="/app" className="text-sm text-zinc-500 hover:text-zinc-800">← {t("back")}</Link>
      <PageTitle sub={customer.name} actions={<StatusBadge status={invoice.status} days={preview.days} />}>
        {t("title", { number: invoice.number })}
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-zinc-500">{t("amount")}</dt><dd className="text-lg font-semibold">{eur(Number(invoice.amount), locale)}</dd></div>
              <div><dt className="text-zinc-500">{t("due")}</dt><dd className="font-medium">{formatDate(invoice.due_date, locale)}</dd></div>
              <div><dt className="text-zinc-500">{t("interest")}</dt><dd className="font-medium">{eur(li.interest, locale)}</dd></div>
              <div><dt className="text-zinc-500">{t("compensation")}</dt><dd className="font-medium">{eur(li.compensation, locale)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-zinc-500">{t("payLink")}: <a href={payUrl(invoice)} target="_blank" className="break-all text-emerald-700 hover:underline">{payUrl(invoice)}</a></p>
          </Card>

          {isOpen && (
            <Card>
              <h2 className="font-semibold">{t("nextMessage", { step: ts(preview.step) })}</h2>
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-emerald-50 p-4 font-sans text-sm text-zinc-800">{preview.text}</pre>
              <ActionForm action={invoiceAction} className="mt-4 flex flex-wrap gap-2">
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <SubmitButton name="op" value="whatsapp">{t("sendWhatsapp")}{!wa && " · demo"}</SubmitButton>
                <SubmitButton name="op" value="email" variant="secondary">{t("sendEmail")}{!mail && " · demo"}</SubmitButton>
                {customer.phone && (
                  <a href={`/app/invoices/${invoice.id}/walink`} target="_blank" className={buttonClass.secondary}>{t("walink")}</a>
                )}
              </ActionForm>
              <p className="mt-2 text-xs text-zinc-500">{t("walinkHint")}</p>
            </Card>
          )}

          <Card>
            <h2 className="font-semibold">{t("history")}</h2>
            <ul className="mt-3 space-y-3 text-sm">
              {(messages as Message[] | null)?.map((m) => (
                <li key={m.id} className="rounded-lg border border-zinc-100 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{when(m.created_at)}</span>
                    <Badge tone="sky">{m.channel === "walink" ? "wa.me" : m.channel}</Badge>
                    <Badge tone="zinc">{ts(m.step)}</Badge>
                    {m.trigger === "auto" && <Badge tone="zinc">auto</Badge>}
                    <Badge tone={msgTone(m.status)}>{t(`msgStatus.${m.status}`)}</Badge>
                    {m.recipient && <span>→ {m.recipient}</span>}
                  </div>
                  {m.error && <p className="mt-1 text-xs text-red-600">{m.error}</p>}
                  <details className="mt-1"><summary className="cursor-pointer text-xs text-zinc-500">{t("showText")}</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-zinc-700">{m.body}</pre></details>
                </li>
              ))}
              {(activity as Activity[] | null)?.filter((a) => !["whatsapp", "email", "error"].includes(a.kind)).map((a) => (
                <li key={`a${a.id}`} className="text-xs text-zinc-500">{when(a.created_at)} · {a.detail}</li>
              ))}
              {!messages?.length && !activity?.length && <li className="text-zinc-500">{t("noHistory")}</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="font-semibold">{t("actions")}</h2>
            <ActionForm action={invoiceAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="invoice_id" value={invoice.id} />
              {isOpen && <SubmitButton name="op" value="paid">{t("markPaid")}</SubmitButton>}
              {invoice.status === "open" && <SubmitButton name="op" value="pause" variant="secondary">{t("pause")}</SubmitButton>}
              {invoice.status === "paused" && <SubmitButton name="op" value="resume" variant="secondary">{t("resume")}</SubmitButton>}
              {invoice.status === "paid" && <SubmitButton name="op" value="reopen" variant="secondary">{t("reopen")}</SubmitButton>}
              {invoice.source !== "moloni" && <SubmitButton name="op" value="delete" variant="danger">{t("delete")}</SubmitButton>}
            </ActionForm>
          </Card>
          <Card>
            <h2 className="font-semibold">{t("customer")}</h2>
            <ActionForm action={updateCustomer} className="mt-3 space-y-3">
              <input type="hidden" name="customer_id" value={customer.id} />
              <Field label={t("contactName")}><input name="contact_name" defaultValue={customer.contact_name ?? ""} className={inputClass} /></Field>
              <Field label={t("phone")}><input name="phone" type="tel" defaultValue={customer.phone ? `+${customer.phone}` : ""} className={inputClass} /></Field>
              <Field label="Email"><input name="email" type="email" defaultValue={customer.email ?? ""} className={inputClass} /></Field>
              <Field label={t("language")}>
                <select name="locale" defaultValue={customer.locale} className={inputClass}>
                  <option value="pt">Português</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <SubmitButton variant="secondary">{t("saveCustomer")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
