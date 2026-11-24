import { useMemo, useState } from "react";
import { type Holding, type InvestmentTrend } from "../api";
import { rupees, rupeesCompact } from "../format";
import { type GainBar, type Range, RANGES, gainAt, gainBars, netPutIn, pointLabel, seriesColors, stackColumn, trendSummary, worthPaths, xAt } from "../investmentCharts";
import { useHoldings, useInvestmentTrend } from "../queries";
import { Card } from "./ui";

const W = 600;
const H = 150;
const PAD = 10;

const signed = (paise: number) => `${paise > 0 ? "+" : paise < 0 ? "−" : ""}${rupees(Math.abs(paise))}`;
const tone = (paise: number) => (paise > 0 ? "text-good" : paise < 0 ? "text-bad" : "text-soft");

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-brass/50 pb-2">
      <h3 className="font-display text-lg">{title}</h3>
      {note && <span className="text-sm text-soft">{note}</span>}
    </div>
  );
}

function Key({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-soft">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`inline-block h-0.5 w-4 ${i.dashed ? "border-t-2 border-dashed bg-transparent" : ""}`} style={i.dashed ? { borderColor: i.color } : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </p>
  );
}

/** Worth and what was put in, two lines on one scale; the tinted gap between them is the gain. */
function WorthCard({ trend, range }: { trend: InvestmentTrend; range: Range }) {
  const pts = trend.points;
  const [picked, setPicked] = useState<number | null>(null);
  const i = picked ?? pts.length - 1;
  const p = pts[i];
  const paths = useMemo(() => worthPaths(pts, W, H, PAD), [pts]);
  if (!p) return null;
  const g = gainAt(p);
  const slot = (W - 2 * PAD) / Math.max(1, pts.length - 1);
  return (
    <Card>
      <Head title="Worth and what you put in" note={RANGES.find((r) => r.key === range)?.note ?? ""} />
      <p className="text-sm text-soft" aria-live="polite">
        {pointLabel(p.asOf, range)} · worth <span className="font-medium text-ink">{rupees(p.worthPaise)}</span> · put in {rupees(netPutIn(p))} · <span className={tone(g.gainPaise)}>gain {signed(g.gainPaise)}{g.pct !== null ? ` (${g.pct}%)` : ""}</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" role="img" aria-label={trendSummary(trend, rupees)} onMouseLeave={() => setPicked(null)}>
        {paths.gap && <path d={paths.gap} className={g.gainPaise >= 0 ? "fill-good/15" : "fill-bad/15"} />}
        <path d={paths.putIn} className="fill-none stroke-soft" strokeWidth="2" strokeDasharray="5 4" />
        <path d={paths.worth} className="fill-none stroke-brand" strokeWidth="2.5" />
        <circle cx={paths.xs[i]} cy={paths.ys[i]} r="5" className="fill-brand" />
        {pts.map((q, k) => (
          <rect key={q.asOf} x={(paths.xs[k] as number) - slot / 2} y="0" width={slot} height={H} fill="transparent" onMouseEnter={() => setPicked(k)} onClick={() => setPicked(k)}>
            <title>{`${pointLabel(q.asOf, range)}: ${rupees(q.worthPaise)}`}</title>
          </rect>
        ))}
      </svg>
      <Key
        items={[
          { label: "Worth", color: "var(--brand)" },
          { label: "Put in", color: "var(--soft)", dashed: true },
        ]}
      />
      <p className="mt-1 flex justify-between text-xs text-soft">
        <span>{pointLabel(pts[0]?.asOf ?? p.asOf, range)}</span>
        <span>{pointLabel(pts.at(-1)?.asOf ?? p.asOf, range)}</span>
      </p>
    </Card>
  );
}

