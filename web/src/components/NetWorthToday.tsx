import { useState } from "react";
import type { BalanceOverview } from "../api";
import { rupeesCompact } from "../format";
import { useNetWorthTrend } from "../queries";
import { sparkline, trendWindow } from "../spark";
import { Link } from "../router";
import { NetWorthDetails } from "./NetWorth";
import { Amount, Card, Chevron } from "./ui";

const W = 300;
const H = 56;

/** Net worth for Today: the figure, how it has moved, a sparkline with a 3 month or 1 year toggle, and the breakdown on tap. */
export function NetWorthToday({ overview }: { overview: BalanceOverview }) {
  const trend = useNetWorthTrend(12);
  const [months, setMonths] = useState<3 | 12>(12);
  const [open, setOpen] = useState(false);
  const points = trendWindow(trend.data ?? [], months);
  const spark = sparkline(points.map((p) => p.netWorthPaise), W, H);
  const first = points[0];
  const change = first ? overview.netWorthPaise - first.netWorthPaise : 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-soft uppercase">Net worth</p>
          <p className="font-display mt-1 text-3xl tabular-nums"><Amount paise={overview.netWorthPaise} /></p>
          {first && change !== 0 && (
            <p className={`text-sm ${change > 0 ? "text-good" : "text-bad"}`}>
              {change > 0 ? "Up" : "Down"} {rupeesCompact(Math.abs(change))} in {months === 3 ? "3 months" : "a year"}
            </p>
          )}
        </div>
        <div role="group" aria-label="Range" className="flex shrink-0 gap-1 rounded-xl bg-sunk p-1">
          {([3, 12] as const).map((m) => (
            <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)} className={`min-h-9 rounded-lg px-3 text-sm ${months === m ? "bg-card font-medium shadow-sm" : "text-soft"}`}>
              {m === 3 ? "3M" : "1Y"}
            </button>
          ))}
        </div>
      </div>

      {spark && (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-14 w-full" role="img" aria-label={`Net worth over the last ${months === 3 ? "3 months" : "year"}`} preserveAspectRatio="none">
          <path d={spark.area} className="fill-brand/10" />
          <path d={spark.line} className="fill-none stroke-brand" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 flex min-h-11 w-full items-center justify-between text-sm text-brand">
        {open ? "Hide the breakdown" : "What makes it up"}
        <Chevron open={open} />
      </button>
      {open && (
        <>
          <NetWorthDetails overview={overview} />
          <Link to="/money" className="mt-2 inline-flex min-h-11 items-center text-sm text-brand">
            Open Money
          </Link>
        </>
      )}
    </Card>
  );
}
