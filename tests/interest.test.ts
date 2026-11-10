import { describe, expect, it } from "vitest";
import { interestRateOf, legalRate } from "@/lib/interest";

describe("late interest rate", () => {
  it("uses the legal rate of the current semester", () => {
    expect(legalRate("2026-11-10").rate).toBe(10.4);
  });
  it("uses a contractual rate only when set", () => {
    expect(interestRateOf({ late_interest_custom: false, late_interest_rate: 15 })).toBe(legalRate().rate);
    expect(interestRateOf({ late_interest_custom: true, late_interest_rate: "12.5" })).toBe(12.5);
  });
});
