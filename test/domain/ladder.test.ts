import { describe, expect, it } from "vitest";
import { buildLadder, type LadderFacts } from "../../src/domain/ladder";
import { suggestTransfer } from "../../src/domain/transfer";

const settled: LadderFacts = {
  essentialsBurnPaise: 40_000_00,
  liquidPaise: 5_00_000_00,
  costlyLoans: [],
  costlyDebtBp: 1200,
  protectionGaps: [],
  living: { gapPaise: 0 },
  medical: { gapPaise: 0 },
  nothingFlagged: false,
  firePct: 20,
  skipped: [],
};
const statuses = (f: LadderFacts) => Object.fromEntries(buildLadder(f).steps.map((s) => [s.key, s.status]));

describe("buildLadder", () => {
  it("puts the first step that is not done as the next one, and the rest later", () => {
    const l = buildLadder({ ...settled, liquidPaise: 10_000_00, protectionGaps: ["No personal health cover recorded"], living: { gapPaise: 2_00_000_00 }, medical: { gapPaise: 4_00_000_00 } });
    expect(statuses({ ...settled, liquidPaise: 10_000_00, protectionGaps: ["x"], living: { gapPaise: 1 }, medical: { gapPaise: 1 } })).toEqual({ starter: "next", debt: "done", protection: "later", emergency: "later", medical: "later", fire: "later" });
    expect(l.next).toMatchObject({ key: "starter", amountPaise: 30_000_00 });
  });

  it("puts protection ahead of the emergency fund when there is no cover", () => {
    const l = buildLadder({ ...settled, protectionGaps: ["No personal health cover recorded", "No term life cover recorded"], living: { gapPaise: 2_00_000_00 } });
    expect(l.next).toMatchObject({ key: "protection", amountPaise: null });
    expect(l.next?.detail).toContain("No personal health cover recorded; No term life cover recorded");
    expect(statuses({ ...settled, protectionGaps: ["x"], living: { gapPaise: 1 } })).toMatchObject({ starter: "done", debt: "done", protection: "next", emergency: "later" });
  });

  it("makes costly loans a step with the worst one named", () => {
    const l = buildLadder({ ...settled, costlyLoans: [{ name: "Personal loan", ratePct: 14.5, outstandingPaise: 3_00_000_00 }, { name: "Car loan", ratePct: 12, outstandingPaise: 5_00_000_00 }] });
    expect(l.next).toMatchObject({ key: "debt", amountPaise: 8_00_000_00 });
    expect(l.next?.detail).toContain("Personal loan costs 14.5% a year");
  });

  it("fills the emergency layers in order, and treats no medical amount as nothing to do", () => {
    expect(statuses({ ...settled, living: { gapPaise: 1_00_000_00 }, medical: { gapPaise: 4_00_000_00 } })).toMatchObject({ emergency: "next", medical: "later" });
    expect(statuses({ ...settled, living: { gapPaise: 0 }, medical: { gapPaise: 4_00_000_00 } })).toMatchObject({ emergency: "done", medical: "next" });
    expect(statuses({ ...settled, medical: null })).toMatchObject({ medical: "done" });
  });

  it("asks for the fund to be marked before calling it done", () => {
    const l = buildLadder({ ...settled, nothingFlagged: true, living: { gapPaise: 0 } });
    expect(l.next?.key).toBe("emergency");
    expect(l.next?.detail).toContain("Nothing is marked");
  });

  it("passes over a skipped step, and says so", () => {
    const l = buildLadder({ ...settled, protectionGaps: ["x"], skipped: ["protection"], living: { gapPaise: 1_00_000_00 } });
    expect(statuses({ ...settled, protectionGaps: ["x"], skipped: ["protection"], living: { gapPaise: 1 } })).toMatchObject({ protection: "skipped", emergency: "next" });
    expect(l.next?.key).toBe("emergency");
  });

  it("ends at investing for independence, and has no next step once that is reached", () => {
    expect(buildLadder(settled).next).toMatchObject({ key: "fire" });
    expect(buildLadder({ ...settled, firePct: 100 }).next).toBeNull();
  });

  it("explains the starter buffer when history is too short", () => {
    const l = buildLadder({ ...settled, essentialsBurnPaise: null });
    expect(l.next).toMatchObject({ key: "starter", amountPaise: null });
  });
});

describe("suggestTransfer", () => {
  const base = { gapPaise: 3_00_000_00, freeToSpendPaise: 1_00_000_00, dailySpendPaise: 1_000_00, daysLeft: 10, sourceAvailablePaise: 2_00_000_00, hasDestination: true };

  it("moves what is free beyond a cushion for the days left, rounded down", () => {
    // ₹1,00,000 free, less ten days at ₹1,000 a day.
    expect(suggestTransfer(base)).toMatchObject({ none: null, cushionPaise: 10_000_00, movablePaise: 90_000_00, amountPaise: 90_000_00, remainingPaise: 2_10_000_00 });
    expect(suggestTransfer({ ...base, freeToSpendPaise: 1_00_000_00 + 5_099_00 }).amountPaise).toBe(95_000_00);
  });

  it("is capped by the gap, which it then completes", () => {
    expect(suggestTransfer({ ...base, gapPaise: 50_000_00 })).toMatchObject({ amountPaise: 50_000_00, remainingPaise: 0 });
  });

  it("is capped by what the source bank holds", () => {
    expect(suggestTransfer({ ...base, sourceAvailablePaise: 40_000_00 }).amountPaise).toBe(40_000_00);
  });

  it("says why there is nothing to move", () => {
    expect(suggestTransfer({ ...base, gapPaise: null }).none).toBe("no_target");
    expect(suggestTransfer({ ...base, gapPaise: 0 }).none).toBe("fund_complete");
    expect(suggestTransfer({ ...base, hasDestination: false }).none).toBe("no_destination");
    expect(suggestTransfer({ ...base, sourceAvailablePaise: null }).none).toBe("no_source");
    expect(suggestTransfer({ ...base, dailySpendPaise: null }).none).toBe("no_history");
    expect(suggestTransfer({ ...base, freeToSpendPaise: 5_000_00 }).none).toBe("nothing_movable");
    expect(suggestTransfer({ ...base, freeToSpendPaise: -1_000_00 }).none).toBe("nothing_movable");
  });
});
