import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, moloniClient } from "@/lib/providers/moloni";
import { appUrl, logActivity } from "@/lib/send";
import { saveMoloniTokens, syncMoloni } from "@/lib/sync";

export async function GET(request: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/app/settings?${q}#integrations`);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("moloni_state")?.value;
  jar.delete({ name: "moloni_state", path: "/api/integrations/moloni" });
  if (!code || !state || state !== expected) return back("moloni=error&reason=state");

  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id").limit(1).maybeSingle();
  if (!org) return NextResponse.redirect(`${appUrl()}/onboarding`);
  const db = createAdminClient();
  try {
    const tokens = await exchangeCode(code, `${appUrl()}/api/integrations/moloni/callback`);
    const companies = await moloniClient(tokens, async () => {}).companies();
    // One company: use it. Several (e.g. own company + "Empresa Demonstração"): the owner picks on the settings page.
    const only = companies.length === 1 ? companies[0] : null;
    await db.from("integrations").upsert({
      organization_id: org.id, provider: "moloni", status: "connected", account_label: only?.name ?? null, last_error: null,
    });
    await saveMoloniTokens(db, org.id, { ...tokens, companies, companyId: only?.id, companyName: only?.name });
    await logActivity(db, org.id, null, "integration", `Moloni connected${only ? `: ${only.name}` : ""}`);
    if (!only) return back("moloni=pick");
  } catch (e) {
    return back(`moloni=error&reason=${encodeURIComponent((e as Error).message.slice(0, 120))}`);
  }
  try { await syncMoloni(db, org.id); } catch { /* shown on the settings page */ }
  return back("moloni=ok");
}
