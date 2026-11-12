import { describe, expect, it } from "vitest";
import { emergencyFund } from "../../src/domain/emergency";

const base = {
  months: 6,
  basis: "essentials" as const,
  manualTargetPaise: null,
  medicalTargetPaise: null,
  horizonMonths: 12,
  essentialsBurnPaise: 40_000_00,
  lifestyleBurnPaise: 60_000_00,
  bankPaise: 0,
  holdingsPaise: 0,
  flagged: 1,
  liquidPaise: 1_00_000_00,
};

describe("emergencyFund", () => {
  it("sizes the target as months of essential spending and finds the gap and the monthly top-up", () => {
    const f = emergencyFund({ ...base, bankPaise: 1_20_000_00, holdingsPaise: 40_000_00 });
    expect(f).toMatchObject({ targetPaise: 2_40_000_00, targetBasis: "burn", fundedPaise: 1_60_000_00, gapPaise: 80_000_00, topUpPaise: 6_666_67, fundedMonths: 4, progressPct: 66.7, nothingFlagged: false });
  });

  it("can measure on everything spent instead, and shows both targets", () => {
    const f = emergencyFund({ ...base, basis: "lifestyle", bankPaise: 1_20_000_00 });
    expect(f).toMatchObject({ burnPaise: 60_000_00, targetPaise: 3_60_000_00, essentialsTargetPaise: 2_40_000_00, lifestyleTargetPaise: 3_60_000_00, fundedMonths: 2 });
  });

  it("puts a medical amount on top, filled after the living costs", () => {
    const half = emergencyFund({ ...base, medicalTargetPaise: 4_00_000_00, bankPaise: 1_20_000_00 });
    expect(half.targetPaise).toBe(6_40_000_00);
    expect(half.living).toEqual({ targetPaise: 2_40_000_00, fundedPaise: 1_20_000_00, gapPaise: 1_20_000_00, topUpPaise: 10_000_00 });
    expect(half.medical).toEqual({ targetPaise: 4_00_000_00, fundedPaise: 0, gapPaise: 4_00_000_00, topUpPaise: Math.ceil(4_00_000_00 / 12) });

    const more = emergencyFund({ ...base, medicalTargetPaise: 4_00_000_00, bankPaise: 4_00_000_00 });
    expect(more.living).toMatchObject({ fundedPaise: 2_40_000_00, gapPaise: 0 });
    expect(more.medical).toMatchObject({ fundedPaise: 1_60_000_00, gapPaise: 2_40_000_00 });
    expect(more.gapPaise).toBe(2_40_000_00);
  });

  it("rounds the monthly top-up up, so the gap is closed within the horizon", () => {
    expect(emergencyFund({ ...base, bankPaise: 2_39_999_00 }).topUpPaise).toBe(Math.ceil(1_00 / 12));
  });

  it("is met when the fund reaches the target, with nothing more to put aside", () => {
    const f = emergencyFund({ ...base, bankPaise: 3_00_000_00 });
    expect(f).toMatchObject({ gapPaise: 0, topUpPaise: 0, progressPct: 100 });
  });

  it("uses a typed target for living costs instead of months times the burn, with medical still on top", () => {
    const f = emergencyFund({ ...base, manualTargetPaise: 3_00_000_00, medicalTargetPaise: 1_00_000_00, bankPaise: 1_00_000_00 });
    expect(f).toMatchObject({ targetPaise: 4_00_000_00, targetBasis: "manual", gapPaise: 3_00_000_00 });
    expect(f.living?.targetPaise).toBe(3_00_000_00);
  });

  it("has no target with no typed target and too little history, but a typed one still works", () => {
    const none = emergencyFund({ ...base, essentialsBurnPaise: null, lifestyleBurnPaise: null, bankPaise: 1_00_000_00, medicalTargetPaise: 1_00_000_00 });
    expect(none).toMatchObject({ targetPaise: null, targetBasis: null, living: null, medical: null, gapPaise: null, topUpPaise: null, fundedMonths: null, progressPct: null });
    expect(emergencyFund({ ...base, essentialsBurnPaise: null, lifestyleBurnPaise: null, manualTargetPaise: 2_00_000_00, bankPaise: 1_00_000_00 })).toMatchObject({ targetBasis: "manual", gapPaise: 1_00_000_00, fundedMonths: null });
  });

  it("says what the banks alone would cover when nothing is flagged", () => {
    const f = emergencyFund({ ...base, flagged: 0, liquidPaise: 1_00_000_00 });
    expect(f).toMatchObject({ nothingFlagged: true, fundedPaise: 0, liquidMonths: 2.5, gapPaise: 2_40_000_00 });
  });

  it("reports zero months for no money, and never a negative one", () => {
    expect(emergencyFund({ ...base, bankPaise: 0, liquidPaise: -5_000_00 })).toMatchObject({ fundedMonths: 0, liquidMonths: 0, progressPct: 0 });
  });
});
