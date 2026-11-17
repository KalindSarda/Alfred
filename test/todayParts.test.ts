import { describe, expect, it } from "vitest";
import type { Cashflow, CashflowRow } from "../web/src/api";
import { compactLines } from "../web/src/briefingCompact";
import { barSegments, buildFlow } from "../web/src/cashflow";
import { sparkline, trendWindow } from "../web/src/spark";
import { ACCOUNT_COLORS, accountColors, spendChange } from "../web/src/spend";

const row = (key: string, amountPaise: number): CashflowRow => ({ key, categoryId: key, name: key, amountPaise, pctOfIncome: 0 });
const flow = (income: number, expenses: [string, number][]): Cashflow => {
  const spent = expenses.reduce((s, [, a]) => s + a, 0);
  return {
    period: { key: "cycle", from: "2026-10-01", to: "2026-10-31" },
    groupBy: "category",
    incomePaise: income,
    expensePaise: spent,
    surplusPaise: income - spent,
    income: income > 0 ? [row("salary", income)] : [],
    expenses: expenses.map(([k, a]) => row(k, a)),
  };
};

describe("the cash flow bar", () => {
  it("lists where it went, biggest first, then savings, adding to the whole", () => {
    const m = buildFlow(flow(100_000, [["rent", 40_000], ["food", 20_000]]))!;
    const segs = barSegments(m);
    expect(segs.map((s) => s.label)).toEqual(["rent", "food", "Savings"]);
    expect(segs.map((s) => s.pct)).toEqual([40, 20, 40]);
  });

  it("folds the tail into Other but keeps savings apart", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const m = buildFlow(flow(1_000_000, names.map((n, i) => [n, 100_000 - i * 5_000] as [string, number])))!;
    const segs = barSegments(m, 5);
    expect(segs).toHaveLength(6);
    expect(segs[4]?.label).toBe("Other (3)");
    expect(segs[5]?.label).toBe("Savings");
    expect(segs.reduce((s, x) => s + x.amountPaise, 0)).toBe(m.totalPaise);
  });

  it("has no savings piece when spending is over income, and gives nothing for nothing", () => {
    const over = barSegments(buildFlow(flow(50_000, [["rent", 60_000]]))!);
    expect(over.map((s) => s.label)).toEqual(["rent"]);
    expect(over[0]?.pct).toBe(100);
    expect(buildFlow(flow(0, []))).toBeNull();
  });
});

describe("the net worth sparkline", () => {
  it("needs two points, and puts higher values higher up", () => {
    expect(sparkline([5], 100, 40)).toBeNull();
    const s = sparkline([10, 20, 30], 100, 40, 4)!;
    expect(s.line.startsWith("M4.0,36.0")).toBe(true);
    expect(s.last).toEqual({ x: 96, y: 4 });
    expect(s.area.endsWith("Z")).toBe(true);
  });

  it("draws a flat line in the middle when nothing moved", () => {
    expect(sparkline([7, 7, 7], 100, 40)!.last.y).toBe(20);
  });

  it("takes the last four month ends for 3 months and all of them for a year", () => {
    const pts = Array.from({ length: 12 }, (_, i) => i);
    expect(trendWindow(pts, 3)).toEqual([8, 9, 10, 11]);
    expect(trendWindow(pts, 12)).toEqual(pts);
    expect(trendWindow([1, 2], 3)).toEqual([1, 2]);
  });
});

describe("the compact briefing", () => {
  it("shows the first three lines in section order and counts them all", () => {
    const sections = [{ lines: ["a", "b"] }, { lines: ["c", "d", "e"] }];
    expect(compactLines(sections, 3)).toEqual({ shown: ["a", "b", "c"], total: 5 });
    expect(compactLines([], 3)).toEqual({ shown: [], total: 0 });
  });
});

describe("spending by account", () => {
  it("gives each account a colour that stays with it, by its place among all accounts by name", () => {
    const all = [
      { id: "z", name: "SBI" },
      { id: "a", name: "HDFC" },
      { id: "m", name: "ICICI" },
    ];
    const colors = accountColors(all);
    expect(colors.get("a")).toBe(ACCOUNT_COLORS[0]);
    expect(colors.get("m")).toBe(ACCOUNT_COLORS[1]);
    expect(colors.get("z")).toBe(ACCOUNT_COLORS[2]);
    // adding an account later in the alphabet leaves the others as they were
    expect(accountColors([...all, { id: "w", name: "Zoho card" }]).get("a")).toBe(colors.get("a"));
  });

  it("wraps round when there are more accounts than colours, and keeps the colours different", () => {
    expect(new Set(ACCOUNT_COLORS).size).toBe(ACCOUNT_COLORS.length);
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, name: `Account ${i}` }));
    expect(accountColors(many).get("i6")).toBe(ACCOUNT_COLORS[0]);
  });

  it("says whether an account spent more, less, the same, or is new compared with last month", () => {
    expect(spendChange(5_000, 3_000)).toEqual({ kind: "up", paise: 2_000 });
    expect(spendChange(1_000, 4_000)).toEqual({ kind: "down", paise: 3_000 });
    expect(spendChange(2_000, 2_000)).toEqual({ kind: "same" });
    expect(spendChange(2_000, 0)).toEqual({ kind: "new" });
    expect(spendChange(0, 0)).toEqual({ kind: "same" });
  });
});
