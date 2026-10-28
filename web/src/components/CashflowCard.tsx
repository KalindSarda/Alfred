import { useMemo } from "react";
import { buildFlow } from "../cashflow";
import { useCashflow } from "../queries";
import { Sankey } from "./Sankey";
import { Card, Empty } from "./ui";

/** "Where the money went": income flowing through to expenses and savings for the chosen period. */
export function CashflowCard({ period }: { period: string }) {
  const query = useCashflow(period, "category");
  const model = useMemo(() => (query.data ? buildFlow(query.data) : null), [query.data]);

  return (
    <Card>
      <div className="mb-3 border-b border-brass/50 pb-2">
        <h2 className="font-display text-lg">Where the money went</h2>
      </div>

      {query.isPending ? (
        <p className="py-8 text-center text-sm text-soft">Loading…</p>
      ) : query.isError ? (
        <Empty title="Could not load the cash flow">Check your connection and reload.</Empty>
      ) : !model ? (
        <Empty title="Nothing to chart in this period">Income and expenses you record will flow through here.</Empty>
      ) : (
        <Sankey model={model} />
      )}
    </Card>
  );
}
