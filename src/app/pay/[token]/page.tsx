import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { bundleByToken, demoPaymentsAllowed } from "@/lib/pay";
import { eur, formatDate, formatPhone } from "@/lib/reminders";
import { formatIban } from "@/lib/bank";
import { stripeConfigured } from "@/lib/providers/stripe";
import { Card } from "@/components/ui";

export const metadata = { robots: { index: false } };

export default async function PayPage({ params, searchParams }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const b = await bundleByToken(token);
  if (!b) notFound();
  const locale = b.customer.locale;
  const t = await getTranslations({ locale, namespace: "pay" });
  const { invoice, org } = b;
  const paid = invoice.status === "paid";
  const canPay = !paid && invoice.status !== "cancelled";
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <p className="text-sm text-zinc-500">{org.sender_name}{org.nif && ` · NIF ${org.nif}`}</p>
        <h1 className="mt-1 text-xl font-bold">{t("title", { number: invoice.number })}</h1>
        <div className="mt-4 text-3xl font-bold">{eur(Number(invoice.amount), locale)}</div>
        <p className="text-sm text-zinc-500">{t("due", { date: formatDate(invoice.due_date, locale) })}</p>
        {paid && <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-emerald-800">{t("alreadyPaid")}</p>}
        {sp.error === "1" && <p className="mt-4 text-sm text-red-600">{t("error")}</p>}
        {canPay && stripeConfigured() && (
          <form action={`/pay/${token}/checkout`} method="post" className="mt-6">
            <button className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800">{t("payButton")}</button>
            <p className="mt-2 text-center text-xs text-zinc-500">{t("methods")}</p>
          </form>
        )}
        {canPay && org.iban && (
          <div className="mt-6 rounded-lg border border-zinc-200 p-4 text-sm">
            <h2 className="font-semibold">{stripeConfigured() ? t("orTransfer") : t("transfer")}</h2>
            <dl className="mt-2 space-y-1">
              <div><dt className="inline text-zinc-500">IBAN: </dt><dd className="inline select-all font-mono">{formatIban(org.iban)}</dd></div>
              {org.account_holder && <div><dt className="inline text-zinc-500">{t("holder")}: </dt><dd className="inline">{org.account_holder}</dd></div>}
              <div><dt className="inline text-zinc-500">{t("amount")}: </dt><dd className="inline select-all font-medium">{Number(invoice.amount).toFixed(2).replace(".", ",")} €</dd></div>
              <div><dt className="inline text-zinc-500">{t("reference")}: </dt><dd className="inline select-all font-medium">{invoice.number}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-zinc-500">{t("referenceHint")}</p>
            {org.mbway_phone && (
              <p className="mt-3"><span className="text-zinc-500">MB WAY: </span><span className="select-all font-medium">{formatPhone(org.mbway_phone)}</span></p>
            )}
          </div>
        )}
        {canPay && (org.iban || org.mbway_phone) && (
          invoice.payer_claimed_at || sp.claimed === "1" ? (
            <p className="mt-4 rounded-lg bg-sky-50 p-4 text-sm text-sky-900">{t("claimedThanks")}</p>
          ) : (
            <form action={`/pay/${token}/claim`} method="post" className="mt-4">
              <button className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 font-semibold text-zinc-800 hover:bg-zinc-50">{t("claimButton")}</button>
              <p className="mt-2 text-center text-xs text-zinc-500">{t("claimHint")}</p>
            </form>
          )
        )}
        {canPay && !stripeConfigured() && !org.iban && demoPaymentsAllowed() && (
          <form action={`/pay/${token}/demo`} method="post" className="mt-6">
            <button className="w-full rounded-lg bg-zinc-800 px-4 py-3 font-semibold text-white">{t("demoButton")}</button>
            <p className="mt-2 text-center text-xs text-zinc-500">{t("demoHint")}</p>
          </form>
        )}
        {canPay && !stripeConfigured() && !org.iban && !org.mbway_phone && !demoPaymentsAllowed() && <p className="mt-6 text-sm text-zinc-500">{t("unavailable")}</p>}
      </Card>
    </div>
  );
}
