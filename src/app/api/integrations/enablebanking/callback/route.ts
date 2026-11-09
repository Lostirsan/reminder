import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSession } from "@/lib/providers/enablebanking";
import { saveBankSecret, syncBank } from "@/lib/banksync";
import { formatIban } from "@/lib/bank";
import { appUrl, logActivity } from "@/lib/send";

export async function GET(request: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/app/bank?${q}`);
  const sp = request.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const jar = await cookies();
  const expected = jar.get("eb_state")?.value;
  jar.delete({ name: "eb_state", path: "/api/integrations/enablebanking" });
  if (sp.get("error")) return back(`bank=error&reason=${encodeURIComponent((sp.get("error_description") || sp.get("error") || "").slice(0, 160))}`);
  if (!code || !state || state !== expected) return back("bank=error&reason=state");

  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("id").limit(1).maybeSingle();
  if (!org) return NextResponse.redirect(`${appUrl()}/onboarding`);
  const db = createAdminClient();
  try {
    const s = await createSession(code);
    if (!s.accounts?.length) return back("bank=error&reason=no_accounts");
    const bank = s.aspsp?.name ?? "Banco";
    const ibans = s.accounts.map((a) => a.account_id?.iban).filter(Boolean) as string[];
    const label = `${bank}${ibans.length ? ` · ${ibans.map((i) => `…${formatIban(i).slice(-9)}`).join(", ")}` : ""}`;
    await db.from("integrations").upsert({
      organization_id: org.id, provider: "enablebanking", status: "connected", account_label: label, last_error: null,
      last_sync_at: null, expires_at: s.access?.valid_until ?? null,
    });
    await saveBankSecret(db, org.id, { sessionId: s.session_id, accounts: s.accounts.map((a) => a.uid), bank, validUntil: s.access?.valid_until });
    await logActivity(db, org.id, null, "integration", `Bank connected: ${label}`);
  } catch (e) {
    return back(`bank=error&reason=${encodeURIComponent((e as Error).message.slice(0, 160))}`);
  }
  try { await syncBank(db, org.id, { force: true }); } catch { /* shown on the bank page */ }
  return back("bank=ok");
}
