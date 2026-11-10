import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { Badge, Card, Empty, PageTitle } from "@/components/ui";
import type { Customer } from "@/lib/types";

export async function generateMetadata() {
  return { title: (await getTranslations("customers"))("title") };
}

export default async function Customers() {
  const { supabase } = await requireOrg();
  const t = await getTranslations("customers");
  const { data } = await supabase.from("customers")
    .select("id, name, phone, email, source, contacts_custom, invoices(status)").order("name").limit(1000);
  const rows = (data ?? []) as (Pick<Customer, "id" | "name" | "phone" | "email" | "source" | "contacts_custom"> & { invoices: { status: string }[] })[];

  return (
    <div>
      <PageTitle sub={t("sub")}>{t("title")}</PageTitle>
      {rows.length === 0 ? <Empty>{t("empty")}</Empty> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-left text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2">{t("name")}</th>
                <th className="px-4 py-2">{t("phone")}</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">{t("contacts")}</th>
                <th className="px-4 py-2 text-right">{t("open")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <td className="px-4 py-2 font-medium"><Link href={`/app/customers/${c.id}`} className="text-emerald-800 dark:text-emerald-300 hover:underline">{c.name}</Link></td>
                  <td className="px-4 py-2 tabular-nums">{c.phone ? `+${c.phone}` : "—"}</td>
                  <td className="px-4 py-2">{c.email ?? "—"}</td>
                  <td className="px-4 py-2">{c.source === "moloni" ? (c.contacts_custom ? <Badge tone="amber">{t("own")}</Badge> : <Badge tone="zinc">Moloni</Badge>) : <Badge tone="zinc">{t("own")}</Badge>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.invoices.filter((i) => i.status === "open" || i.status === "paused").length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
