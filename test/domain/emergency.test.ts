import { describe, expect, it } from "vitest";
import { emergencyFund } from "../../src/domain/emergency";
import type { Pace } from "../../src/domain/pace";

const pace: Pace = { typicalPaise: 20_000_00, cautiousPaise: 10_000_00, spentPaise: 50_000_00, investingPaise: 5_000_00, cycles: 3, early: false };
const base = {
  months: 6,
  manualTargetPaise: null,
  medicalTargetPaise: null,
  horizonMonths: 12,
  essentialsBurnPaise: 40_000_00,
  lifestyleBurnPaise: 60_000_00,
  bankPaise: 0,
  holdingsPaise: 0,
  flagged: 1,
  liquidPaise: 1_00_000_00,
  pace: null,
};

describe("emergencyFund, both ways at once", () => {
  it("judges the fund against the lifestyle and against essentials, each with a percent", () => {
    const f = emergencyFund({ ...base, bankPaise: 1_80_000_00 });
    expect(f.targets.lifestyle).toMatchObject({ livingPaise: 3_60_000_00, totalPaise: 3_60_000_00, gapPaise: 1_80_000_00, pct: 50 });
    expect(f.targets.essentials).toMatchObject({ livingPaise: 2_40_000_00, totalPaise: 2_40_000_00, gapPaise: 60_000_00, pct: 75 });
    expect(f).toMatchObject({ monthsOnEssentials: 4.5, monthsOnLifestyle: 3, verdict: "building" });
  });

  it("keeps the lifestyle goal in the fields the ladder and the transfer suggestion read", () => {
    const f = emergencyFund({ ...base, bankPaise: 1_20_000_00, holdingsPaise: 40_000_00 });
    expect(f).toMatchObject({ targetPaise: 3_60_000_00, gapPaise: 2_00_000_00, topUpPaise: Math.ceil(2_00_000_00 / 12), fundedPaise: 1_60_000_00, progressPct: 44.4, targetBasis: "burn", burnPaise: 60_000_00 });
  });

  it("puts the same medical amount on top of both, filled after the living costs", () => {
    const f = emergencyFund({ ...base, medicalTargetPaise: 4_00_000_00, bankPaise: 4_00_000_00 });
    expect(f.targets.lifestyle).toMatchObject({ totalPaise: 7_60_000_00, gapPaise: 3_60_000_00, medicalPaise: 4_00_000_00 });
    expect(f.targets.essentials).toMatchObject({ totalPaise: 6_40_000_00, gapPaise: 2_40_000_00 });
    expect(f.living).toMatchObject({ targetPaise: 3_60_000_00, fundedPaise: 3_60_000_00, gapPaise: 0 });
    expect(f.medical).toMatchObject({ targetPaise: 4_00_000_00, fundedPaise: 40_000_00, gapPaise: 3_60_000_00 });
  });

  it("says where the fund sits between the two milestones", () => {
    expect(emergencyFund({ ...base, bankPaise: 1_00_000_00 }).verdict).toBe("building");
    expect(emergencyFund({ ...base, bankPaise: 2_50_000_00 }).verdict).toBe("essentials");
    expect(emergencyFund({ ...base, bankPaise: 3_60_000_00 }).verdict).toBe("complete");
    expect(emergencyFund({ ...base, flagged: 0 }).verdict).toBe("none");
    expect(emergencyFund({ ...base, essentialsBurnPaise: null, lifestyleBurnPaise: null, bankPaise: 1_00_000_00 }).verdict).toBe("none");
  });

  it("uses a typed target for the lifestyle living costs only", () => {
    const f = emergencyFund({ ...base, manualTargetPaise: 3_00_000_00, medicalTargetPaise: 1_00_000_00, bankPaise: 1_00_000_00 });
    expect(f.targets.lifestyle).toMatchObject({ livingPaise: 3_00_000_00, totalPaise: 4_00_000_00, gapPaise: 3_00_000_00 });
    expect(f.targets.essentials).toMatchObject({ livingPaise: 2_40_000_00, totalPaise: 3_40_000_00 });
    expect(f.targetBasis).toBe("manual");
  });

  it("has no target for a way it cannot size yet, but a typed target still works", () => {
    const none = emergencyFund({ ...base, essentialsBurnPaise: null, lifestyleBurnPaise: null, bankPaise: 1_00_000_00, medicalTargetPaise: 1_00_000_00 });
    expect(none.targets.lifestyle).toMatchObject({ totalPaise: null, gapPaise: null, pct: null, monthsAtTypical: null });
    expect(none).toMatchObject({ targetPaise: null, targetBasis: null, living: null, medical: null, gapPaise: null, topUpPaise: null, fundedMonths: null });
    const typed = emergencyFund({ ...base, essentialsBurnPaise: null, lifestyleBurnPaise: null, manualTargetPaise: 2_00_000_00, bankPaise: 1_00_000_00 });
    expect(typed).toMatchObject({ targetBasis: "manual", gapPaise: 1_00_000_00 });
    expect(typed.targets.essentials.totalPaise).toBeNull();
  });
});

describe("emergencyFund, at your pace", () => {
  it("says how many months closing each gap takes at a typical and at a lean month", () => {
    const f = emergencyFund({ ...base, bankPaise: 1_80_000_00, pace });
    // ₹1,80,000 missing from the lifestyle goal at ₹20,000 and ₹10,000 a month; ₹60,000 from essentials.
    expect(f.targets.lifestyle).toMatchObject({ monthsAtTypical: 9, monthsAtCautious: 18 });
    expect(f.targets.essentials).toMatchObject({ monthsAtTypical: 3, monthsAtCautious: 6 });
  });

  it("is zero months when nothing is missing, and null when nothing is left over", () => {
    expect(emergencyFund({ ...base, bankPaise: 3_60_000_00, pace }).targets.lifestyle).toMatchObject({ monthsAtTypical: 0, monthsAtCautious: 0 });
    const none = emergencyFund({ ...base, bankPaise: 1_00_000_00, pace: { ...pace, typicalPaise: -5_000_00, cautiousPaise: -5_000_00 } });
    expect(none.targets.lifestyle).toMatchObject({ monthsAtTypical: null, monthsAtCautious: null });
  });

  it("shows what spending 10% less would do when little or nothing is left over", () => {
    const tight = { ...pace, typicalPaise: 0, cautiousPaise: 0, spentPaise: 50_000_00 };
    expect(emergencyFund({ ...base, bankPaise: 3_00_000_00, pace: tight }).monthsIfSpendingLess).toBe(Math.ceil(60_000_00 / 5_000_00));
    expect(emergencyFund({ ...base, bankPaise: 3_00_000_00, pace: null }).monthsIfSpendingLess).toBeNull();
  });

  it("rounds the monthly top-up up when no pace is known", () => {
    expect(emergencyFund({ ...base, bankPaise: 3_59_999_00 }).topUpPaise).toBe(Math.ceil(1_00 / 12));
  });

  it("says what the banks alone would cover when nothing is flagged, and never a negative figure", () => {
    expect(emergencyFund({ ...base, flagged: 0, liquidPaise: 1_20_000_00 })).toMatchObject({ nothingFlagged: true, fundedPaise: 0, liquidMonths: 2 });
    expect(emergencyFund({ ...base, bankPaise: 0, liquidPaise: -5_000_00 })).toMatchObject({ fundedMonths: 0, liquidMonths: 0, progressPct: 0 });
  });
});
