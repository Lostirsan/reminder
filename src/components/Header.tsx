import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { setLocale } from "@/app/actions";
import { ThemeToggle } from "./ThemeToggle";

export async function Header() {
  const { user } = await getSession();
  const t = await getTranslations("nav");
  const locale = await getLocale();
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href={user ? "/app" : "/"} className="text-lg font-bold tracking-tight text-emerald-800 dark:text-emerald-300">
          Pago a Tempo
        </Link>
        {user && (
          <nav className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/app" className="hover:text-zinc-900 dark:hover:text-zinc-100">{t("invoices")}</Link>
            <Link href="/app/customers" className="hover:text-zinc-900 dark:hover:text-zinc-100">{t("customers")}</Link>
            <Link href="/app/invoices/new" className="hover:text-zinc-900 dark:hover:text-zinc-100">{t("add")}</Link>
            <Link href="/app/bank" className="hover:text-zinc-900 dark:hover:text-zinc-100">{t("bank")}</Link>
            <Link href="/app/settings" className="hover:text-zinc-900 dark:hover:text-zinc-100">{t("settings")}</Link>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <ThemeToggle labels={{ light: t("themeLight"), system: t("themeSystem"), dark: t("themeDark") }} />
          <form action={setLocale} className="flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {(["pt", "en"] as const).map((l) => (
              <button key={l} name="locale" value={l}
                className={`px-2 py-1 text-xs font-semibold uppercase ${l === locale ? "bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 text-white" : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}>
                {l}
              </button>
            ))}
          </form>
          {user ? (
            <form action="/auth/signout" method="post">
              <button className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">{t("signOut")}</button>
            </form>
          ) : (
            <Link href="/login" className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800">{t("signIn")}</Link>
          )}
        </div>
      </div>
    </header>
  );
}
