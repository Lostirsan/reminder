import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { answerBankMatch, disconnectBank, invoiceAction, syncBankNow, uploadStatement } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, buttonClass, Card, Empty, inputClass, PageTitle } from "@/components/ui";
import { enableBankingConfigured, listBanks, type Aspsp } from "@/lib/providers/enablebanking";
import { eur, formatDate, todayIn } from "@/lib/reminders";
import type { Locale } from "@/lib/types";

export async function generateMetadata() {
  return { title: (await getTranslations("bank"))("title") };
}

type TxRow = {
  id: string; source: string; booking_date: string; amount: number; description: string; counterparty: string | null;
  match_status: "matched" | "suggested" | "confirmed" | "unmatched" | "ignored";
  invoice: { id: string; number: string; amount: number; customer: { name: string } | null } | null;
};

export default async function BankPage({ searchParams }: PageProps<"/app/bank">) {
  const { supabase, org } = await requireOrg();
  const t = await getTranslations("bank");
  const locale = (await getLocale()) as Locale;
  const sp = await searchParams;
  const since = new Date(Date.parse(todayIn(org.timezone)) - 90 * 864e5).toISOString().slice(0, 10);
  const [{ data: txData }, { data: claimed }, { data: conn }] = await Promise.all([
    supabase.from("bank_transactions").select("*, invoice:invoices(id, number, amount, customer:customers(name))")
      .gte("booking_date", since).order("booking_date", { ascending: false }).limit(300),
    supabase.from("invoices").select("id, number, amount, payer_claimed_at, customer:customers(name)")
      .not("payer_claimed_at", "is", null).in("status", ["open", "paused"]).order("payer_claimed_at"),
    supabase.from("integrations").select("*").eq("provider", "enablebanking").maybeSingle(),
  ]);
  const txs = (txData ?? []) as unknown as TxRow[];
  const suggested = txs.filter((x) => x.match_status === "suggested");
  const ebOn = enableBankingConfigured();
  let banks: Aspsp[] = [];
  let banksError: string | null = null;
  if (ebOn && !conn) {
    try { banks = await listBanks("PT"); } catch (e) { banksError = (e as Error).message; }
  }
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: org.timezone, dateStyle: "short", timeStyle: "short" });
  const tone = { matched: "green", confirmed: "green", suggested: "amber", unmatched: "zinc", ignored: "zinc" } as const;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageTitle sub={t("sub")}>{t("title")}</PageTitle>

      {!org.iban && (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          {t("noIban")} <Link href="/app/settings#payments" className="font-medium underline">{t("addIban")}</Link>
        </p>
      )}

      {(suggested.length > 0 || (claimed?.length ?? 0) > 0) && (
        <Card className="border-amber-300">
          <h2 className="font-semibold">{t("toConfirm")}</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {suggested.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-100 p-3">
                <div>
                  <div className="font-medium">{eur(Number(x.amount), locale)} · {formatDate(x.booking_date, locale)} · {x.counterparty || x.description || "—"}</div>
                  {x.counterparty && x.description && <div className="text-xs text-zinc-500">{x.description}</div>}
                  {x.invoice && (
                    <div className="text-xs text-zinc-600">
                      {t("isItFor")} <Link href={`/app/invoices/${x.invoice.id}`} className="text-emerald-700 hover:underline">{x.invoice.number}</Link>
                      {" "}({x.invoice.customer?.name}, {eur(Number(x.invoice.amount), locale)})?
                    </div>
                  )}
                </div>
                <ActionForm action={answerBankMatch} className="flex gap-2">
                  <input type="hidden" name="tx_id" value={x.id} />
                  <SubmitButton name="op" value="confirm">{t("yesPaid")}</SubmitButton>
                  <SubmitButton name="op" value="reject" variant="secondary">{t("notThis")}</SubmitButton>
                </ActionForm>
              </li>
            ))}
            {(claimed ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-100 p-3">
                <div>
                  <div className="font-medium">
                    <Link href={`/app/invoices/${c.id}`} className="text-emerald-700 hover:underline">{c.number}</Link>
                    {" "}· {(c.customer as unknown as { name: string } | null)?.name} · {eur(Number(c.amount), locale)}
                  </div>
                  <div className="text-xs text-zinc-500">{t("claimedAt", { when: when(c.payer_claimed_at as string) })}</div>
                </div>
                <ActionForm action={invoiceAction} className="flex gap-2">
                  <input type="hidden" name="invoice_id" value={c.id} />
                  <SubmitButton name="op" value="paid">{t("yesPaid")}</SubmitButton>
                  <SubmitButton name="op" value="claim_reject" variant="secondary">{t("notReceived")}</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">{t("uploadTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-600">{t("uploadText")}</p>
          <ActionForm action={uploadStatement} className="mt-4 space-y-3">
            <input type="file" name="file" accept=".csv,.txt,text/csv" required className={inputClass} />
            <SubmitButton>{t("upload")}</SubmitButton>
          </ActionForm>
          <details className="mt-3 text-xs text-zinc-500">
            <summary className="cursor-pointer">{t("howExport")}</summary>
            <p className="mt-1 whitespace-pre-line">{t("howExportText")}</p>
          </details>
        </Card>

        <Card>
          <h2 className="font-semibold">{t("autoTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-600">{t("autoText")}</p>
          {sp.bank === "ok" && <p className="mt-2 text-sm text-emerald-700">{t("connected")}</p>}
          {sp.bank === "error" && <p className="mt-2 text-sm text-red-600">{t("connectFailed")} {typeof sp.reason === "string" && sp.reason}</p>}
          {conn ? (
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <Badge tone={conn.status === "connected" ? "green" : "red"}>{conn.status === "connected" ? t("statusOk") : t("statusError")}</Badge>{" "}
                <span className="font-medium">{conn.account_label}</span>
              </div>
              {conn.last_sync_at && <div className="text-xs text-zinc-500">{t("lastSync")} {when(conn.last_sync_at)}</div>}
              {conn.expires_at && <div className="text-xs text-zinc-500">{t("expires", { date: formatDate(conn.expires_at, locale) })}</div>}
              {conn.last_error && <div className="text-xs text-red-600">{conn.last_error === "consent_expired" ? t("consentExpired") : conn.last_error}</div>}
              <div className="flex gap-2">
                <form action={syncBankNow}><button className={buttonClass.secondary}>{t("syncNow")}</button></form>
                <form action={disconnectBank}><button className={buttonClass.secondary}>{t("disconnect")}</button></form>
              </div>
            </div>
          ) : !ebOn ? (
            <p className="mt-4 text-xs text-zinc-500">{t("notSetUp")}</p>
          ) : banksError ? (
            <p className="mt-4 text-xs text-red-600">{banksError}</p>
          ) : (
            <form action="/api/integrations/enablebanking/connect" method="get" className="mt-4 space-y-3">
              <select name="bank" required className={inputClass} defaultValue="">
                <option value="" disabled>{t("chooseBank")}</option>
                {banks.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
              <select name="psu" className={inputClass} defaultValue="business">
                <option value="business">{t("psuBusiness")}</option>
                <option value="personal">{t("psuPersonal")}</option>
              </select>
              <button className={buttonClass.primary}>{t("connect")}</button>
              <p className="text-xs text-zinc-500">{t("connectHint")}</p>
            </form>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="font-semibold">{t("incoming")}</h2>
        {txs.length === 0 ? (
          <div className="mt-3"><Empty>{t("noTx")}</Empty></div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr><th className="py-2 pr-3">{t("col.date")}</th><th className="py-2 pr-3 text-right">{t("col.amount")}</th><th className="py-2 pr-3">{t("col.from")}</th><th className="py-2">{t("col.match")}</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {txs.map((x) => (
                  <tr key={x.id}>
                    <td className="py-2 pr-3 tabular-nums">{formatDate(x.booking_date, locale)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{eur(Number(x.amount), locale)}</td>
                    <td className="py-2 pr-3"><div>{x.counterparty || "—"}</div><div className="text-xs text-zinc-500">{x.description}</div></td>
                    <td className="py-2">
                      <Badge tone={tone[x.match_status]}>{t(`match.${x.match_status}`)}</Badge>
                      {x.invoice && <> <Link href={`/app/invoices/${x.invoice.id}`} className="text-xs text-emerald-700 hover:underline">{x.invoice.number}</Link></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
