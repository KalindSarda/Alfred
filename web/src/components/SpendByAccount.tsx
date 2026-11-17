import { useMemo } from "react";
import { transactionsLink } from "../filters";
import { rupeesCompact, shortDate } from "../format";
import { useAccounts, useSpendByAccount } from "../queries";
import { Link } from "../router";
import { accountColors, spendChange } from "../spend";
import { Amount, Card } from "./ui";

/** What the earlier stretch is called in the "more than" line, for each period. */
const BEFORE: Record<string, string> = { cycle: "last month", "30d": "the 30 days before", "90d": "the 90 days before", ytd: "last year", "7d": "the week before", this_month: "last month", last_month: "the month before" };

/** Where spending came from: each account's share, and, when there is an earlier stretch to compare with, whether it is more or less. */
export function SpendByAccount({ period = "cycle" }: { period?: string }) {
  const spend = useSpendByAccount(period);
  const accounts = useAccounts(true);
  const colors = useMemo(() => accountColors(accounts.data ?? []), [accounts.data]);
  const d = spend.data;
  if (!d) return null;
  const compared = d.previousTotalPaise > 0;
  const before = BEFORE[period] ?? "before";

  return (
    <Card>
      <div className="mb-3 border-b border-brass/50 pb-2">
        <h2 className="font-display text-lg">Spent by account</h2>
        <p className="text-xs text-soft">
          {shortDate(d.period.from)} – {shortDate(d.period.to)}
          {compared && <>, against {shortDate(d.previousPeriod.from)} – {shortDate(d.previousPeriod.to)}</>}
        </p>
      </div>
      {d.accounts.length === 0 ? (
        <p className="text-sm text-soft">Nothing spent from your accounts in this period.</p>
      ) : (
        <ul className="space-y-3">
          {d.accounts.map((a) => {
            const change = compared ? spendChange(a.spentPaise, a.previousPaise) : null;
            return (
              <li key={a.id}>
                <Link to={transactionsLink({ account: a.id, type: "expense", from: d.period.from, to: d.period.to })} className="block min-h-11 rounded-lg py-1 hover:bg-hover">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">
                      {a.name}
                      {a.kind === "card" && <span className="ml-2 rounded bg-sunk px-1.5 py-0.5 text-xs font-normal text-soft">card</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <Amount paise={a.spentPaise} /> <span className="text-sm text-soft">{a.sharePct}%</span>
                    </span>
                  </span>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${Math.max(a.spentPaise > 0 ? 2 : 0, a.sharePct)}%`, background: colors.get(a.id) ?? "#6b7280" }} />
                  </span>
                  {change && (change.kind === "up" || change.kind === "down") && (
                    <span className={`mt-1 block text-xs ${change.kind === "up" ? "text-warn-ink" : "text-good"}`}>
                      {change.kind === "up" ? "↑" : "↓"} {rupeesCompact(change.paise)} {change.kind === "up" ? "more" : "less"} than {before}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
