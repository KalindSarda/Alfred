import { describe, expect, it } from "vitest";
import { monthlyNeededPaise, monthsLeft, needsAttention, progressPct, remainingPaise } from "../../src/domain/goals";
import { debtOutstandingAsOf, monthPoints, netWorthOf, trimLeading } from "../../src/domain/networth";

describe("goal progress", () => {
  it("is a whole percentage, capped at 100 and never negative", () => {
    expect(progressPct(0, 20_000_00)).toBe(0);
    expect(progressPct(5_000_00, 20_000_00)).toBe(25);
    expect(progressPct(19_999_99, 20_000_00)).toBe(99);
    expect(progressPct(30_000_00, 20_000_00)).toBe(100);
    expect(progressPct(-1, 20_000_00)).toBe(0);
  });

  it("remaining stops at zero", () => {
    expect(remainingPaise(5_000_00, 20_000_00)).toBe(15_000_00);
    expect(remainingPaise(25_000_00, 20_000_00)).toBe(0);
  });

  it("works out months left from the dates", () => {
    expect(monthsLeft("2026-10-27", "2026-10-27")).toBe(0);
    expect(monthsLeft("2026-10-20", "2026-10-27")).toBe(0);
    expect(monthsLeft("2026-10-28", "2026-10-27")).toBe(1);
    expect(monthsLeft("2027-01-27", "2026-10-27")).toBe(3);
  });

  it("monthly pace rounds up, and is null with no date or when reached", () => {
    expect(monthlyNeededPaise(0, 30_000_00, "2027-01-27", "2026-10-27")).toBe(10_000_00);
    expect(monthlyNeededPaise(1, 10_000_00, "2027-01-27", "2026-10-27")).toBe(333_333);
    expect(monthlyNeededPaise(0, 10_000_00, null, "2026-10-27")).toBeNull();
    expect(monthlyNeededPaise(10_000_00, 10_000_00, "2027-01-27", "2026-10-27")).toBeNull();
    // Once the date has come, all of what is left is needed now.
    expect(monthlyNeededPaise(4_000_00, 10_000_00, "2026-10-01", "2026-10-27")).toBe(6_000_00);
  });

  it("needs attention within 30 days of the date or after it, unless reached", () => {
    expect(needsAttention(0, 100, "2026-11-26", "2026-10-27")).toBe(true);
    expect(needsAttention(0, 100, "2026-11-27", "2026-10-27")).toBe(false);
    expect(needsAttention(0, 100, "2026-10-01", "2026-10-27")).toBe(true);
    expect(needsAttention(100, 100, "2026-10-01", "2026-10-27")).toBe(false);
    expect(needsAttention(0, 100, null, "2026-10-27")).toBe(false);
  });
});

describe("net worth through time", () => {
  it("lists month ends oldest first, with today closing the current month", () => {
    const points = monthPoints("2026-10-27", 3);
    expect(points).toEqual([
      { month: "2026-08", asOf: "2026-08-31" },
      { month: "2026-09", asOf: "2026-09-30" },
      { month: "2026-10", asOf: "2026-10-27" },
    ]);
    expect(monthPoints("2027-01-31", 2).map((p) => p.month)).toEqual(["2026-12", "2027-01"]);
  });

  it("counts a debt from its date, less repayments to date, and not after a write-off", () => {
    const d = { direction: "lent" as const, amountPaise: 5_000_00, date: "2026-09-10", writtenOffOn: null, payments: [{ amountPaise: 2_000_00, date: "2026-10-05" }] };
    expect(debtOutstandingAsOf(d, "2026-09-09")).toBe(0);
    expect(debtOutstandingAsOf(d, "2026-09-30")).toBe(5_000_00);
    expect(debtOutstandingAsOf(d, "2026-10-05")).toBe(3_000_00);
    expect(debtOutstandingAsOf({ ...d, writtenOffOn: "2026-10-20" }, "2026-10-19")).toBe(3_000_00);
    expect(debtOutstandingAsOf({ ...d, writtenOffOn: "2026-10-20" }, "2026-10-20")).toBe(0);
  });

  it("net worth is banks - cards - EMIs + owed to you - you owe", () => {
    expect(netWorthOf({ banksPaise: 100, cardsOwedPaise: 10, emiToComePaise: 20, owedToYouPaise: 5, youOwePaise: 3 })).toBe(72);
  });

  it("leaves out the quiet months before the first entry, keeping the latest", () => {
    const pts = monthPoints("2026-10-27", 4);
    expect(trimLeading(pts, "2026-09-15").map((p) => p.month)).toEqual(["2026-09", "2026-10"]);
    expect(trimLeading(pts, null).map((p) => p.month)).toEqual(["2026-10"]);
    expect(trimLeading(pts, "2030-01-01").map((p) => p.month)).toEqual(["2026-10"]);
  });
});
