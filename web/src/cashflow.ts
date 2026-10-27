import type { Cashflow, CashflowRow } from "./api";

/** Turns the cash flow response into the nodes and links a Sankey diagram draws. Pure, so it is unit-tested. */

export interface FlowNode {
  id: string;
  label: string;
  amountPaise: number;
  /** Share of the money flowing through the middle, one decimal. */
  pct: number;
  color: string;
  side: "source" | "center" | "sink";
}

export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

export interface FlowModel {
  nodes: FlowNode[];
  links: FlowLink[];
  totalPaise: number;
}

const SOURCE_COLORS = ["#1f6b4f", "#3f8f6b", "#5aa88a", "#7bbd9f", "#9bcfb5", "#b9dfcc"];
const SINK_COLORS = ["#2b6cde", "#c9a96a", "#7a5ea8", "#d98a3d", "#3f8fa6", "#b3638a", "#6b8e23", "#8a6d3b", "#4c7fa8", "#a0522d"];
export const SAVINGS_COLOR = "#1f6b4f";
export const SHORTFALL_COLOR = "#b3372f";
export const MIDDLE_COLOR = "#6b7280";
const OTHER_COLOR = "#8a8f9a";

/**
 * Folds slivers into one "Other (n)" row so labels stay readable. Rows smaller than `threshold` of the total
 * are merged only when at least two of them exist, so a single small row keeps its own name.
 */
export function collapseSmall(rows: CashflowRow[], totalPaise: number, threshold = 0.015): CashflowRow[] {
  if (totalPaise <= 0) return rows;
  const small = rows.filter((r) => r.amountPaise / totalPaise < threshold);
  if (small.length < 2) return rows;
  const big = rows.filter((r) => r.amountPaise / totalPaise >= threshold);
  const amountPaise = small.reduce((s, r) => s + r.amountPaise, 0);
  return [
    ...big,
    { key: "other", categoryId: null, name: `Other (${small.length})`, amountPaise, pctOfIncome: small.reduce((s, r) => s + r.pctOfIncome, 0) },
  ];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildFlow(data: Cashflow): FlowModel | null {
  const { incomePaise, expensePaise, surplusPaise } = data;
  if (incomePaise === 0 && expensePaise === 0) return null;

  // The middle node carries whichever is larger, so every flow in balances every flow out.
  const totalPaise = Math.max(incomePaise, expensePaise);
  const deficit = surplusPaise < 0;
  const pctOf = (amount: number) => (totalPaise > 0 ? round1((amount / totalPaise) * 100) : 0);

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const center = deficit ? "Money spent" : "Income";
  nodes.push({ id: "center", label: center, amountPaise: totalPaise, pct: 100, color: MIDDLE_COLOR, side: "center" });

  collapseSmall(data.income, totalPaise).forEach((row, i) => {
    const id = `in:${row.key}`;
    nodes.push({
      id,
      label: row.name,
      amountPaise: row.amountPaise,
      pct: pctOf(row.amountPaise),
      color: row.key === "other" ? OTHER_COLOR : (SOURCE_COLORS[i % SOURCE_COLORS.length] ?? OTHER_COLOR),
      side: "source",
    });
    links.push({ source: id, target: "center", value: row.amountPaise });
  });

  if (deficit) {
    const gap = -surplusPaise;
    nodes.push({ id: "shortfall", label: "Beyond income", amountPaise: gap, pct: pctOf(gap), color: SHORTFALL_COLOR, side: "source" });
    links.push({ source: "shortfall", target: "center", value: gap });
  }

  collapseSmall(data.expenses, totalPaise).forEach((row, i) => {
    const id = `out:${row.key}`;
    nodes.push({
      id,
      label: row.name,
      amountPaise: row.amountPaise,
      pct: pctOf(row.amountPaise),
      color: row.key === "other" ? OTHER_COLOR : (SINK_COLORS[i % SINK_COLORS.length] ?? OTHER_COLOR),
      side: "sink",
    });
    links.push({ source: "center", target: id, value: row.amountPaise });
  });

  if (surplusPaise > 0) {
    nodes.push({ id: "savings", label: "Savings", amountPaise: surplusPaise, pct: pctOf(surplusPaise), color: SAVINGS_COLOR, side: "sink" });
    links.push({ source: "center", target: "savings", value: surplusPaise });
  }

  return { nodes, links, totalPaise };
}
