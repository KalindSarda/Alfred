import { describe, expect, it } from "vitest";
import { levelEmi, simulatePrepayment } from "../../src/domain/loans";

const P = 10_00_000_00;
const EMI = levelEmi(P, 900, 120);
const base = { outstandingPaise: P, ratePctBp: 900, emiPaise: EMI, firstDue: "2026-11-05", dueDay: 5, amountPaise: 1_00_000_00 } as const;

describe("simulatePrepayment", () => {
  it("shortening keeps the EMI and ends sooner, saving interest", () => {
    const s = simulatePrepayment({ ...base, effect: "shorten" });
    expect(s.before.months).toBe(120);
    expect(s.after.emiPaise).toBe(EMI);
    expect(s.after.months).toBeLessThan(120);
    expect(s.monthsSaved).toBe(120 - s.after.months);
    expect(s.monthsSaved).toBeGreaterThan(10);
    expect(s.interestSavedPaise).toBeGreaterThan(0);
    expect(s.after.lastDate! < s.before.lastDate!).toBe(true);
  });

  it("lowering keeps the end date and the EMI falls", () => {
    const s = simulatePrepayment({ ...base, effect: "lower" });
    expect(s.after.months).toBe(120);
    expect(s.monthsSaved).toBe(0);
    expect(s.after.emiPaise).toBeLessThan(EMI);
    expect(s.interestSavedPaise).toBeGreaterThan(0);
    expect(s.after.lastDate).toBe(s.before.lastDate);
  });

  it("shortening saves more interest than lowering for the same money", () => {
    const shorten = simulatePrepayment({ ...base, effect: "shorten" });
    const lower = simulatePrepayment({ ...base, effect: "lower" });
    expect(shorten.interestSavedPaise).toBeGreaterThan(lower.interestSavedPaise);
  });

  it("paying everything clears the loan", () => {
    const s = simulatePrepayment({ ...base, amountPaise: P, effect: "shorten" });
    expect(s.after).toEqual({ months: 0, interestPaise: 0, emiPaise: 0, lastDate: null });
    expect(s.monthsSaved).toBe(120);
    expect(s.interestSavedPaise).toBe(s.before.interestPaise);
  });

  it("compares the same money invested at a stated return, only when one is given", () => {
    expect(simulatePrepayment({ ...base, effect: "shorten" }).invest).toBeNull();
    const s = simulatePrepayment({ ...base, effect: "shorten", returnPct: 12 });
    expect(s.invest).toMatchObject({ returnPct: 12, months: 120 });
    // 1,00,000 at 1% a month for 120 months grows about 2.3 times: a gain of roughly 2,30,000.
    expect(s.invest!.gainPaise).toBeGreaterThan(2_20_000_00);
    expect(s.invest!.gainPaise).toBeLessThan(2_40_000_00);
    expect(simulatePrepayment({ ...base, effect: "shorten", returnPct: 0 }).invest).toBeNull();
  });
});
