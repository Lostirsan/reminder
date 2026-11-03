import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";
import { runTick } from "@/lib/scheduler";

// Called every 15 minutes by pg_cron in Supabase (see supabase/migrations/*_cron.sql).
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await runTick(createAdminClient());
  return NextResponse.json(report);
}
