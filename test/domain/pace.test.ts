import { describe, expect, it } from "vitest";
import { monthsToClose, paceFromCycles, paceFromWindow, surplusOf } from "../../src/domain/pace";

const month = (income: number, spent: number, invested = 0, principal = 0) => ({ incomePaise: income * 100, spentPaise: spent * 100, investedPaise: invested * 100, principalRepaidPaise: principal * 100 });

describe("surplusOf", () => {
  it("is what is left after spending, investing and loan principal", () => {
    expect(surplusOf(month(100_000, 60_000, 10_000, 5_000))).toBe(25_000_00);
    expect(surplusOf(month(50_000, 60_000))).toBe(-10_000_00);
  });
});

describe("paceFromCycles", () => {
  it("averages the last three complete months and takes the weakest as the cautious one", () => {
    const p = paceFromCycles([month(100_000, 50_000, 10_000), month(100_000, 70_000), month(100_000, 60_000)]);
    expect(p).toMatchObject({ typicalPaise: 3_666_667, cautiousPaise: 30_000_00, cycles: 3, early: false, spentPaise: 6_000_000 });
    expect(p?.investingPaise).toBe(Math.round(1_000_000 / 3));
  });

  it("uses only the newest three", () => {
    const p = paceFromCycles([month(100_000, 50_000), month(100_000, 50_000), month(100_000, 50_000), month(100_000, 1_000)]);
    expect(p?.typicalPaise).toBe(50_000_00);
  });

  it("takes 80% of typical as the cautious month while there are fewer than three, and says it is early", () => {
    expect(paceFromCycles([month(100_000, 60_000)])).toMatchObject({ typicalPaise: 40_000_00, cautiousPaise: 32_000_00, cycles: 1, early: true });
    expect(paceFromCycles([month(100_000, 60_000), month(100_000, 80_000)])).toMatchObject({ typicalPaise: 30_000_00, cautiousPaise: 24_000_00, cycles: 2, early: true });
  });

  it("is as bad as typical when nothing is left over", () => {
    expect(paceFromCycles([month(50_000, 60_000)])).toMatchObject({ typicalPaise: -10_000_00, cautiousPaise: -10_000_00 });
  });

  it("has nothing to go on without a complete month", () => {
    expect(paceFromCycles([])).toBeNull();
  });
});

describe("paceFromWindow", () => {
  it("scales the recent weeks to a month and calls it an estimate", () => {
    const p = paceFromWindow(month(60_000, 30_000, 6_000), 15);
    expect(p).toMatchObject({ typicalPaise: 48_000_00, cautiousPaise: 38_400_00, spentPaise: 60_000_00, investingPaise: 12_000_00, cycles: 0, early: true });
    expect(paceFromWindow(month(0, 30_000), 0)).toBeNull();
  });
});

describe("monthsToClose", () => {
  it("rounds up to whole months", () => {
    expect(monthsToClose(100_000_00, 30_000_00)).toBe(4);
    expect(monthsToClose(90_000_00, 30_000_00)).toBe(3);
  });

  it("is zero when nothing is missing and null when nothing is left over", () => {
    expect(monthsToClose(0, 30_000_00)).toBe(0);
    expect(monthsToClose(10_000_00, 0)).toBeNull();
    expect(monthsToClose(10_000_00, -5_000_00)).toBeNull();
  });
});
