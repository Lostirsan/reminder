import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { buttonClass, Card } from "@/components/ui";

export default async function Home({ searchParams }: PageProps<"/">) {
  // If Supabase falls back to the site URL after a sign-in link, finish the sign-in.
  const code = (await searchParams).code;
  if (typeof code === "string") redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  const { user } = await getSession();
  if (user) redirect("/app");
  const t = await getTranslations("home");
  const steps = ["s1", "s2", "s3"] as const;
  return (
    <div className="space-y-12">
      <section className="mx-auto max-w-3xl pt-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 text-lg text-zinc-600">{t("subtitle")}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login" className={buttonClass.primary}>{t("cta")}</Link>
        </div>
        <p className="mt-3 text-sm text-zinc-500">{t("free")}</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <Card key={s}>
            <div className="text-sm font-semibold text-emerald-700">{i + 1}</div>
            <h2 className="mt-1 font-semibold">{t(`${s}.title`)}</h2>
            <p className="mt-1 text-sm text-zinc-600">{t(`${s}.text`)}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
