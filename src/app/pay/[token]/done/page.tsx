import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { bundleByToken } from "@/lib/pay";
import { Card } from "@/components/ui";

export const metadata = { robots: { index: false } };

export default async function Done({ params }: PageProps<"/pay/[token]/done">) {
  const { token } = await params;
  const b = await bundleByToken(token);
  if (!b) notFound();
  const t = await getTranslations({ locale: b.customer.locale, namespace: "pay" });
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-bold">{t("thanksTitle")}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">{b.invoice.status === "paid" ? t("thanksPaid") : t("thanksPending")}</p>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{b.org.sender_name}</p>
      </Card>
    </div>
  );
}
