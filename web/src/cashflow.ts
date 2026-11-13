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

const SOURCE_COLORS = ["#1f8a5b", "#3fa476", "#6bbf94", "#92d1b0", "#b3e0c8", "#cdeadb"];
const SINK_COLORS = ["#2b6cde", "#c9a96a", "#7a5ea8", "#d98a3d", "#3f8fa6", "#b3638a", "#6b8e23", "#8a6d3b", "#4c7fa8", "#a0522d"];
/** Spending that cannot stop is drawn in blues, the rest in warm colours, so a colour says which group a category is in. */
export const NEED_COLORS = ["#2f5fb3", "#5b8bd6", "#8fb3e8", "#1f3f7a", "#6f9be0"];
export const WANT_COLORS = ["#e07a4f", "#e9b949", "#d9627d", "#f0a35e", "#c0573f"];
export const SAVINGS_COLOR = "#1f8a5b";
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

/** Whether a spending row is a need or a want; undefined when it cannot be told (a merchant, or no category). */
export type KindOf = (row: CashflowRow) => "need" | "want" | undefined;

export function buildFlow(data: Cashflow, kindOf?: KindOf): FlowModel | null {
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

  const used = { need: 0, want: 0 };
  const sinkColor = (row: CashflowRow, i: number): string => {
    if (row.key === "other") return OTHER_COLOR;
    if (!kindOf) return SINK_COLORS[i % SINK_COLORS.length] ?? OTHER_COLOR;
    const kind = kindOf(row);
    if (!kind) return OTHER_COLOR;
    const palette = kind === "need" ? NEED_COLORS : WANT_COLORS;
    return palette[used[kind]++ % palette.length] ?? OTHER_COLOR;
  };
  collapseSmall(data.expenses, totalPaise).forEach((row, i) => {
    const id = `out:${row.key}`;
    nodes.push({
      id,
      label: row.name,
      amountPaise: row.amountPaise,
      pct: pctOf(row.amountPaise),
      color: sinkColor(row, i),
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

export interface BarSegment {
  id: string;
  label: string;
  amountPaise: number;
  /** Share of the bar, a whole-number-friendly percentage with one decimal. */
  pct: number;
  color: string;
}

/**
 * The few pieces of a stacked bar for a glance: where the money went, biggest first, then savings, with the tail folded
 * into "Other". `max` counts the named pieces; savings always keeps its own piece. Pure, so it is unit-tested.
 */
export function barSegments(model: FlowModel, max = 5): BarSegment[] {
  const sinks = model.nodes.filter((n) => n.side === "sink");
  if (model.totalPaise <= 0 || sinks.length === 0) return [];
  const savings = sinks.find((n) => n.id === "savings");
  const spent = sinks.filter((n) => n.id !== "savings").sort((a, b) => b.amountPaise - a.amountPaise);
  const keep = spent.length > max ? spent.slice(0, max - 1) : spent;
  const rest = spent.slice(keep.length);
  const piece = (n: FlowNode): BarSegment => ({ id: n.id, label: n.label, amountPaise: n.amountPaise, pct: round1((n.amountPaise / model.totalPaise) * 100), color: n.color });
  const out = keep.map(piece);
  if (rest.length > 0) {
    const amountPaise = rest.reduce((s, n) => s + n.amountPaise, 0);
    out.push({ id: "rest", label: `Other (${rest.length})`, amountPaise, pct: round1((amountPaise / model.totalPaise) * 100), color: OTHER_COLOR });
  }
  if (savings) out.push(piece(savings));
  return out;
}

/** On a phone the income card only shows when something came in; an empty one would just push spending down. */
export const showIncomeCard = (data: Pick<Cashflow, "incomePaise">): boolean => data.incomePaise > 0;

/** A `KindOf` from the person's categories: essential ones are needs, other categories are wants. */
export function kindFromCategories(categories: { id: string; essential: boolean }[]): KindOf {
  const essential = new Map(categories.map((c) => [c.id, c.essential]));
  return (row) => (row.categoryId && essential.has(row.categoryId) ? (essential.get(row.categoryId) ? "need" : "want") : undefined);
}
