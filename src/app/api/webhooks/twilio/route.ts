import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapStatus, verifySignature } from "@/lib/providers/twilio";
import { appUrl } from "@/lib/send";

// Twilio delivery status callbacks: sent → delivered → read (or failed).
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${appUrl()}/api/webhooks/twilio`;
  if (!(await verifySignature(url, params, request.headers.get("x-twilio-signature")))) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }
  const status = mapStatus(params.MessageStatus ?? "");
  if (status && params.MessageSid) {
    const db = createAdminClient();
    const update: Record<string, string> = { status };
    if (status === "failed") update.error = `Twilio ${params.ErrorCode ?? ""} ${params.ErrorMessage ?? ""}`.trim();
    // Don't move backwards (e.g. a late "sent" after "read").
    const rank = ["queued", "sent", "delivered", "read"];
    const { data: msg } = await db.from("messages").select("id, status").eq("provider", "twilio").eq("provider_id", params.MessageSid).maybeSingle();
    if (msg && (status === "failed" || rank.indexOf(status) > rank.indexOf(msg.status))) {
      await db.from("messages").update(update).eq("id", msg.id);
    }
  }
  return new NextResponse("<Response/>", { headers: { "Content-Type": "text/xml" } });
}
