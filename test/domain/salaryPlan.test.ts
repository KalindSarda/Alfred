import { describe, expect, it } from "vitest";
import { attentionLines, goalAsks, perDayPaise } from "../../src/domain/salaryPlan";

describe("perDayPaise", () => {
  it("spreads what is free over the days until the window ends", () => {
    expect(perDayPaise(30_000_00, "2026-11-01", "2026-12-01")).toEqual({ paise: 1_000_00, days: 30 });
    expect(perDayPaise(10_000_00, "2026-11-01", "2026-11-04")).toEqual({ paise: 3_333_33, days: 3 });
  });

  it("says nothing when nothing is free or the window is a day or less", () => {
    expect(perDayPaise(0, "2026-11-01", "2026-12-01")).toBeNull();
    expect(perDayPaise(-5_000_00, "2026-11-01", "2026-12-01")).toBeNull();
    expect(perDayPaise(5_000_00, "2026-11-01", "2026-11-01")).toBeNull();
  });
});

describe("goalAsks", () => {
  const g = (id: string, over: object = {}) => ({ id, name: id.toUpperCase(), monthlyNeededPaise: 4_000_00, needsAttention: false, targetDate: "2027-06-01", ...over });

  it("takes goals with a monthly need, those running out of time first, then the nearest date", () => {
    const asks = goalAsks([g("a"), g("b", { needsAttention: true }), g("c", { targetDate: "2027-01-01" }), g("none", { monthlyNeededPaise: null }), g("zero", { monthlyNeededPaise: 0 })]);
    expect(asks.map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(asks[0]).toEqual({ id: "b", name: "B", paise: 4_000_00 });
  });

  it("offers at most three", () => {
    expect(goalAsks([g("a"), g("b"), g("c"), g("d")])).toHaveLength(3);
  });
});

describe("attentionLines", () => {
  it("keeps what needs attention and drops what is only for when you look", () => {
    const lines = ["safe", "goals", "free", "due", "investments", "habit", "loans"].map((key) => ({ key, text: key }));
    expect(attentionLines(lines).map((l) => l.key)).toEqual(["free", "habit", "loans"]);
  });

  it("is empty on a quiet day", () => {
    expect(attentionLines([{ key: "safe", text: "x" }, { key: "goals", text: "y" }])).toEqual([]);
  });
});
