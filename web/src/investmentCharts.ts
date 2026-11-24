import type { Holding, InvestmentTrend, TrendPoint, TrendSeries } from "./api";
import { BROKER_COLORS, EXTRA_KIND_COLORS, KIND_COLORS } from "./investmentKinds";

/** Pure maths for the investment charts on Trends: labels, scales, paths, stacks and the gain bars. Drawing is in components/InvestmentCharts.tsx. */

export type Range = "3m" | "1y" | "all";

export const RANGES: { key: Range; label: string; note: string }[] = [
  { key: "3m", label: "3 months", note: "weekly" },
  { key: "1y", label: "1 year", note: "monthly" },
  { key: "all", label: "All", note: "monthly" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Oct" for a weekly point, "Oct 26" for a monthly one. */
export function pointLabel(asOf: string, range: Range): string {
  const year = asOf.slice(2, 4);
  const month = MONTHS[Number(asOf.slice(5, 7)) - 1] ?? "";
  return range === "3m" ? `${Number(asOf.slice(8, 10))} ${month}` : `${month} ${year}`;
}

/** A value's place along a run of `n` points across the width, between the padding. */
export const xAt = (i: number, n: number, width: number, pad: number): number => (n <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1));

/** The place of a value between `lo` and `hi`, from the bottom of the chart to the top. A flat run sits in the middle. */
export function yAt(v: number, lo: number, hi: number, height: number, pad: number): number {
  if (hi <= lo) return height / 2;
  return height - pad - ((v - lo) / (hi - lo)) * (height - 2 * pad);
}

/** What was put in and still is (less what was taken out), never below nothing. */
export const netPutIn = (p: TrendPoint): number => Math.max(0, p.putInPaise - p.soldPaise);

export interface WorthPaths {
  worth: string;
  putIn: string;
  /** The gap between the two lines, closed, to tint. */
  gap: string;
  xs: number[];
  ys: number[];
}

/** SVG paths for worth and for what was put in, on one scale, and the gap between them. */
export function worthPaths(points: readonly TrendPoint[], width: number, height: number, pad: number): WorthPaths {
  const values = points.flatMap((p) => [p.worthPaise, netPutIn(p)]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const xs = points.map((_, i) => xAt(i, points.length, width, pad));
  const worthY = points.map((p) => yAt(p.worthPaise, lo, hi, height, pad));
  const putY = points.map((p) => yAt(netPutIn(p), lo, hi, height, pad));
  const line = (ys: number[]) => ys.map((y, i) => `${i === 0 ? "M" : "L"}${(xs[i] as number).toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const back = [...putY].map((y, i) => `L${(xs[i] as number).toFixed(1)} ${y.toFixed(1)}`).reverse().join(" ");
  return { worth: line(worthY), putIn: line(putY), gap: points.length > 1 ? `${line(worthY)} ${back} Z` : "", xs, ys: worthY };
}

/** The gain at a point (worth plus what was taken out, less what was put in) and as a percentage of what was put in (one decimal; null with nothing put in). */
export function gainAt(p: TrendPoint): { gainPaise: number; pct: number | null } {
  const gainPaise = p.worthPaise + p.soldPaise - p.putInPaise;
  return { gainPaise, pct: p.putInPaise > 0 ? Math.round((gainPaise / p.putInPaise) * 1000) / 10 : null };
}

/** The colour of a kind (by its key, then its name) or, for a kind added by hand, the next spare one. */
export function seriesColors(series: readonly TrendSeries[], by: "kind" | "broker"): string[] {
  let extra = 0;
  return series.map((s, i) => {
    if (by === "broker") return s.key === "none" ? "#6b7280" : (BROKER_COLORS[i % BROKER_COLORS.length] as string);
    return KIND_COLORS[s.key] ?? KIND_COLORS[s.name.toLowerCase()] ?? (EXTRA_KIND_COLORS[extra++ % EXTRA_KIND_COLORS.length] as string);
  });
}

export interface StackSegment {
  key: string;
  /** Top and height as a share of the chart's height. */
  y: number;
  h: number;
}

/** One column's segments, bottom up, in the order of the series, scaled so `max` fills `height`. */
export function stackColumn(series: readonly TrendSeries[], index: number, max: number, height: number): StackSegment[] {
  let used = 0;
  const out: StackSegment[] = [];
  for (const s of series) {
    const v = Math.max(0, s.worthPaise[index] ?? 0);
    if (v === 0 || max <= 0) continue;
    const h = (v / max) * height;
    used += h;
    out.push({ key: s.key, y: height - used, h });
  }
  return out;
}

export interface GainBar {
  id: string;
  name: string;
  kindName: string;
  gainPaise: number;
  pct: number | null;
  /** The bar's length as a share of the longest one, 0 to 1. */
  share: number;
}

/** Each active investment's gain (your share), best to worst, with a bar length relative to the biggest. */
export function gainBars(holdings: readonly Holding[]): GainBar[] {
  const live = holdings.filter((h) => h.status === "active");
  const longest = Math.max(1, ...live.map((h) => Math.abs(h.myGainPaise)));
  return live
    .map((h) => ({
      id: h.id,
      name: h.name,
      kindName: h.kindName,
      gainPaise: h.myGainPaise,
      pct: h.myInvestedPaise > 0 ? Math.round((h.myGainPaise / h.myInvestedPaise) * 1000) / 10 : null,
      share: Math.abs(h.myGainPaise) / longest,
    }))
    .sort((a, b) => b.gainPaise - a.gainPaise || a.name.localeCompare(b.name));
}

/** A line of words for each chart, for a screen reader: where it starts and ends. */
export function trendSummary(t: InvestmentTrend, rupees: (p: number) => string): string {
  const first = t.points[0];
  const last = t.points.at(-1);
  if (!first || !last) return "No investments yet.";
  const g = gainAt(last);
  return `Worth ${rupees(first.worthPaise)} on ${first.asOf}, ${rupees(last.worthPaise)} on ${last.asOf}. Put in ${rupees(netPutIn(last))}, gain ${rupees(g.gainPaise)}.`;
}
