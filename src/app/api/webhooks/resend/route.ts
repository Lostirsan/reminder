import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapEvent, verifyWebhook } from "@/lib/providers/resend";
import { logActivity } from "@/lib/send";

// Resend delivery events (Svix-signed): delivered, bounced, complained, failed (opened if tracking is on).
export async function POST(request: NextRequest) {
  const body = await request.text();
  const ok = await verifyWebhook(body, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 403 });

  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string; bounce?: { message?: string; type?: string } } };
  const status = mapEvent(event.type ?? "");
  const emailId = event.data?.email_id;
  if (!status || !emailId) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  const { data: msg } = await db.from("messages").select("id, status, organization_id, invoice_id, recipient")
    .eq("provider", "resend").eq("provider_id", emailId).maybeSingle();
  if (!msg) return NextResponse.json({ ok: true });

  const rank = ["queued", "sent", "delivered", "read"];
  if (status === "failed") {
    const reason = event.type === "email.complained" ? "marked as spam" : event.data?.bounce?.message || event.type!.replace("email.", "");
    await db.from("messages").update({ status, error: `Resend: ${reason}`.slice(0, 500) }).eq("id", msg.id);
    // Tell the owner on the invoice timeline, so they can fix the address or call the customer.
    await logActivity(db, msg.organization_id, msg.invoice_id, "error", `Email → ${msg.recipient}: ${reason}`);
  } else if (rank.indexOf(status) > rank.indexOf(msg.status)) {
    await db.from("messages").update({ status }).eq("id", msg.id);
  }
  return NextResponse.json({ ok: true });
}
