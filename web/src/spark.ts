/** A small line chart's points and path, for a sparkline. Pure so it can be unit-tested. */

export interface Spark {
  /** SVG path of the line. */
  line: string;
  /** The same path closed down to the baseline, for a soft fill under it. */
  area: string;
  /** Where the last value sits, for the end dot. */
  last: { x: number; y: number };
}

export function sparkline(values: number[], width: number, height: number, pad = 4): Spark | null {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / span) * (height - 2 * pad));
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastIndex = values.length - 1;
  return {
    line,
    area: `${line} L${x(lastIndex).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`,
    last: { x: x(lastIndex), y: y(values[lastIndex] as number) },
  };
}

/** The slice of a month-by-month series for a range: 3 months is the last four month ends, a year is all of them. */
export function trendWindow<T>(points: T[], months: 3 | 12): T[] {
  return months === 12 ? points : points.slice(-(months + 1));
}
