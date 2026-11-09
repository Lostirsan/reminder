import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { signInWithGoogle } from "../actions";
import { Card } from "@/components/ui";
import { EmailLogin } from "./EmailLogin";

export async function generateMetadata() {
  return { title: (await getTranslations("login"))("title") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/app";
  const { user } = await getSession();
  if (user) redirect(next);
  const t = await getTranslations("login");
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("sub")}</p>
        {typeof sp.error === "string" && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{t("failed")}: {sp.error}</p>}
        <form action={signInWithGoogle} className="mt-5">
          <input type="hidden" name="next" value={next} />
          <button className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">{t("google")}</button>
        </form>
        <div className="my-5 flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
          <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" /> {t("or")} <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        </div>
        <EmailLogin next={next} labels={{
          emailPlaceholder: t("emailPlaceholder"), emailButton: t("emailButton"), codeLabel: t("codeLabel"),
          codeButton: t("codeButton"), otherEmail: t("otherEmail"),
        }} />
      </Card>
    </div>
  );
}
