import { describe, expect, it } from "vitest";
import { emergencyFund } from "../../src/domain/emergency";

const base = { months: 6, manualTargetPaise: null, horizonMonths: 12, burnPaise: 40_000_00, bankPaise: 0, holdingsPaise: 0, flagged: 1, liquidPaise: 1_00_000_00 };

describe("emergencyFund", () => {
  it("sizes the target as months of essential spending and finds the gap and the monthly top-up", () => {
    const f = emergencyFund({ ...base, bankPaise: 1_20_000_00, holdingsPaise: 40_000_00 });
    expect(f).toMatchObject({ targetPaise: 2_40_000_00, basis: "burn", fundedPaise: 1_60_000_00, gapPaise: 80_000_00, topUpPaise: 6_666_67, fundedMonths: 4, progressPct: 66.7, nothingFlagged: false });
  });

  it("rounds the monthly top-up up, so the gap is closed within the horizon", () => {
    expect(emergencyFund({ ...base, bankPaise: 2_39_999_00 }).topUpPaise).toBe(Math.ceil(1_00 / 12));
  });

  it("is met when the fund reaches the target, with nothing more to put aside", () => {
    const f = emergencyFund({ ...base, bankPaise: 3_00_000_00 });
    expect(f).toMatchObject({ gapPaise: 0, topUpPaise: 0, progressPct: 100 });
  });

  it("uses a typed target instead of months times the burn", () => {
    const f = emergencyFund({ ...base, manualTargetPaise: 3_00_000_00, bankPaise: 1_00_000_00 });
    expect(f).toMatchObject({ targetPaise: 3_00_000_00, basis: "manual", gapPaise: 2_00_000_00 });
  });

  it("has no target with no typed target and too little history, but a typed one still works", () => {
    expect(emergencyFund({ ...base, burnPaise: null, bankPaise: 1_00_000_00 })).toMatchObject({ targetPaise: null, basis: null, gapPaise: null, topUpPaise: null, fundedMonths: null, progressPct: null });
    expect(emergencyFund({ ...base, burnPaise: null, manualTargetPaise: 2_00_000_00, bankPaise: 1_00_000_00 })).toMatchObject({ basis: "manual", gapPaise: 1_00_000_00, fundedMonths: null });
  });

  it("says what the banks alone would cover when nothing is flagged", () => {
    const f = emergencyFund({ ...base, flagged: 0, liquidPaise: 1_00_000_00 });
    expect(f).toMatchObject({ nothingFlagged: true, fundedPaise: 0, liquidMonths: 2.5, gapPaise: 2_40_000_00 });
  });

  it("reports zero months for no money, and never a negative one", () => {
    expect(emergencyFund({ ...base, bankPaise: 0, liquidPaise: -5_000_00 })).toMatchObject({ fundedMonths: 0, liquidMonths: 0, progressPct: 0 });
  });
});
