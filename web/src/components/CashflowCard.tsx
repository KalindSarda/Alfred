import { useMemo, useState } from "react";
import { buildFlow } from "../cashflow";
import { useCashflow } from "../queries";
import { ProfitLoss } from "./ProfitLoss";
import { Sankey } from "./Sankey";
import { Card, Empty } from "./ui";

type View = "sankey" | "pnl";

/** "Where the money went": a Sankey on wide screens, the Profit and loss table on phones (switchable). */
export function CashflowCard({ period }: { period: string }) {
  const [view, setView] = useState<View>(() => (window.innerWidth >= 768 ? "sankey" : "pnl"));
  const query = useCashflow(period, "category");
  const model = useMemo(() => (query.data ? buildFlow(query.data) : null), [query.data]);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-brass/50 pb-2">
        <h2 className="font-display text-lg">Where the money went</h2>
        <div role="group" aria-label="Chart view" className="flex gap-1 rounded-xl bg-sunk p-1">
          {(
            [
              ["sankey", "Sankey"],
              ["pnl", "Profit and loss"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium ${view === value ? "bg-card shadow-sm" : "text-soft"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <p className="py-8 text-center text-sm text-soft">Loading…</p>
      ) : query.isError ? (
        <Empty title="Could not load the cash flow">Check your connection and reload.</Empty>
      ) : !model ? (
        <Empty title="Nothing to chart in this period">Income and expenses you record will flow through here.</Empty>
      ) : view === "sankey" ? (
        <Sankey model={model} />
      ) : (
        <ProfitLoss data={query.data} />
      )}
    </Card>
  );
}
