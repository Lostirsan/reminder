import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { createOrganization } from "../actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, Field, inputClass } from "@/components/ui";

export default async function Onboarding() {
  const { supabase, user } = await getSession();
  if (!user) redirect("/login");
  const { data: org } = await supabase.from("organizations").select("id").limit(1).maybeSingle();
  if (org) redirect("/app");
  const t = await getTranslations("onboarding");
  const locale = await getLocale();
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("sub")}</p>
        <ActionForm action={createOrganization} className="mt-5 space-y-4">
          <Field label={t("name")}><input name="name" required maxLength={120} className={inputClass} /></Field>
          <Field label={t("sender")} hint={t("senderHint")}><input name="sender_name" maxLength={120} className={inputClass} /></Field>
          <Field label="NIF" hint={t("nifHint")}><input name="nif" inputMode="numeric" pattern="[0-9 ]{9,11}" className={inputClass} /></Field>
          <Field label={t("language")}>
            <select name="locale" defaultValue={locale} className={inputClass}>
              <option value="pt">Português</option>
              <option value="en">English</option>
            </select>
          </Field>
          <SubmitButton>{t("create")}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
