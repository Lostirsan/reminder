import { describe, expect, it } from "vitest";
import { planReminders } from "@/lib/scheduler";
import type { Customer, Invoice, Organization } from "@/lib/types";

const org = { id: "o", timezone: "Europe/Lisbon", channel_whatsapp: true, channel_email: true } as Organization;
const now = new Date("2026-11-03T10:00:00Z");
const cust = (over: Partial<Customer> = {}) => ({ id: "c", phone: "351912345678", email: "a@b.pt", ...over }) as Customer;
const inv = (id: string, due: string, over: Partial<Invoice> = {}, c = cust()) =>
  ({ id, due_date: due, status: "open", ...over, customer: c }) as Invoice & { customer: Customer };

describe("planReminders", () => {
  it("picks the step for today and both channels", () => {
    const p = planReminders(org, [inv("a", "2026-11-02"), inv("b", "2026-10-29"), inv("c", "2026-10-01"), inv("d", "2026-11-05"), inv("e", "2026-11-03")], [], now);
    expect(p.map((x) => [x.invoice.id, x.step, x.channels.join("+")])).toEqual([
      ["a", "d1", "whatsapp+email"], ["b", "d5", "whatsapp+email"], ["c", "firm", "whatsapp+email"], ["d", "pre", "whatsapp+email"],
    ]);
  });
  it("skips paused, already-sent and recently-contacted invoices; never goes back down", () => {
    const sent = [
      { invoice_id: "b", step: "d5" as const, created_at: "2026-10-20T10:00:00Z" },
      { invoice_id: "c", step: "d1" as const, created_at: "2026-11-02T10:00:00Z" },
      { invoice_id: "f", step: "firm" as const, created_at: "2026-10-01T10:00:00Z" },
    ];
    const p = planReminders(org, [inv("a", "2026-11-02", { status: "paused" }), inv("b", "2026-10-29"), inv("c", "2026-10-01"), inv("f", "2026-10-29")], sent, now);
    expect(p).toEqual([]);
  });
  it("uses only channels with contact data and enabled", () => {
    const p = planReminders({ ...org, channel_email: false }, [inv("a", "2026-11-02", {}, cust({ phone: null })), inv("b", "2026-11-02")], [], now);
    expect(p.map((x) => [x.invoice.id, x.channels])).toEqual([["b", ["whatsapp"]]]);
  });
});
