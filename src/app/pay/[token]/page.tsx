import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { bundleByToken, demoPaymentsAllowed } from "@/lib/pay";
import { eur, formatDate } from "@/lib/reminders";
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
        {canPay && !stripeConfigured() && demoPaymentsAllowed() && (
          <form action={`/pay/${token}/demo`} method="post" className="mt-6">
            <button className="w-full rounded-lg bg-zinc-800 px-4 py-3 font-semibold text-white">{t("demoButton")}</button>
            <p className="mt-2 text-center text-xs text-zinc-500">{t("demoHint")}</p>
          </form>
        )}
        {canPay && !stripeConfigured() && !demoPaymentsAllowed() && <p className="mt-6 text-sm text-zinc-500">{t("unavailable")}</p>}
      </Card>
    </div>
  );
}
