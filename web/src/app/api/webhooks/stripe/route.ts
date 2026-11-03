import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhook } from "@/lib/providers/stripe";
import { loadBundle, logActivity, markPaid } from "@/lib/send";

// Stripe → invoice paid. Multibanco and MB WAY can settle later than checkout, so both
// checkout.session.completed (when already paid) and async_payment_succeeded count.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 500 });
  const payload = await request.text();
  let event;
  try {
    event = await verifyWebhook(payload, request.headers.get("stripe-signature"), secret);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const s = event.data.object;
  const invoiceId = s.metadata?.invoice_id;
  const orgId = s.metadata?.organization_id;
  if (!invoiceId || !orgId) return NextResponse.json({ ignored: true });
  const db = createAdminClient();

  const paid = (event.type === "checkout.session.completed" && s.payment_status === "paid") || event.type === "checkout.session.async_payment_succeeded";
  const failed = event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired";
  if (paid) {
    await db.from("payment_links").update({ status: "paid" }).eq("provider", "stripe").eq("external_id", s.id);
    const b = await loadBundle(db, orgId, invoiceId);
    if (b) await markPaid(db, b, `Paid via Stripe (${s.id})`);
  } else if (failed) {
    await db.from("payment_links").update({ status: event.type === "checkout.session.expired" ? "expired" : "failed" }).eq("provider", "stripe").eq("external_id", s.id);
    if (event.type === "checkout.session.async_payment_failed") await logActivity(db, orgId, invoiceId, "payment", "Stripe payment failed");
  }
  return NextResponse.json({ received: true });
}
