import { describe, expect, it } from "vitest";
import { buildFoundations, type FoundationFacts, monthlyEquivalent } from "../../src/domain/ladder";
import { suggestTransfer } from "../../src/domain/transfer";

const settled: FoundationFacts = {
  essentialsBurnPaise: 40_000_00,
  liquidPaise: 5_00_000_00,
  costlyLoans: [],
  costlyDebtBp: 1200,
  cover: { needed: 2, inPlace: 2, missing: [], urgent: false },
  fund: {
    nothingFlagged: false,
    fundedPaise: 10_00_000_00,
    lifestyle: { pct: 100, gapPaise: 0, monthsAtTypical: 0 },
    essentials: { pct: 100, gapPaise: 0, monthsAtTypical: 0 },
    medical: { fundedPaise: 4_00_000_00, targetPaise: 4_00_000_00 },
  },
  firePct: 20,
};
const row = (f: FoundationFacts, key: string) => buildFoundations(f).rows.find((r) => r.key === key)!;
const statuses = (f: FoundationFacts) => Object.fromEntries(buildFoundations(f).rows.map((r) => [r.key, r.status]));

describe("buildFoundations", () => {
  it("shows every foundation with a percent, in a fixed order", () => {
    const g = buildFoundations(settled);
    expect(g.rows.map((r) => r.key)).toEqual(["starter", "debt", "cover", "lifestyle", "essentials", "medical", "fire"]);
    expect(g.rows.map((r) => r.pct)).toEqual([100, 100, 100, 100, 100, 100, 20]);
    expect(g.attention).toBeNull();
    expect(statuses(settled)).toMatchObject({ starter: "ok", debt: "ok", cover: "ok", lifestyle: "ok", fire: "building" });
  });

  it("measures the starter buffer as a share of one month of essentials", () => {
    const r = row({ ...settled, liquidPaise: 10_000_00 }, "starter");
    // Under half is the one tagged for attention; above it is just building.
    expect(r).toMatchObject({ pct: 25, amountPaise: 30_000_00, status: "attention" });
    expect(row({ ...settled, liquidPaise: 24_000_00 }, "starter")).toMatchObject({ pct: 60, status: "building" });
    expect(row({ ...settled, essentialsBurnPaise: null }, "starter")).toMatchObject({ pct: null, status: "building" });
  });

  it("counts the covers in place against the covers needed", () => {
    const half = row({ ...settled, cover: { needed: 2, inPlace: 1, missing: ["No term life cover recorded"], urgent: false } }, "cover");
    expect(half).toMatchObject({ pct: 50, status: "building", ideal: "Personal health cover and term life cover" });
    expect(half.detail).toContain("No term life cover recorded");
    expect(row({ ...settled, cover: { needed: 1, inPlace: 0, missing: ["x"], urgent: true } }, "cover").ideal).toBe("Personal health cover");
  });

  it("names the costliest loan, with no percent", () => {
    const r = row({ ...settled, costlyLoans: [{ name: "Personal loan", ratePct: 14.5, outstandingPaise: 3_00_000_00 }, { name: "Car loan", ratePct: 12, outstandingPaise: 5_00_000_00 }] }, "debt");
    expect(r).toMatchObject({ pct: null, amountPaise: 8_00_000_00 });
    expect(r.detail).toContain("Personal loan costs 14.5% a year");
  });

  it("tags one row for attention, by rule: a high cover gap first", () => {
    const f: FoundationFacts = { ...settled, liquidPaise: 5_000_00, cover: { needed: 2, inPlace: 0, missing: ["a", "b"], urgent: true }, costlyLoans: [{ name: "L", ratePct: 14, outstandingPaise: 1_00 }], fund: { ...settled.fund, lifestyle: { pct: 10, gapPaise: 1, monthsAtTypical: 9 }, essentials: { pct: 20, gapPaise: 1, monthsAtTypical: 5 } } };
    expect(buildFoundations(f).attention?.key).toBe("cover");
    expect(statuses(f)).toMatchObject({ cover: "attention", debt: "building", starter: "building", lifestyle: "building" });
  });

  it("then costly debt, then a starter buffer under half, then the emergency fund", () => {
    const debt: FoundationFacts = { ...settled, costlyLoans: [{ name: "L", ratePct: 14, outstandingPaise: 1_00 }], cover: { needed: 2, inPlace: 1, missing: ["x"], urgent: false } };
    expect(buildFoundations(debt).attention?.key).toBe("debt");
    const thin: FoundationFacts = { ...settled, liquidPaise: 10_000_00 };
    expect(buildFoundations(thin).attention?.key).toBe("starter");
    const fund: FoundationFacts = { ...settled, liquidPaise: 30_000_00, fund: { ...settled.fund, lifestyle: { pct: 40, gapPaise: 1, monthsAtTypical: 9 }, essentials: { pct: 60, gapPaise: 1, monthsAtTypical: 5 } } };
    expect(buildFoundations(fund).attention?.key).toBe("lifestyle");
  });

  it("does not tag a cover gap that is not urgent ahead of the others", () => {
    const f: FoundationFacts = { ...settled, cover: { needed: 2, inPlace: 1, missing: ["x"], urgent: false }, fund: { ...settled.fund, lifestyle: { pct: 40, gapPaise: 1, monthsAtTypical: 9 }, essentials: { pct: 60, gapPaise: 1, monthsAtTypical: 5 } } };
    expect(buildFoundations(f).attention?.key).toBe("lifestyle");
  });

  it("asks for the fund to be marked before calling it done, and tags it", () => {
    const f: FoundationFacts = { ...settled, fund: { ...settled.fund, nothingFlagged: true, fundedPaise: 0, lifestyle: { pct: 0, gapPaise: 9, monthsAtTypical: null }, essentials: { pct: 0, gapPaise: 9, monthsAtTypical: null } } };
    const g = buildFoundations(f);
    expect(g.attention?.key).toBe("lifestyle");
    expect(g.attention?.detail).toContain("Nothing is marked");
    expect(buildFoundations({ ...settled, fund: { ...settled.fund, nothingFlagged: true } }).rows.find((r) => r.key === "lifestyle")?.status).toBe("attention");
  });

  it("gives the months to go at the usual pace, or says none can be given", () => {
    const f: FoundationFacts = { ...settled, fund: { ...settled.fund, lifestyle: { pct: 40, gapPaise: 1, monthsAtTypical: 9 }, essentials: { pct: 60, gapPaise: 1, monthsAtTypical: null } } };
    expect(row(f, "lifestyle").detail).toBe("About 9 months to go at your usual pace.");
    expect(row(f, "essentials").detail).toContain("no time can be given");
  });

  it("treats the medical layer as a row that is never tagged on its own, and as done when none is set", () => {
    const empty: FoundationFacts = { ...settled, fund: { ...settled.fund, medical: { fundedPaise: 0, targetPaise: 4_00_000_00 } } };
    expect(row(empty, "medical")).toMatchObject({ pct: 0, status: "building", amountPaise: 4_00_000_00 });
    expect(buildFoundations(empty).attention).toBeNull();
    expect(row({ ...settled, fund: { ...settled.fund, medical: null } }, "medical")).toMatchObject({ pct: null, status: "ok" });
  });

  it("never tags independence, however far it is", () => {
    expect(buildFoundations({ ...settled, firePct: 1 }).attention).toBeNull();
    expect(row({ ...settled, firePct: null }, "fire")).toMatchObject({ pct: null, status: "building" });
    expect(row({ ...settled, firePct: 100 }, "fire").status).toBe("ok");
  });
});

describe("monthlyEquivalent", () => {
  it("turns a repeating amount into a month's worth", () => {
    expect(monthlyEquivalent(10_000_00, "monthly")).toBe(10_000_00);
    expect(monthlyEquivalent(1_200_00, "yearly")).toBe(100_00);
    expect(monthlyEquivalent(1_000_00, "weekly")).toBe(Math.round((1_000_00 * 52) / 12));
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
