import { describe, expect, it } from "vitest";
import { autoStepFor, composeMessage, daysLate, inSendWindow, lateInterest, normalizePhone, stepFor, todayIn } from "@/lib/reminders";

describe("ladder", () => {
  it("manual step by days late", () => {
    expect([-5, 0, 1, 4, 5, 10, 11, 60].map(stepFor)).toEqual(["pre", "d1", "d1", "d1", "d5", "d5", "firm", "firm"]);
  });
  it("auto step: 1–3 days before, nothing on the due date or earlier", () => {
    expect([-10, -4, -3, -1, 0, 1, 5, 11].map(autoStepFor)).toEqual([null, null, "pre", "pre", null, "d1", "d5", "firm"]);
  });
});

describe("dates", () => {
  it("days late across DST and in Lisbon", () => {
    expect(daysLate("2026-10-20", "2026-11-03")).toBe(14);
    expect(todayIn("Europe/Lisbon", new Date("2026-11-02T23:30:00Z"))).toBe("2026-11-02");
    expect(todayIn("Europe/Lisbon", new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02"); // WEST = UTC+1
  });
  it("send window: weekdays 9–19 Lisbon", () => {
    expect(inSendWindow("Europe/Lisbon", new Date("2026-11-03T09:00:00Z"))).toBe(true); // Tue 09:00
    expect(inSendWindow("Europe/Lisbon", new Date("2026-11-03T08:59:00Z"))).toBe(false);
    expect(inSendWindow("Europe/Lisbon", new Date("2026-11-03T19:00:00Z"))).toBe(false);
    expect(inSendWindow("Europe/Lisbon", new Date("2026-11-07T12:00:00Z"))).toBe(false); // Saturday
    expect(inSendWindow("Europe/Lisbon", new Date("2026-07-01T08:30:00Z"))).toBe(true); // 09:30 summer time
  });
});

describe("late interest (DL 62/2013)", () => {
  it("rate × days / 365 plus 40 € once late", () => {
    expect(lateInterest(1000, 36.5, 10)).toEqual({ interest: 10, compensation: 40, total: 50 });
    expect(lateInterest(1000, 0, 10.4)).toEqual({ interest: 0, compensation: 0, total: 0 });
  });
});

describe("messages", () => {
  const base = {
    contactName: "Rui", invoiceNumber: "FT 2026/131", amount: 380, dueDate: "2026-10-01", days: 33,
    payUrl: "https://app.example/pay/abc", senderName: "Distribuidora", mentionInterest: true, interestRate: 10.4,
  };
  it("firm PT mentions the decree, interest and the pay link", () => {
    const m = composeMessage({ ...base, locale: "pt", step: "firm" });
    expect(m.text).toContain("Decreto-Lei n.º 62/2013");
    expect(m.text).toContain("3,57 €");
    expect(m.text).toContain("https://app.example/pay/abc");
    expect(m.text).toContain("01/10/2026");
    expect(m.text.trim().endsWith("Distribuidora")).toBe(true);
    expect(m.params).toEqual(["Rui", "FT 2026/131", "380,00 €", "01/10/2026", "https://app.example/pay/abc", "Distribuidora"]);
  });
  it("EN without interest mention", () => {
    const m = composeMessage({ ...base, locale: "en", step: "firm", mentionInterest: false });
    expect(m.text).toContain("overdue since 01/10/2026 (33 days)");
    expect(m.text).not.toContain("Decree");
    expect(m.subject).toBe("Invoice FT 2026/131 · Distribuidora");
  });
  it("thank-you has no pay link", () => {
    expect(composeMessage({ ...base, locale: "pt", step: "thanks" }).text).not.toContain("http");
  });
});

describe("phones", () => {
  it("normalises Portuguese numbers", () => {
    expect(normalizePhone("912 345 678")).toBe("351912345678");
    expect(normalizePhone("+351 912-345-678")).toBe("351912345678");
    expect(normalizePhone("00351912345678")).toBe("351912345678");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});
