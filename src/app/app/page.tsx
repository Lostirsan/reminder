import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { daysLate, eur, formatDate, todayIn } from "@/lib/reminders";
import { loadDemoData } from "../actions";
import { buttonClass, Card, Empty, PageTitle, Stat } from "@/components/ui";
import { StatusBadge } from "@/components/InvoiceBits";
import type { Customer, Invoice, Locale } from "@/lib/types";

const TABS = ["overdue", "upcoming", "paid", "all"] as const;

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("title") };
}

export default async function Dashboard({ searchParams }: PageProps<"/app">) {
  const { supabase, org } = await requireOrg();
  const t = await getTranslations("dashboard");
  const locale = (await getLocale()) as Locale;
  const sp = await searchParams;
  const tab = TABS.find((x) => x === sp.tab) ?? "overdue";
  const today = todayIn(org.timezone);

  const { data } = await supabase.from("invoices").select("*, customer:customers(name)").order("due_date", { ascending: true }).limit(1000);
  const all = ((data ?? []) as (Invoice & { customer: Pick<Customer, "name"> })[]).map((i) => ({ ...i, days: daysLate(i.due_date, today) }));
  const open = all.filter((i) => i.status === "open" || i.status === "paused");
  const overdue = open.filter((i) => i.days > 0);
  const since = Date.parse(today) - 30 * 864e5;
  const paid30 = all.filter((i) => i.status === "paid" && i.paid_at && Date.parse(i.paid_at) > since);
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + Number(x.amount), 0);

  const rows = tab === "overdue" ? overdue.sort((a, b) => b.days - a.days)
    : tab === "upcoming" ? open.filter((i) => i.days <= 0)
    : tab === "paid" ? all.filter((i) => i.status === "paid").sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""))
    : all;

  const { data: integration } = await supabase.from("integrations").select("provider").limit(1).maybeSingle();

  return (
    <div>
      <PageTitle sub={org.name} actions={<Link href="/app/invoices/new" className={buttonClass.primary}>{t("add")}</Link>}>
        {t("title")}
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("overdueAmount")} value={eur(sum(overdue), locale)} tone="red" />
        <Stat label={t("overdueCount")} value={overdue.length} />
        <Stat label={t("paid30")} value={eur(sum(paid30), locale)} tone="green" />
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("auto")}</div>
          <div className={`mt-1 text-lg font-bold ${org.auto_reminders ? "text-emerald-700" : "text-zinc-500"}`}>
            {org.auto_reminders ? t("autoOn") : t("autoOff")}
          </div>
          <Link href="/app/settings" className="text-xs text-emerald-700 hover:underline">{t("change")}</Link>
        </Card>
      </div>

      <div className="mt-8 flex flex-wrap gap-2 border-b border-zinc-200">
        {TABS.map((x) => (
          <Link key={x} href={`/app?tab=${x}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${x === tab ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>
            {t(`tabs.${x}`)}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        {all.length === 0 ? (
          <Empty>
            <p className="font-medium text-zinc-700">{t("emptyTitle")}</p>
            <p className="mt-1">{integration ? t("emptySynced") : t("emptyText")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/app/settings#integrations" className={buttonClass.secondary}>{t("connectMoloni")}</Link>
              <Link href="/app/invoices/new" className={buttonClass.secondary}>{t("add")}</Link>
              <form action={loadDemoData}><button className={buttonClass.secondary}>{t("demo")}</button></form>
            </div>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty>{t("emptyTab")}</Empty>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2">{t("col.invoice")}</th>
                  <th className="px-4 py-2">{t("col.customer")}</th>
                  <th className="px-4 py-2 text-right">{t("col.amount")}</th>
                  <th className="px-4 py-2">{t("col.due")}</th>
                  <th className="px-4 py-2">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((i) => (
                  <tr key={i.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2 font-medium"><Link href={`/app/invoices/${i.id}`} className="text-emerald-800 hover:underline">{i.number}</Link></td>
                    <td className="px-4 py-2">{i.customer?.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{eur(Number(i.amount), locale)}</td>
                    <td className="px-4 py-2 tabular-nums">{formatDate(i.due_date, locale)}</td>
                    <td className="px-4 py-2"><StatusBadge status={i.status} days={i.days} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
