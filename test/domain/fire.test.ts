import { describe, expect, it } from "vitest";
import { coastNumber, fireNumber, monthsToFire, progressPct, requiredSaving, sensitivity } from "../../src/domain/fire";

// No growth and no inflation: ₹10,000 a month at 4% needs ₹30,00,000.
const flat = { corpusPaise: 0, monthlySavingPaise: 1_00_000_00, stepupBp: 0, returnBp: 0, inflationBp: 0, monthlySpendPaise: 10_000_00, withdrawalRateBp: 400 };

describe("the FIRE number", () => {
  it("is a year's spending over the withdrawal rate", () => {
    expect(fireNumber(10_000_00, 400)).toBe(30_00_000_00);
    expect(fireNumber(50_000_00, 350)).toBe(Math.round((50_000_00 * 12 * 10_000) / 350));
  });

  it("measures progress against it, capped at 100", () => {
    expect(progressPct(15_00_000_00, 30_00_000_00)).toBe(50);
    expect(progressPct(40_00_000_00, 30_00_000_00)).toBe(100);
    expect(progressPct(-5, 30_00_000_00)).toBe(0);
    expect(progressPct(1, 0)).toBeNull();
  });
});

describe("monthsToFire", () => {
  it("counts the months of saving it takes with no growth", () => {
    expect(monthsToFire(flat)).toBe(30);
  });

  it("is zero when the corpus already reaches the number, and never when nothing is saved", () => {
    expect(monthsToFire({ ...flat, corpusPaise: 30_00_000_00 })).toBe(0);
    expect(monthsToFire({ ...flat, monthlySavingPaise: 0 })).toBeNull();
  });

  it("is sooner with growth, later when the target grows with inflation, and sooner with a step-up", () => {
    const grows = monthsToFire({ ...flat, returnBp: 1000 }) as number;
    expect(grows).toBeLessThan(30);
    expect(monthsToFire({ ...flat, returnBp: 1000, inflationBp: 600 }) as number).toBeGreaterThan(grows);
    expect(monthsToFire({ ...flat, stepupBp: 1000 }) as number).toBeLessThan(30);
  });

  it("is never when the money cannot keep up with a growing target", () => {
    expect(monthsToFire({ ...flat, monthlySavingPaise: 0, corpusPaise: 1_00_000_00, returnBp: 0, inflationBp: 600 })).toBeNull();
  });
});

describe("coastNumber", () => {
  it("is the target itself with no growth, and less when money grows", () => {
    expect(coastNumber(flat, 120)).toBe(30_00_000_00);
    const coast = coastNumber({ ...flat, returnBp: 1200 }, 12) as number;
    expect(coast).toBeGreaterThan(Math.round(30_00_000_00 * 0.88));
    expect(coast).toBeLessThan(Math.round(30_00_000_00 * 0.89));
  });

  it("is null with no age to reach or one that has passed", () => {
    expect(coastNumber(flat, null)).toBeNull();
    expect(coastNumber(flat, 0)).toBeNull();
  });
});

describe("requiredSaving", () => {
  it("finds the monthly saving that gets there in time", () => {
    const s = requiredSaving({ ...flat, monthlySavingPaise: 0 }, 30) as number;
    expect(s).toBeGreaterThanOrEqual(1_00_000_00);
    expect(s).toBeLessThanOrEqual(1_00_000_00 + 100);
  });

  it("is zero when the corpus will already do, and null with nothing to aim at", () => {
    expect(requiredSaving({ ...flat, corpusPaise: 30_00_000_00 }, 12)).toBe(0);
    expect(requiredSaving(flat, null)).toBeNull();
  });
});

describe("sensitivity", () => {
  it("shows what saving more, spending less and a lower return do to the date", () => {
    const base = monthsToFire({ ...flat, returnBp: 1000 });
    const [saving, spend, ret] = sensitivity({ ...flat, returnBp: 1000 }, base);
    expect(saving?.deltaMonths as number).toBeLessThan(0);
    expect(spend?.deltaMonths as number).toBeLessThan(0);
    expect(ret?.deltaMonths as number).toBeGreaterThan(0);
  });
});
