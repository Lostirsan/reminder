import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { signInWithGoogle, signInWithEmail } from "../actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";

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
        <p className="mt-1 text-sm text-zinc-600">{t("sub")}</p>
        {typeof sp.error === "string" && <p className="mt-3 text-sm text-red-600">{t("failed")}: {sp.error}</p>}
        <form action={signInWithGoogle} className="mt-5">
          <input type="hidden" name="next" value={next} />
          <button className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50">{t("google")}</button>
        </form>
        <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" /> {t("or")} <span className="h-px flex-1 bg-zinc-200" />
        </div>
        <ActionForm action={signInWithEmail} className="space-y-3">
          <input name="email" type="email" required placeholder={t("emailPlaceholder")} className={inputClass} />
          <SubmitButton>{t("emailButton")}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
