import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bundleByToken, demoPaymentsAllowed } from "@/lib/pay";
import { stripeConfigured } from "@/lib/providers/stripe";
import { appUrl, markPaid } from "@/lib/send";

// Demo only (ALLOW_DEMO_PAYMENTS=1 and no Stripe key): pretend the customer paid.
export async function POST(_: NextRequest, ctx: RouteContext<"/pay/[token]/demo">) {
  const { token } = await ctx.params;
  const b = await bundleByToken(token);
  if (b && demoPaymentsAllowed() && !stripeConfigured()) await markPaid(createAdminClient(), b, "Simulated payment (demo)");
  return NextResponse.redirect(`${appUrl()}/pay/${token}/done`, 303);
}
