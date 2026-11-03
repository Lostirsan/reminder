import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBundle, whatsappLink } from "@/lib/send";

// Logs the reminder and opens the owner's own WhatsApp with the text prefilled.
export async function GET(request: NextRequest, ctx: RouteContext<"/app/invoices/[id]/walink">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("id, organization_id").eq("id", id).maybeSingle();
  if (!inv) return NextResponse.redirect(new URL("/app", request.url));
  const admin = createAdminClient();
  const b = await loadBundle(admin, inv.organization_id, inv.id);
  if (!b) return NextResponse.redirect(new URL("/app", request.url));
  try {
    return NextResponse.redirect(await whatsappLink(admin, b));
  } catch {
    return NextResponse.redirect(new URL(`/app/invoices/${id}`, request.url));
  }
}
