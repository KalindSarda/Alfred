import { describe, expect, it } from "vitest";
import { healthOf } from "../../src/domain/health";

const month = { incomePaise: 1_00_000_00, needsPaise: 45_000_00, wantsPaise: 25_000_00, investedPaise: 20_000_00, principalRepaidPaise: 5_000_00, emiPaise: 12_000_00 };

describe("healthOf", () => {
  it("works out savings, the rate and the split against income", () => {
    expect(healthOf(month)).toMatchObject({ spentPaise: 70_000_00, savingsPaise: 30_000_00, savingsRatePct: 30, needsPct: 45, wantsPct: 25, emiBurdenPct: 12, savingsBand: "strong", emiBand: "comfortable" });
  });

  it("rounds percentages to one decimal place", () => {
    expect(healthOf({ ...month, incomePaise: 3_00_000_00, needsPaise: 1_00_000_00, wantsPaise: 0 })).toMatchObject({ needsPct: 33.3, savingsRatePct: 66.7 });
  });

  it("savings can be negative, and then the rate is too", () => {
    const h = healthOf({ ...month, wantsPaise: 70_000_00 });
    expect(h.savingsPaise).toBe(-15_000_00);
    expect(h.savingsRatePct).toBe(-15);
    expect(h.savingsBand).toBe("low");
  });

  it("has no percentages and no bands with no income", () => {
    const h = healthOf({ ...month, incomePaise: 0 });
    expect(h).toMatchObject({ savingsRatePct: null, needsPct: null, wantsPct: null, emiBurdenPct: null, savingsBand: null, emiBand: null, savingsPaise: -70_000_00 });
  });

  it("bands the savings rate and the EMI burden at the rules of thumb", () => {
    expect(healthOf({ ...month, needsPaise: 80_000_00, wantsPaise: 0 }).savingsBand).toBe("strong"); // 20%
    expect(healthOf({ ...month, needsPaise: 85_000_00, wantsPaise: 0 }).savingsBand).toBe("fair"); // 15%
    expect(healthOf({ ...month, needsPaise: 95_000_00, wantsPaise: 0 }).savingsBand).toBe("low"); // 5%
    expect(healthOf({ ...month, emiPaise: 30_000_00 }).emiBand).toBe("comfortable");
    expect(healthOf({ ...month, emiPaise: 40_000_00 }).emiBand).toBe("stretched");
    expect(healthOf({ ...month, emiPaise: 41_000_00 }).emiBand).toBe("heavy");
  });
});
