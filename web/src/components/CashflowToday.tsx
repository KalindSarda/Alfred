import { useMemo, useState } from "react";
import { barSegments, buildFlow } from "../cashflow";
import { rupeesCompact, shortDate } from "../format";
import { useCashflow } from "../queries";
import { Link } from "../router";
import { Sankey } from "./Sankey";
import { Amount, Card, Empty, Sheet } from "./ui";

/**
 * This month at a glance: income, spending and what is left, then one stacked bar of where it went with a legend.
 * Tapping the bar or "Full flow" opens the whole Sankey.
 */
export function CashflowToday({ period }: { period: string }) {
  const query = useCashflow(period, "category");
  const [full, setFull] = useState(false);
  const model = useMemo(() => (query.data ? buildFlow(query.data) : null), [query.data]);
  const segments = useMemo(() => (model ? barSegments(model) : []), [model]);
  const d = query.data;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 border-b border-brass/50 pb-2">
        <h2 className="font-display text-lg">Cash flow</h2>
        {d && (
          <span className="text-sm text-soft">
            {shortDate(d.period.from)} – {shortDate(d.period.to)} ·{" "}
            <Link to="/settings#month" className="text-brand hover:underline">
              month start
            </Link>
          </span>
        )}
      </div>

      {query.isPending ? (
        <p className="py-8 text-center text-sm text-soft">Loading…</p>
      ) : query.isError || !d ? (
        <Empty title="Could not load the cash flow">Check your connection and reload.</Empty>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-xs tracking-wide text-soft uppercase">Income</dt>
              <dd className="font-display text-xl tabular-nums text-good"><Amount paise={d.incomePaise} /></dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-soft uppercase">Spent</dt>
              <dd className="font-display text-xl tabular-nums"><Amount paise={d.expensePaise} /></dd>
            </div>
            <div>
              <dt className="text-xs tracking-wide text-soft uppercase">{d.surplusPaise >= 0 ? "Left" : "Over"}</dt>
              <dd className={`font-display text-xl tabular-nums ${d.surplusPaise >= 0 ? "text-good" : "text-bad"}`}>
                <Amount paise={Math.abs(d.surplusPaise)} />
              </dd>
            </div>
          </dl>

          {segments.length === 0 ? (
            <p className="mt-4 text-sm text-soft">Income and expenses you record will show here.</p>
          ) : (
            <>
              <button type="button" onClick={() => setFull(true)} aria-label="Open the full cash flow" className="mt-4 block w-full">
                <span className="flex h-5 w-full overflow-hidden rounded-full bg-sunk">
                  {segments.map((s) => (
                    <span key={s.id} title={`${s.label}: ${s.pct}%`} style={{ width: `${s.pct}%`, background: s.color }} className="block h-full border-r border-card last:border-r-0" />
                  ))}
                </span>
              </button>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {segments.map((s) => (
                  <li key={s.id} className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <span className="shrink-0 text-soft tabular-nums">{rupeesCompact(s.amountPaise)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setFull(true)} className="mt-3 min-h-11 text-sm text-brand">
                Full flow
              </button>
            </>
          )}
        </>
      )}

      {full && model && (
        <Sheet title="Where the money went" wide onClose={() => setFull(false)}>
          <Sankey model={model} />
        </Sheet>
      )}
    </Card>
  );
}
