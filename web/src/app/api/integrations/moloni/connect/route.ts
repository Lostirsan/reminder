import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { authorizeUrl, moloniConfigured } from "@/lib/providers/moloni";
import { appUrl } from "@/lib/send";

export async function GET() {
  const { user } = await getSession();
  if (!user) return NextResponse.redirect(`${appUrl()}/login`);
  if (!moloniConfigured()) return NextResponse.redirect(`${appUrl()}/app/settings?moloni=error&reason=not_configured`);
  const state = crypto.randomUUID();
  (await cookies()).set("moloni_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/integrations/moloni" });
  return NextResponse.redirect(authorizeUrl(`${appUrl()}/api/integrations/moloni/callback`, state));
}
