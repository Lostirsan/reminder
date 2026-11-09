import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">{t("notFound")}</p>
      <Link href="/" className="mt-4 inline-block text-emerald-700 dark:text-emerald-400 hover:underline">{t("home")}</Link>
    </div>
  );
}
