import { getTranslations } from "next-intl/server";
import { requireOrg } from "@/lib/auth";
import { addInvoice } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Card, Field, inputClass, PageTitle } from "@/components/ui";

export default async function NewInvoice() {
  const { org } = await requireOrg();
  const t = await getTranslations("newInvoice");
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle sub={t("sub")}>{t("title")}</PageTitle>
      <Card>
        <ActionForm action={addInvoice} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 text-sm font-semibold text-zinc-700">{t("customer")}</div>
          <Field label={t("customerName")}><input name="customer" required className={inputClass} /></Field>
          <Field label={t("contactName")}><input name="contact_name" className={inputClass} /></Field>
          <Field label={t("phone")} hint={t("phoneHint")}><input name="phone" type="tel" placeholder="912 345 678" className={inputClass} /></Field>
          <Field label="Email"><input name="email" type="email" className={inputClass} /></Field>
          <Field label={t("customerLanguage")}>
            <select name="customer_locale" defaultValue={org.locale} className={inputClass}>
              <option value="pt">Português</option>
              <option value="en">English</option>
            </select>
          </Field>
          <div className="sm:col-span-2 mt-2 text-sm font-semibold text-zinc-700">{t("invoice")}</div>
          <Field label={t("number")}><input name="number" required placeholder="FT 2026/123" className={inputClass} /></Field>
          <Field label={t("amount")}><input name="amount" required inputMode="decimal" placeholder="250,00" className={inputClass} /></Field>
          <Field label={t("due")}><input name="due_date" type="date" required className={inputClass} /></Field>
          <div className="sm:col-span-2"><SubmitButton>{t("save")}</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );
}
