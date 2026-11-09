import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bundleByToken } from "@/lib/pay";
import { appUrl, logActivity } from "@/lib/send";

// "Já paguei": the customer says they paid by transfer. Reminders stop until the owner confirms
// (or the payment shows up in the bank and closes the invoice by itself).
export async function POST(_: NextRequest, ctx: RouteContext<"/pay/[token]/claim">) {
  const { token } = await ctx.params;
  const b = await bundleByToken(token);
  if (b && (b.invoice.status === "open" || b.invoice.status === "paused")) {
    const db = createAdminClient();
    const { data } = await db.from("invoices").update({ payer_claimed_at: new Date().toISOString() })
      .eq("id", b.invoice.id).is("payer_claimed_at", null).select("id");
    if (data?.length) await logActivity(db, b.org.id, b.invoice.id, "claim", "Customer says it is paid (\"Já paguei\"). Reminders stop until you confirm.");
  }
  return NextResponse.redirect(`${appUrl()}/pay/${token}?claimed=1`, 303);
}
