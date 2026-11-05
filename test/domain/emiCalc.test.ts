import { describe, expect, it } from "vitest";
import { calcSchedule, feeWithGst, scheduleTotals } from "../../src/domain/emiCalc";

describe("the EMI calculator", () => {
  it("reproduces the bank's own figure: 1,17,455.45 at 16% for 6 months is about 20,499.7 a month", () => {
    const rows = calcSchedule({ principalPaise: 11_745_545, annualRatePct: 16, months: 6 });
    expect(rows).toHaveLength(6);
    // HDFC's later instalments on that statement averaged 20,499.69: the formula lands within a rupee.
    for (const r of rows.slice(0, 5)) expect(Math.abs(r.instalmentPaise - 2_049_969)).toBeLessThanOrEqual(100);
    // The first month's interest at a full month's 16% is 1,566, and the principal part follows.
    expect(rows[0]!.interestPaise).toBe(156_607);
    expect(rows[0]!.instalmentPaise).toBe(rows[0]!.principalPaise + rows[0]!.interestPaise);
  });

  it("clears the principal exactly and adds up", () => {
    for (const [p, rate, n] of [[11_745_545, 16, 6], [5_000_000, 14, 12], [12_345_67, 18.5, 24], [100_00, 12, 3], [9_999_999_99, 15, 60]] as const) {
      const rows = calcSchedule({ principalPaise: p, annualRatePct: rate, months: n });
      expect(rows.reduce((s, r) => s + r.principalPaise, 0)).toBe(p);
      const t = scheduleTotals(rows);
      expect(t.payablePaise).toBe(p + t.interestPaise + t.gstPaise);
      expect(rows.every((r) => r.instalmentPaise > 0 && r.principalPaise >= 0), `${p}/${rate}/${n}`).toBe(true);
    }
  });

  it("splits evenly at 0% with the remainder on the last month", () => {
    const rows = calcSchedule({ principalPaise: 1_000_00, annualRatePct: 0, months: 3 });
    expect(rows.map((r) => r.instalmentPaise)).toEqual([33333, 33333, 33334]);
    expect(rows.every((r) => r.interestPaise === 0 && r.gstPaise === 0)).toBe(true);
  });

  it("handles a single month", () => {
    const [row] = calcSchedule({ principalPaise: 100_000, annualRatePct: 12, months: 1 });
    expect(row).toMatchObject({ n: 1, principalPaise: 100_000, interestPaise: 1_000, instalmentPaise: 101_000 });
  });

  it("adds GST on the interest only when asked", () => {
    const off = calcSchedule({ principalPaise: 11_745_545, annualRatePct: 16, months: 6, gstPct: 18 });
    expect(scheduleTotals(off).gstPaise).toBe(0);
    const on = calcSchedule({ principalPaise: 11_745_545, annualRatePct: 16, months: 6, gstPct: 18, gstOnInterest: true });
    const t = scheduleTotals(on);
    expect(t.gstPaise).toBeGreaterThan(0);
    expect(Math.abs(t.gstPaise - Math.round(t.interestPaise * 0.18))).toBeLessThanOrEqual(3);
    expect(on[0]!.gstPaise).toBe(Math.round(on[0]!.interestPaise * 0.18));
    expect(on[0]!.instalmentPaise).toBe(on[0]!.principalPaise + on[0]!.interestPaise + on[0]!.gstPaise);
  });

  it("refuses nonsense", () => {
    expect(calcSchedule({ principalPaise: 0, annualRatePct: 12, months: 6 })).toEqual([]);
    expect(calcSchedule({ principalPaise: 1000, annualRatePct: -1, months: 6 })).toEqual([]);
    expect(calcSchedule({ principalPaise: 1000, annualRatePct: 12, months: 0 })).toEqual([]);
    expect(calcSchedule({ principalPaise: 1000, annualRatePct: 12, months: 2.5 })).toEqual([]);
  });

  it("works out a fee with GST: 299 at 18% is 352.82", () => {
    expect(feeWithGst(29_900, 18)).toBe(35_282);
    expect(feeWithGst(29_900, 0)).toBe(29_900);
  });
});
