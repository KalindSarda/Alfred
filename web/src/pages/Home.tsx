import { useMemo } from "react";
import { daysBetween, inDays } from "../../../src/alfred/voice";
import type { CardAccount } from "../api";
import { AlfredPanel } from "../components/Alfred";
import { Breakdown } from "../components/Breakdown";
import { CashflowCard } from "../components/CashflowCard";
import { Card, Empty, Spinner } from "../components/ui";
import { rupees, shortDate, today } from "../format";
import { emptyFilters } from "../filters";
import { NetWorthStrip } from "../components/NetWorth";
import { useAccounts, useBalanceOverview, useBriefing, useCategories, useSummary, useTransactions } from "../queries";
import { Link } from "../router";
import { amountSign, amountTone, describeTxn } from "../txn";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "";
  return (
    <Card pad="p-3 md:p-4">
      <p className="text-xs tracking-wide text-soft uppercase">{label}</p>
      <p className={`font-display mt-1 text-xl tabular-nums md:text-2xl ${color}`}>{value}</p>
    </Card>
  );
}

function SectionTitle({ children, to, action }: { children: string; to?: string; action?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between border-b border-brass/50 pb-2">
      <h2 className="font-display text-lg">{children}</h2>
      {to && action && (
        <Link to={to} className="text-sm text-brand hover:underline">
          {action}
        </Link>
      )}
    </div>
  );
}

export function Home() {
  // The user's own month: calendar month by default, or from their payday (set in More).
  const period = "cycle";
  const briefing = useBriefing();
  const summary = useSummary(period);
  const accounts = useAccounts();
  const overview = useBalanceOverview();
  const categories = useCategories();
  const recent = useTransactions(emptyFilters);

  const accountMap = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoryMap = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  if (summary.isPending || accounts.isPending || briefing.isPending) return <Spinner />;
  if (summary.isError || accounts.isError || briefing.isError) {
    return <Empty title="Could not load your dashboard">Check your connection and reload.</Empty>;
  }

  const b = briefing.data;
  const panel = <AlfredPanel greeting={b.greeting} subline={b.subline} lines={b.lines} footer={b.footer} />;
  if ((accounts.data ?? []).length === 0) return <div className="space-y-5">{panel}</div>;

  const s = summary.data;
  const todayDate = today();
  const dueCards = (accounts.data ?? [])
    .filter((a): a is CardAccount => a.kind === "card" && !a.archived)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const latest = (recent.data?.pages[0]?.items ?? []).slice(0, 6);

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Cash flow</h1>

      {panel}

      <section aria-label="Cash flow summary" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-display text-xl">Cash flow</h2>
          <span className="text-sm text-soft">
            {shortDate(s.period.from)} – {shortDate(s.period.to)}
            {" · "}
            <Link to="/more" className="text-brand hover:underline">
              change month start
            </Link>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Income" value={rupees(s.incomePaise)} tone="good" />
          <Tile label="Expense" value={rupees(s.expensePaise)} />
          <Tile label="Net" value={rupees(s.netPaise)} tone={s.netPaise >= 0 ? "good" : "bad"} />
        </div>
      </section>

      {overview.data && <NetWorthStrip overview={overview.data} />}

      <CashflowCard period={period} />

      <Breakdown period={period} />


      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle to="/accounts" action="All accounts">
            Upcoming payments
          </SectionTitle>
          {dueCards.length === 0 ? (
            <p className="text-sm text-soft">No credit cards added yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {dueCards.map((c) => (
                <li key={c.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-sm text-soft">
                      Due {shortDate(c.nextDueDate)} · {inDays(daysBetween(todayDate, c.nextDueDate))}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{rupees(c.statementOutstandingPaise)}</span>
                    <span className="block text-xs text-soft">Unbilled {rupees(c.unbilledPaise)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle to="/transactions" action="See all">
            Recent
          </SectionTitle>
          {latest.length === 0 ? (
            <p className="text-sm text-soft">Nothing recorded yet. Use New to add your first entry.</p>
          ) : (
            <ul className="divide-y divide-line">
              {latest.map((t) => {
                const { title, sub } = describeTxn(t, accountMap, categoryMap);
                return (
                  <li key={t.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{title}</span>
                      <span className="block truncate text-sm text-soft">
                        {shortDate(t.txnDate)} · {sub}
                      </span>
                    </span>
                    <span className={`shrink-0 font-semibold tabular-nums ${amountTone(t.type)}`}>
                      {amountSign(t.type)}
                      {rupees(t.amountPaise)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