/** How the mix has moved: a stacked column for each day, by kind or by broker account. */
function MixCard({ trend, range }: { trend: InvestmentTrend; range: Range }) {
  const [by, setBy] = useState<"kind" | "broker">("kind");
  const [picked, setPicked] = useState<number | null>(null);
  const series = by === "kind" ? trend.byKind : trend.byBroker;
  const colors = seriesColors(series, by);
  const n = trend.points.length;
  const i = picked ?? n - 1;
  const totals = trend.points.map((_, k) => series.reduce((s, x) => s + Math.max(0, x.worthPaise[k] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = (W - 2 * PAD) / Math.max(1, n);
  const barW = Math.max(2, slot * 0.72);
  const total = totals[i] ?? 0;
  return (
    <Card>
      <Head title="What you hold, over time" note={RANGES.find((r) => r.key === range)?.note ?? ""} />
      <div role="group" aria-label="Group by" className="mb-2 inline-flex gap-1 rounded-xl bg-sunk p-1">
        {(
          [
            ["kind", "By kind"],
            ["broker", "By account"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={by === key} onClick={() => setBy(key)} className={`min-h-11 rounded-lg px-3 text-sm font-medium ${by === key ? "bg-card shadow-sm" : "text-soft"}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-soft" aria-live="polite">
        {pointLabel(trend.points[i]?.asOf ?? "", range)} · <span className="font-medium text-ink">{rupees(total)}</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" role="img" aria-label={`What you hold ${by === "kind" ? "by kind" : "by account"}: ${series.map((s) => `${s.name} ${rupeesCompact(s.worthPaise.at(-1) ?? 0)}`).join(", ")}`} onMouseLeave={() => setPicked(null)}>
        {trend.points.map((q, k) => {
          const x = PAD + k * slot + (slot - barW) / 2;
          return (
            <g key={q.asOf} opacity={picked === null || picked === k ? 1 : 0.55} onMouseEnter={() => setPicked(k)} onClick={() => setPicked(k)}>
              <rect x={PAD + k * slot} y="0" width={slot} height={H} fill="transparent" />
              {stackColumn(series, k, max, H - PAD).map((seg) => (
                <rect key={seg.key} x={x} y={seg.y + PAD / 2} width={barW} height={Math.max(0.5, seg.h)} fill={colors[series.findIndex((s) => s.key === seg.key)]} />
              ))}
              <title>{`${pointLabel(q.asOf, range)}: ${rupees(totals[k] ?? 0)}`}</title>
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {series.map((s, k) => {
          const v = Math.max(0, s.worthPaise[i] ?? 0);
          return (
            <li key={s.key} className="flex items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: colors[k] }} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="shrink-0 text-soft tabular-nums">
                {rupeesCompact(v)}
                {total > 0 && ` · ${Math.round((v / total) * 1000) / 10}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** For each period, money you added beside what the market did: the split of the change in worth. */
function AddedCard({ trend, range }: { trend: InvestmentTrend; range: Range }) {
  const pts = trend.points.slice(1);
  const [picked, setPicked] = useState<number | null>(null);
  if (pts.length < 1) return null;
  const i = picked ?? pts.length - 1;
  const p = pts[i];
  const reach = Math.max(1, ...pts.flatMap((q) => [Math.abs(q.addedPaise), Math.abs(q.growthPaise)]));
  const mid = H / 2;
  const unit = (mid - PAD) / reach;
  const slot = (W - 2 * PAD) / pts.length;
  const barW = Math.max(2, Math.min(18, slot * 0.36));
  const added = pts.reduce((s, q) => s + q.addedPaise, 0);
  const growth = pts.reduce((s, q) => s + q.growthPaise, 0);
  const bar = (v: number, x: number, cls: string) => <rect x={x} y={v >= 0 ? mid - v * unit : mid} width={barW} height={Math.max(0.5, Math.abs(v) * unit)} className={cls} />;
  return (
    <Card>
      <Head title="Money added, and what the market did" note={RANGES.find((r) => r.key === range)?.note ?? ""} />
      <p className="text-sm text-soft" aria-live="polite">
        {p ? (
          <>
            {pointLabel(p.asOf, range)} · added <span className="font-medium text-ink">{signed(p.addedPaise)}</span> · market <span className={tone(p.growthPaise)}>{signed(p.growthPaise)}</span>
          </>
        ) : null}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" role="img" aria-label={`Over this time you added ${rupees(added)} and the market moved your worth by ${signed(growth)}.`} onMouseLeave={() => setPicked(null)}>
        <line x1={PAD} x2={W - PAD} y1={mid} y2={mid} className="stroke-line" strokeWidth="1" />
        {pts.map((q, k) => {
          const cx = PAD + k * slot + slot / 2;
          return (
            <g key={q.asOf} opacity={picked === null || picked === k ? 1 : 0.55} onMouseEnter={() => setPicked(k)} onClick={() => setPicked(k)}>
              <rect x={PAD + k * slot} y="0" width={slot} height={H} fill="transparent" />
              {bar(q.addedPaise, cx - barW - 1, "fill-brand")}
              {bar(q.growthPaise, cx + 1, q.growthPaise >= 0 ? "fill-good" : "fill-bad")}
              <title>{`${pointLabel(q.asOf, range)}: added ${signed(q.addedPaise)}, market ${signed(q.growthPaise)}`}</title>
            </g>
          );
        })}
      </svg>
      <Key
        items={[
          { label: "Money you added", color: "var(--brand)" },
          { label: "Market, up", color: "var(--good)" },
          { label: "Market, down", color: "var(--bad)" },
        ]}
      />
      <p className="mt-1 text-sm text-soft">
        Over this time: added <span className="font-medium text-ink">{signed(added)}</span>, market <span className={tone(growth)}>{signed(growth)}</span>.
      </p>
    </Card>
  );
}

/** Each investment's gain, best to worst: a bar to the right when it is up, to the left when it is down. */
function GainCard({ holdings }: { holdings: Holding[] }) {
  const [all, setAll] = useState(false);
  const bars: GainBar[] = useMemo(() => gainBars(holdings), [holdings]);
  if (bars.length === 0) return null;
  const shown = all ? bars : bars.slice(0, 8);
  const total = bars.reduce((s, b) => s + b.gainPaise, 0);
  return (
    <Card>
      <Head title="Gain by investment" note={`${bars.length} ${bars.length === 1 ? "investment" : "investments"}`} />
      <ul className="space-y-2">
        {shown.map((b) => (
          <li key={b.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-medium">{b.name}</span> <span className="text-xs text-faint">{b.kindName}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${tone(b.gainPaise)}`}>
                {signed(b.gainPaise)}
                {b.pct !== null && <span className="text-xs"> ({b.pct > 0 ? "+" : b.pct < 0 ? "−" : ""}{Math.abs(b.pct)}%)</span>}
              </span>
            </div>
            <div className="mt-1 flex h-2" aria-hidden="true">
              <span className="flex w-1/2 justify-end">{b.gainPaise < 0 && <span className="block h-full rounded-l-full bg-bad" style={{ width: `${Math.max(2, b.share * 100)}%` }} />}</span>
              <span className="block w-px bg-line" />
              <span className="flex w-1/2">{b.gainPaise > 0 && <span className="block h-full rounded-r-full bg-good" style={{ width: `${Math.max(2, b.share * 100)}%` }} />}</span>
            </div>
          </li>
        ))}
      </ul>
      {bars.length > 8 && (
        <button type="button" className="mt-1 min-h-11 text-sm text-brand" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${bars.length}`}
        </button>
      )}
      <p className="mt-1 text-sm text-soft">
        Together: <span className={tone(total)}>{signed(total)}</span>
      </p>
    </Card>
  );
}

/** The investments section of Trends: worth against what you put in, the mix over time, money added against the market, and gain by investment. */
export function InvestmentCharts() {
  const [range, setRange] = useState<Range>("1y");
  const trend = useInvestmentTrend(range);
  const holdings = useHoldings("all");
  const active = (holdings.data?.holdings ?? []).filter((h) => h.status === "active");
  if (holdings.isPending || active.length === 0) return null;
  const data = trend.data;
  return (
    <section aria-labelledby="investment-charts" className="space-y-4" id="investment-charts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="investment-charts" className="font-display text-xl">
          Investments
        </h2>
        <div role="group" aria-label="Range" className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)} className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-medium ${range === r.key ? "bg-brand text-white" : "bg-sunk text-soft"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {trend.isPending && <p className="py-4 text-center text-sm text-soft">Loading…</p>}
      {data && data.points.length >= 2 ? (
        <>
          <WorthCard trend={data} range={range} />
          <MixCard trend={data} range={range} />
          <AddedCard trend={data} range={range} />
        </>
      ) : (
        data && (
          <Card>
            <p className="text-sm text-soft">Not enough history for this range yet. Worth over time builds up as prices are fetched each week, and from the values you type.</p>
          </Card>
        )
      )}
      <GainCard holdings={active} />
      {data && data.points.length >= 2 && <p className="text-xs text-faint">Before prices were linked, history is only as fine as the values you typed then, so older periods can look flat or stepped. Only your share of anything shared counts.</p>}
    </section>
  );
}
