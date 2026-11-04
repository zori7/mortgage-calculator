import { describe, expect, it } from "vitest";
import { amortize, monthlyPayment } from "./amortization.js";

describe("monthlyPayment", () => {
  it("matches the textbook value for 300k @ 6% / 30y", () => {
    expect(monthlyPayment(300_000, 6, 30)).toBe(1798.65);
  });

  it("handles a 0% rate", () => {
    expect(monthlyPayment(120_000, 0, 10)).toBe(1000);
  });
});

describe("amortize", () => {
  it("pays the loan off in exactly termYears*12 months with no extra", () => {
    const { summary, schedule } = amortize({ principal: 300_000, annualRatePct: 6, termYears: 30, extraMonthly: 0 });
    expect(summary.months).toBe(360);
    expect(schedule.at(-1)?.balance).toBe(0);
    expect(summary.totalInterest).toBeCloseTo(347_514, -2);
  });

  it("extra monthly payments shorten the loan and cut interest", () => {
    const base = amortize({ principal: 300_000, annualRatePct: 6, termYears: 30, extraMonthly: 0 });
    const extra = amortize({ principal: 300_000, annualRatePct: 6, termYears: 30, extraMonthly: 500 });
    expect(extra.summary.months).toBeLessThan(base.summary.months);
    expect(extra.summary.totalInterest).toBeLessThan(base.summary.totalInterest);
  });
});
