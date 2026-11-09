import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { enableBankingConfigured, listBanks, startAuth } from "@/lib/providers/enablebanking";
import { appUrl } from "@/lib/send";

// Owner picks a bank on /app/bank → bank login (SCA in the bank app) → our callback.
export async function GET(request: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/app/bank?${q}`);
  const { user } = await getSession();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  if (!enableBankingConfigured()) return back("bank=error&reason=not_configured");
  const name = request.nextUrl.searchParams.get("bank") ?? "";
  const psuType = request.nextUrl.searchParams.get("psu") === "personal" ? "personal" : "business";
  try {
    const bank = (await listBanks("PT")).find((b) => b.name === name);
    if (!bank) return back("bank=error&reason=unknown_bank");
    const state = crypto.randomUUID();
    (await cookies()).set("eb_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/api/integrations/enablebanking" });
    return NextResponse.redirect(await startAuth({ bank, psuType, state, redirectUrl: `${appUrl()}/api/integrations/enablebanking/callback` }));
  } catch (e) {
    return back(`bank=error&reason=${encodeURIComponent((e as Error).message.slice(0, 160))}`);
  }
}
