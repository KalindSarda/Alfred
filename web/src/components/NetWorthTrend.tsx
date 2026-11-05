import { useState } from "react";
import type { NetWorthPoint } from "../api";
import { useNetWorthTrend } from "../queries";
import { rupees } from "../format";
import { Card } from "./ui";

const W = 600;
const H = 150;
const PAD = { left: 8, right: 8, top: 12, bottom: 12 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (p: NetWorthPoint) => `${MONTHS[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(0, 4)}`;

/** A line of net worth at each month end. Tap or hover a point to read it. Shown once there are two months to compare. */
export function NetWorthTrend() {
  const query = useNetWorthTrend(12);
  const [picked, setPicked] = useState<number | null>(null);
  const points = query.data ?? [];
  if (points.length < 2) return null;

  const values = points.map((p) => p.netWorthPaise);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / span) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.netWorthPaise).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const shown = picked !== null ? points[picked]! : last;
  const change = last.netWorthPaise - first.netWorthPaise;

  return (
    <Card id="trend">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-brass/50 pb-2">
        <h2 className="font-display text-lg">Net worth over time</h2>
        <span className="text-sm text-soft">{points.length} months</span>
      </div>
      <p className="text-sm text-soft" aria-live="polite">
        {picked === null || picked === points.length - 1 ? "Now" : label(shown)}
        {": "}
        <strong className="text-ink tabular-nums">{rupees(shown.netWorthPaise)}</strong>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" role="img" aria-label={`Net worth from ${rupees(first.netWorthPaise)} in ${label(first)} to ${rupees(last.netWorthPaise)} now`} onMouseLeave={() => setPicked(null)}>
        <path d={area} className="fill-brand/10" />
        <path d={line} className="fill-none stroke-brand" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(i)} cy={y(p.netWorthPaise)} r={i === (picked ?? points.length - 1) ? 6 : 3.5} className="fill-brand" />
            <rect
              x={x(i) - (W / points.length) / 2}
              y={0}
              width={W / points.length}
              height={H}
              className="cursor-pointer fill-transparent"
              onMouseEnter={() => setPicked(i)}
              onClick={() => setPicked(i)}
            >
              <title>{`${label(p)}: ${rupees(p.netWorthPaise)}`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-xs text-soft">
        <span>{label(first)}</span>
        <span>{label(last)}</span>
      </div>
      <p className="mt-2 text-sm text-soft">
        {change === 0 ? "No change" : `${change > 0 ? "Up" : "Down"} ${rupees(Math.abs(change))}`} since {label(first)}.
      </p>
    </Card>
  );
}
