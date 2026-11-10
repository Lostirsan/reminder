import { getTranslations } from "next-intl/server";
import { updateCustomer } from "@/app/actions";
import { ActionForm, SubmitButton } from "./ActionForm";
import { Field, inputClass } from "./ui";
import type { Customer } from "@/lib/types";

/** Contacts used for reminders; for Moloni customers it says whether they come from Moloni or are the owner's own. */
export async function CustomerForm({ customer }: { customer: Customer }) {
  const t = await getTranslations("invoice");
  return (
    <ActionForm action={updateCustomer} className="mt-3 space-y-3">
      <input type="hidden" name="customer_id" value={customer.id} />
      {customer.source === "moloni" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{customer.contacts_custom ? t("contactsCustom") : t("contactsMoloni")}</p>
      )}
      <Field label={t("contactName")}><input name="contact_name" defaultValue={customer.contact_name ?? ""} className={inputClass} /></Field>
      <Field label={t("phone")}><input name="phone" type="tel" defaultValue={customer.phone ? `+${customer.phone}` : ""} className={inputClass} /></Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="whatsapp_opt_in" defaultChecked={customer.whatsapp_opt_in} className="mt-1 h-4 w-4 accent-emerald-700 dark:accent-emerald-500" />
        <span>{t("optIn")}</span>
      </label>
      <Field label="Email"><input name="email" type="email" defaultValue={customer.email ?? ""} className={inputClass} /></Field>
      <Field label={t("language")}>
        <select name="locale" defaultValue={customer.locale} className={inputClass}>
          <option value="pt">Português</option>
          <option value="en">English</option>
        </select>
      </Field>
      <SubmitButton variant="secondary">{t("saveCustomer")}</SubmitButton>
    </ActionForm>
  );
}
