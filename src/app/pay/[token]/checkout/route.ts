import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bundleByToken } from "@/lib/pay";
import { createCheckout, stripeConfigured } from "@/lib/providers/stripe";
import { appUrl, logActivity } from "@/lib/send";

// A fresh Stripe Checkout session on every click, so the link in a reminder never expires.
export async function POST(_: NextRequest, ctx: RouteContext<"/pay/[token]/checkout">) {
  const { token } = await ctx.params;
  const b = await bundleByToken(token);
  const page = `${appUrl()}/pay/${token}`;
  if (!b || !stripeConfigured()) return NextResponse.redirect(page, 303);
  if (b.invoice.status === "paid" || b.invoice.status === "cancelled") return NextResponse.redirect(page, 303);
  try {
    const s = await createCheckout({
      invoiceId: b.invoice.id,
      organizationId: b.org.id,
      amount: Number(b.invoice.amount),
      title: `${b.customer.locale === "pt" ? "Fatura" : "Invoice"} ${b.invoice.number} · ${b.org.sender_name}`,
      locale: b.customer.locale,
      successUrl: `${page}/done`,
      cancelUrl: page,
    });
    const db = createAdminClient();
    await db.from("payment_links").insert({
      organization_id: b.org.id, invoice_id: b.invoice.id, provider: "stripe", external_id: s.id, url: s.url, amount: b.invoice.amount,
    });
    await logActivity(db, b.org.id, b.invoice.id, "payment", "Customer opened the payment page");
    return NextResponse.redirect(s.url, 303);
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(`${page}?error=1`, 303);
  }
}
