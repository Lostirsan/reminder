import { getTranslations } from "next-intl/server";
import { Badge } from "./ui";
import type { InvoiceStatus } from "@/lib/types";

export async function StatusBadge({ status, days }: { status: InvoiceStatus; days: number }) {
  const t = await getTranslations("status");
  if (status === "paid") return <Badge tone="green">{t("paid")}</Badge>;
  if (status === "paused") return <Badge tone="zinc">{t("paused")}</Badge>;
  if (status === "cancelled") return <Badge tone="zinc">{t("cancelled")}</Badge>;
  if (days > 10) return <Badge tone="red">{t("late", { days })}</Badge>;
  if (days > 0) return <Badge tone="amber">{t("late", { days })}</Badge>;
  if (days === 0) return <Badge tone="amber">{t("dueToday")}</Badge>;
  return <Badge tone="sky">{t("dueIn", { days: -days })}</Badge>;
}
