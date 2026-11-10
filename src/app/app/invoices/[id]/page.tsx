import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { eur, formatDate, lateInterest } from "@/lib/reminders";
import { interestRateOf } from "@/lib/interest";
import { composeFor, payUrl, whatsappProvider } from "@/lib/send";
import { resendConfigured } from "@/lib/providers/resend";
import { invoiceAction } from "@/app/actions";
import { CustomerForm } from "@/components/CustomerForm";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, buttonClass, Card, PageTitle } from "@/components/ui";
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
  const li = lateInterest(Number(invoice.amount), preview.days, interestRateOf(org));
  const isOpen = invoice.status === "open" || invoice.status === "paused";
  const wa = whatsappProvider();
  const mail = resendConfigured();
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  const msgTone = (s: Message["status"]) => (s === "failed" ? "red" : s === "simulated" ? "zinc" : s === "queued" ? "amber" : "green");

  return (
    <div>
      <Link href="/app" className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200">← {t("back")}</Link>
      <PageTitle sub={<Link href={`/app/customers/${customer.id}`} className="hover:underline">{customer.name}</Link>} actions={<StatusBadge status={invoice.status} days={preview.days} />}>
        {t("title", { number: invoice.number })}
      </PageTitle>

      {isOpen && invoice.payer_claimed_at && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sky-50 dark:bg-sky-950/40 p-4 text-sm text-sky-900 dark:text-sky-200">
          <span>{t("claimed", { when: when(invoice.payer_claimed_at) })}</span>
          <ActionForm action={invoiceAction} className="flex gap-2">
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <SubmitButton name="op" value="paid">{t("claimConfirm")}</SubmitButton>
            <SubmitButton name="op" value="claim_reject" variant="secondary">{t("claimReject")}</SubmitButton>
          </ActionForm>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-zinc-500 dark:text-zinc-400">{t("amount")}</dt><dd className="text-lg font-semibold">{eur(Number(invoice.amount), locale)}</dd></div>
              <div><dt className="text-zinc-500 dark:text-zinc-400">{t("due")}</dt><dd className="font-medium">{formatDate(invoice.due_date, locale)}</dd></div>
              <div><dt className="text-zinc-500 dark:text-zinc-400">{t("interest")}</dt><dd className="font-medium">{eur(li.interest, locale)}</dd></div>
              <div><dt className="text-zinc-500 dark:text-zinc-400">{t("compensation")}</dt><dd className="font-medium">{eur(li.compensation, locale)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{t("payLink")}: <a href={payUrl(invoice)} target="_blank" className="break-all text-emerald-700 dark:text-emerald-400 hover:underline">{payUrl(invoice)}</a></p>
          </Card>

          {isOpen && (
            <Card>
              <h2 className="font-semibold">{t("nextMessage", { step: ts(preview.step) })}</h2>
              <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-4 font-sans text-sm text-zinc-800 dark:text-zinc-200">{preview.text}</pre>
              <ActionForm action={invoiceAction} className="mt-4 flex flex-wrap gap-2">
                <input type="hidden" name="invoice_id" value={invoice.id} />
                <SubmitButton name="op" value="whatsapp">{t("sendWhatsapp")}{!wa && " · demo"}</SubmitButton>
                <SubmitButton name="op" value="email" variant="secondary">{t("sendEmail")}{!mail && " · demo"}</SubmitButton>
                {customer.phone && (
                  <a href={`/app/invoices/${invoice.id}/walink`} target="_blank" className={buttonClass.secondary}>{t("walink")}</a>
                )}
              </ActionForm>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("walinkHint")}</p>
            </Card>
          )}

          <Card>
            <h2 className="font-semibold">{t("history")}</h2>
            <ul className="mt-3 space-y-3 text-sm">
              {(messages as Message[] | null)?.map((m) => (
                <li key={m.id} className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>{when(m.created_at)}</span>
                    <Badge tone="sky">{m.channel === "walink" ? "wa.me" : m.channel}</Badge>
                    <Badge tone="zinc">{ts(m.step)}</Badge>
                    {m.trigger === "auto" && <Badge tone="zinc">auto</Badge>}
                    <Badge tone={msgTone(m.status)}>{t(`msgStatus.${m.status}`)}</Badge>
                    {m.recipient && <span>→ {m.recipient}</span>}
                  </div>
                  {m.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{m.error}</p>}
                  <details className="mt-1"><summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">{t("showText")}</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-zinc-700 dark:text-zinc-300">{m.body}</pre></details>
                </li>
              ))}
              {(activity as Activity[] | null)?.filter((a) => !["whatsapp", "email", "error"].includes(a.kind)).map((a) => (
                <li key={`a${a.id}`} className="text-xs text-zinc-500 dark:text-zinc-400">{when(a.created_at)} · {a.detail}</li>
              ))}
              {!messages?.length && !activity?.length && <li className="text-zinc-500 dark:text-zinc-400">{t("noHistory")}</li>}
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
            <h2 className="font-semibold"><Link href={`/app/customers/${customer.id}`} className="hover:underline">{customer.name}</Link></h2>
            <CustomerForm customer={customer} />
          </Card>
        </div>
      </div>
    </div>
  );
}
