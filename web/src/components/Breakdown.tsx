import { useState } from "react";
import type { Cashflow, CashflowRow } from "../api";
import { transactionsLink } from "../filters";
import { rupees } from "../format";
import { useCashflow } from "../queries";
import { Link } from "../router";
import { rowFilters } from "./ProfitLoss";
import { Card } from "./ui";

const BAR_COLORS = ["bg-brand", "bg-orb", "bg-brass", "bg-good", "bg-soft"];
const COLLAPSED = 6;

function List({ data, rows, type }: { data: Cashflow; rows: CashflowRow[]; type: "income" | "expense" }) {
  const [all, setAll] = useState(false);
  const total = type === "income" ? data.incomePaise : data.expensePaise;
  const shown = all ? rows : rows.slice(0, COLLAPSED);

  if (rows.length === 0) return <p className="text-sm text-soft">Nothing recorded in this period.</p>;
  return (
    <>
      <ul className="space-y-3">
        {shown.map((r, i) => {
          const share = total > 0 ? (r.amountPaise / total) * 100 : 0;
          const linkable = !(data.groupBy === "merchant" && r.key === "");
          const content = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{r.name}</span>
                <span className="shrink-0 tabular-nums">
                  {rupees(r.amountPaise)} <span className="text-sm text-soft">{Math.round(share * 10) / 10}%</span>
                </span>
              </span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
                <span className={`block h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`} style={{ width: `${Math.max(2, share)}%` }} />
              </span>
            </>
          );
          return (
            <li key={r.key}>
              {linkable ? (
                <Link to={transactionsLink(rowFilters(data, r, type))} className="block min-h-11 rounded-lg py-1 hover:bg-hover">
                  {content}
                </Link>
              ) : (
                <div className="py-1">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > COLLAPSED && (
        <button type="button" className="mt-3 min-h-11 text-sm text-brand hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

function Panel({ period, type }: { period: string; type: "income" | "expense" }) {
  const [groupBy, setGroupBy] = useState<"category" | "merchant">("category");
  const query = useCashflow(period, groupBy);
  const title = type === "income" ? "Income" : "Expenses";

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-brass/50 pb-2">
        <h2 className="font-display text-lg">{title}</h2>
        <div role="group" aria-label={`Group ${title.toLowerCase()} by`} className="flex gap-1 rounded-xl bg-sunk p-1">
          {(["category", "merchant"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={groupBy === g}
              onClick={() => setGroupBy(g)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium capitalize ${groupBy === g ? "bg-card shadow-sm" : "text-soft"}`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      {query.isPending ? (
        <p className="text-sm text-soft">Loading…</p>
      ) : query.isError ? (
        <p className="text-sm text-bad">Could not load this breakdown.</p>
      ) : (
        <List data={query.data} rows={type === "income" ? query.data.income : query.data.expenses} type={type} />
      )}
    </Card>
  );
}

/** Two cards side by side: where income came from and where it went, with proportional bars. */
export function Breakdown({ period }: { period: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel period={period} type="income" />
      <Panel period={period} type="expense" />
    </div>
  );
}
