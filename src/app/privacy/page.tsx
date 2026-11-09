import { getTranslations } from "next-intl/server";
import { Card, PageTitle } from "@/components/ui";

export default async function Privacy() {
  const t = await getTranslations("privacy");
  const sections = ["who", "data", "why", "where", "keep", "rights"] as const;
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle sub={t("draft")}>{t("title")}</PageTitle>
      <Card className="space-y-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {sections.map((s) => (
          <section key={s}>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{t(`${s}.h`)}</h2>
            <p className="mt-1">{t(`${s}.p`)}</p>
          </section>
        ))}
      </Card>
    </div>
  );
}
