import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { daysLate, eur, formatDate, todayIn } from "@/lib/reminders";
import { Card, PageTitle } from "@/components/ui";
import { StatusBadge } from "@/components/InvoiceBits";
import { CustomerForm } from "@/components/CustomerForm";
import type { Customer, Invoice, Locale } from "@/lib/types";

export default async function CustomerPage({ params }: PageProps<"/app/customers/[id]">) {
  const { id } = await params;
  const { supabase, org } = await requireOrg();
  const t = await getTranslations("customers");
  const locale = (await getLocale()) as Locale;
  const { data } = await supabase.from("customers").select("*, invoices(*)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const { invoices, ...customer } = data as Customer & { invoices: Invoice[] };
  const today = todayIn(org.timezone);
  const sorted = [...invoices].sort((a, b) => b.due_date.localeCompare(a.due_date));

  return (
    <div>
      <Link href="/app/customers" className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200">← {t("title")}</Link>
      <PageTitle>{customer.name}</PageTitle>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-x-auto p-0 lg:col-span-2">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sorted.map((i) => (
                <tr key={i.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <td className="px-4 py-2 font-medium"><Link href={`/app/invoices/${i.id}`} className="text-emerald-800 dark:text-emerald-300 hover:underline">{i.number}</Link></td>
                  <td className="px-4 py-2 text-right tabular-nums">{eur(Number(i.amount), locale)}</td>
                  <td className="px-4 py-2 tabular-nums">{formatDate(i.due_date, locale)}</td>
                  <td className="px-4 py-2"><StatusBadge status={i.status} days={daysLate(i.due_date, today)} /></td>
                </tr>
              ))}
              {!sorted.length && <tr><td className="px-4 py-6 text-center text-zinc-500 dark:text-zinc-400">{t("noInvoices")}</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card>
          <h2 className="font-semibold">{t("contactsTitle")}</h2>
          <CustomerForm customer={customer} />
        </Card>
      </div>
    </div>
  );
}
