import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { Bundle } from "./send";
import type { Customer, Invoice, Organization } from "./types";

/** Public lookup by the secret token in the pay link. */
export async function bundleByToken(token: string): Promise<Bundle | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db.from("invoices").select("*, customer:customers(*), org:organizations(*)").eq("pay_token", token).maybeSingle();
  if (!data) return null;
  const { customer, org, ...invoice } = data as Invoice & { customer: Customer; org: Organization };
  return { org, customer, invoice };
}

export const demoPaymentsAllowed = () => process.env.ALLOW_DEMO_PAYMENTS === "1";
