import { describe, expect, it } from "vitest";
import type { Cashflow, CashflowRow } from "../web/src/api";
import { buildFlow, collapseSmall } from "../web/src/cashflow";

const row = (name: string, amountPaise: number, income = 100_000_00, key = name.toLowerCase()): CashflowRow => ({
  key,
  categoryId: key,
  name,
  amountPaise,
  pctOfIncome: income > 0 ? Math.round((amountPaise / income) * 1000) / 10 : 0,
});

const data = (income: CashflowRow[], expenses: CashflowRow[]): Cashflow => {
  const incomePaise = income.reduce((s, r) => s + r.amountPaise, 0);
  const expensePaise = expenses.reduce((s, r) => s + r.amountPaise, 0);
  return {
    period: { key: "30d", from: "2026-09-28", to: "2026-10-27" },
    groupBy: "category",
    incomePaise,
    expensePaise,
    surplusPaise: incomePaise - expensePaise,
    income,
    expenses,
  };
};

const sum = (links: { value: number }[]) => links.reduce((s, l) => s + l.value, 0);

describe("buildFlow", () => {
  it("returns nothing when there is no income or expense", () => {
    expect(buildFlow(data([], []))).toBeNull();
  });

  it("routes income through the middle node into expenses and savings", () => {
    const model = buildFlow(data([row("Salary", 80_000_00), row("Interest", 20_000_00)], [row("Rent", 22_000_00), row("Food", 8_000_00)]))!;
    expect(model.totalPaise).toBe(100_000_00);
    const center = model.nodes.find((n) => n.side === "center")!;
    expect(center).toMatchObject({ label: "Income", amountPaise: 100_000_00, pct: 100 });
    const savings = model.nodes.find((n) => n.id === "savings")!;
    expect(savings).toMatchObject({ label: "Savings", amountPaise: 70_000_00, pct: 70, side: "sink" });
  });

  it("every flow into the middle equals every flow out of it", () => {
    const model = buildFlow(data([row("Salary", 90_000_00)], [row("Rent", 22_000_00), row("Food", 8_000_00)]))!;
    const into = sum(model.links.filter((l) => l.target === "center"));
    const out = sum(model.links.filter((l) => l.source === "center"));
    expect(into).toBe(out);
  });

  it("a deficit adds a 'Beyond income' source so the flows still balance", () => {
    const model = buildFlow(data([row("Salary", 50_000_00)], [row("Rent", 40_000_00), row("Travel", 30_000_00)]))!;
    expect(model.totalPaise).toBe(70_000_00);
    expect(model.nodes.find((n) => n.side === "center")?.label).toBe("Money spent");
    expect(model.nodes.find((n) => n.id === "shortfall")).toMatchObject({ label: "Beyond income", amountPaise: 20_000_00, side: "source" });
    expect(model.nodes.some((n) => n.id === "savings")).toBe(false);
    expect(sum(model.links.filter((l) => l.target === "center"))).toBe(sum(model.links.filter((l) => l.source === "center")));
  });

  it("no savings node when income exactly equals spending", () => {
    const model = buildFlow(data([row("Salary", 10_000_00)], [row("Rent", 10_000_00)]))!;
    expect(model.nodes.some((n) => n.id === "savings" || n.id === "shortfall")).toBe(false);
  });

  it("expenses with no income at all flow entirely from 'Beyond income'", () => {
    const model = buildFlow(data([], [row("Rent", 5_000_00)]))!;
    expect(model.nodes.find((n) => n.id === "shortfall")?.amountPaise).toBe(5_000_00);
  });

  it("gives each node a distinct id so uncategorized never collides with a category", () => {
    const model = buildFlow(data([row("Salary", 10_000_00)], [row("Uncategorized", 1_000_00, 10_000_00, "none")]))!;
    expect(new Set(model.nodes.map((n) => n.id)).size).toBe(model.nodes.length);
  });
});

describe("collapseSmall", () => {
  it("merges two or more slivers into one 'Other' row without changing the total", () => {
    const rows = [row("Rent", 90_000_00), row("A", 500_00), row("B", 400_00), row("C", 300_00)];
    const out = collapseSmall(rows, 100_000_00);
    expect(out.map((r) => r.name)).toEqual(["Rent", "Other (3)"]);
    expect(out.reduce((s, r) => s + r.amountPaise, 0)).toBe(rows.reduce((s, r) => s + r.amountPaise, 0));
  });

  it("leaves a single small row alone", () => {
    const rows = [row("Rent", 90_000_00), row("A", 500_00)];
    expect(collapseSmall(rows, 100_000_00)).toEqual(rows);
  });

  it("does nothing when the total is zero", () => {
    const rows = [row("A", 0)];
    expect(collapseSmall(rows, 0)).toBe(rows);
  });
});
