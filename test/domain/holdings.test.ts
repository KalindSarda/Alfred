import { describe, expect, it } from "vitest";
import { gainPaise, gainPct, type HoldingFacts, investedPaise, latestValue, soldPaise, staleDays, valuePaise } from "../../src/domain/holdings";

const facts = (over: Partial<HoldingFacts> = {}): HoldingFacts => ({ openingInvestedPaise: 0, purchases: [], sales: [], values: [], ...over });

describe("what was put in and taken out", () => {
  it("adds the opening amount to the purchases, up to a day", () => {
    const f = facts({ openingInvestedPaise: 10_000_00, purchases: [{ date: "2026-09-01", amountPaise: 5_000_00 }, { date: "2026-11-01", amountPaise: 2_000_00 }] });
    expect(investedPaise(f)).toBe(17_000_00);
    expect(investedPaise(f, "2026-10-01")).toBe(15_000_00);
    expect(investedPaise(f, "2026-08-31")).toBe(10_000_00);
  });

  it("adds up sales", () => {
    const f = facts({ sales: [{ date: "2026-10-01", amountPaise: 3_000_00 }, { date: "2026-10-05", amountPaise: 1_000_00 }] });
    expect(soldPaise(f)).toBe(4_000_00);
    expect(soldPaise(f, "2026-10-01")).toBe(3_000_00);
  });
});

describe("what it is worth", () => {
  it("is the cost until a value is typed", () => {
    const f = facts({ openingInvestedPaise: 10_000_00, purchases: [{ date: "2026-09-01", amountPaise: 5_000_00 }], sales: [{ date: "2026-10-01", amountPaise: 3_000_00 }] });
    expect(valuePaise(f)).toBe(12_000_00);
    expect(gainPaise(f)).toBe(0 + 3_000_00 - 15_000_00 + 12_000_00);
  });

  it("is the latest value typed on or before the day", () => {
    const f = facts({ values: [{ date: "2026-09-01", valuePaise: 10_000_00 }, { date: "2026-10-01", valuePaise: 12_000_00 }] });
    expect(valuePaise(f)).toBe(12_000_00);
    expect(valuePaise(f, "2026-09-30")).toBe(10_000_00);
    expect(valuePaise(f, "2026-08-31")).toBe(0);
    expect(latestValue(f, "2026-09-15")).toEqual({ date: "2026-09-01", valuePaise: 10_000_00 });
  });

  it("moves with buying and selling after the latest value, not before or on its day", () => {
    const f = facts({
      values: [{ date: "2026-10-01", valuePaise: 12_000_00 }],
      purchases: [{ date: "2026-09-20", amountPaise: 1_000_00 }, { date: "2026-10-01", amountPaise: 500_00 }, { date: "2026-10-10", amountPaise: 2_000_00 }],
      sales: [{ date: "2026-10-15", amountPaise: 3_000_00 }],
    });
    expect(valuePaise(f)).toBe(12_000_00 + 2_000_00 - 3_000_00);
    expect(valuePaise(f, "2026-10-12")).toBe(14_000_00);
    expect(valuePaise(f, "2026-10-01")).toBe(12_000_00);
  });

  it("is never below nothing", () => {
    const f = facts({ values: [{ date: "2026-10-01", valuePaise: 1_000_00 }], sales: [{ date: "2026-10-05", amountPaise: 5_000_00 }] });
    expect(valuePaise(f)).toBe(0);
  });

  it("is zero once closed out with a zero value", () => {
    const f = facts({ values: [{ date: "2026-10-01", valuePaise: 12_000_00 }, { date: "2026-10-20", valuePaise: 0 }], sales: [{ date: "2026-10-20", amountPaise: 12_500_00 }] });
    expect(valuePaise(f)).toBe(0);
    expect(valuePaise(f, "2026-10-19")).toBe(12_000_00);
  });
});

describe("the gain", () => {
  it("is value plus sold less invested, as a percentage of what went in", () => {
    const f = facts({ openingInvestedPaise: 10_000_00, values: [{ date: "2026-10-01", valuePaise: 12_500_00 }] });
    expect(gainPaise(f)).toBe(2_500_00);
    expect(gainPct(f)).toBe(25);
  });

  it("works for a holding that was sold out", () => {
    const f = facts({ openingInvestedPaise: 10_000_00, values: [{ date: "2026-10-20", valuePaise: 0 }], sales: [{ date: "2026-10-20", amountPaise: 11_000_00 }] });
    expect(gainPaise(f)).toBe(1_000_00);
    expect(gainPct(f)).toBe(10);
  });

  it("can be a loss, and has no percentage when nothing went in", () => {
    const f = facts({ openingInvestedPaise: 10_000_00, values: [{ date: "2026-10-01", valuePaise: 8_000_00 }] });
    expect(gainPaise(f)).toBe(-2_000_00);
    expect(gainPct(f)).toBe(-20);
    expect(gainPct(facts())).toBeNull();
  });

  it("rounds the percentage to one decimal", () => {
    const f = facts({ openingInvestedPaise: 3_000_00, values: [{ date: "2026-10-01", valuePaise: 3_100_00 }] });
    expect(gainPct(f)).toBe(3.3);
  });
});

describe("how stale a value is", () => {
  it("counts days since it was typed, and is null when never", () => {
    const f = facts({ values: [{ date: "2026-09-27", valuePaise: 100 }] });
    expect(staleDays(f, "2026-10-27")).toBe(30);
    expect(staleDays(f, "2026-09-27")).toBe(0);
    expect(staleDays(facts(), "2026-10-27")).toBeNull();
  });
});
