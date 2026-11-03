// Runs against a local Supabase (npx supabase start) when INTEGRATION=1; skipped otherwise.
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { runTick } from "@/lib/scheduler";

const on = process.env.INTEGRATION === "1";
const db = on ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) : null!;

describe.skipIf(!on)("scheduler on a real database", () => {
  it("sends each due step once, only in business hours", async () => {
    const { data: org } = await db.from("organizations").insert({ name: "Tick Test", sender_name: "Tick", auto_reminders: true }).select().single();
    const day = (n: number) => new Date(Date.parse("2026-11-03") + n * 864e5).toISOString().slice(0, 10);
    for (const [i, late] of [1, 6, 30, 0].entries()) {
      const { data: c } = await db.from("customers").insert({ organization_id: org.id, name: `C${i}`, phone: "351912345678", email: "c@example.pt" }).select().single();
      await db.from("invoices").insert({ organization_id: org.id, customer_id: c.id, number: `T${i}`, amount: 100, due_date: day(-late) });
    }
    const night = await runTick(db, new Date("2026-11-03T22:00:00Z"));
    expect(night.skippedOrgs).toBeGreaterThan(0);
    const tuesday10 = new Date("2026-11-03T10:00:00Z");
    await runTick(db, tuesday10);
    await runTick(db, tuesday10); // second run must not double-send
    const { data: msgs } = await db.from("messages").select("step, channel, status, trigger").eq("organization_id", org.id);
    expect(msgs!.length).toBe(6); // 3 invoices due a step × 2 channels; due-today invoice waits
    expect(new Set(msgs!.map((m) => m.step))).toEqual(new Set(["d1", "d5", "firm"]));
    expect(msgs!.every((m) => m.status === "simulated" && m.trigger === "auto")).toBe(true);
    await db.from("organizations").delete().eq("id", org.id);
  });
});
