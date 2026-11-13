import { useMemo } from "react";
import { daysBetween, inDays } from "../../../src/alfred/voice";
import type { CardAccount } from "../api";
import { AlfredPanel } from "../components/Alfred";
import { Breakdown } from "../components/Breakdown";
import { CashflowCard } from "../components/CashflowCard";
import { CashflowToday } from "../components/CashflowToday";
import { CommitmentsCard } from "../components/Commitments";
import { NetWorthStrip } from "../components/NetWorth";
import { NetWorthToday } from "../components/NetWorthToday";
import { Shortcuts } from "../components/Shortcuts";
import { Card, Empty, Spinner } from "../components/ui";
import { emptyFilters } from "../filters";
import { rupees, rupeesCompact, shortDate, today } from "../format";
import { useAccounts, useBalanceOverview, useBriefing, useCategories, useSummary, useTransactions } from "../queries";
import { Link } from "../router";
import { amountSign, amountTone, describeTxn } from "../txn";
import { useWide } from "../useWide";

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

/** Income, expense and net for the month as plain tiles; the wide layout's cash flow heading. */
function CashflowTiles({ period }: { period: string }) {
  const summary = useSummary(period);
  if (!summary.data) return null;
  const s = summary.data;
  return (
    <section aria-label="Cash flow summary" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-display text-xl">Cash flow</h2>
        <span className="text-sm text-soft">
          {shortDate(s.period.from)} – {shortDate(s.period.to)}
          {" · "}
          <Link to="/settings#month" className="text-brand hover:underline">
            change month start
          </Link>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Income" value={rupeesCompact(s.incomePaise)} tone="good" />
        <Tile label="Expense" value={rupeesCompact(s.expensePaise)} />
        <Tile label="Net" value={rupeesCompact(s.netPaise)} tone={s.netPaise >= 0 ? "good" : "bad"} />
      </div>
    </section>
  );
}

export function Home() {
  // The user's own month: calendar month by default, or from their payday (set in Settings).
  const period = "cycle";
  const wide = useWide();
  const briefing = useBriefing();
  const accounts = useAccounts();
  const overview = useBalanceOverview();
  const categories = useCategories();
  const recent = useTransactions(emptyFilters);

  const accountMap = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoryMap = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  if (accounts.isPending || briefing.isPending) return <Spinner />;
  if (accounts.isError || briefing.isError) {
    return <Empty title="Could not load your dashboard">Check your connection and reload.</Empty>;
  }

  const b = briefing.data;
  // A phone gets a three-line glance that opens in place; a bigger screen shows the whole briefing.
  const panel = <AlfredPanel greeting={b.greeting} subline={b.subline} lines={b.lines} sections={b.sections} footer={b.footer} compact={!wide} />;
  if ((accounts.data ?? []).length === 0) return <div className="space-y-5">{panel}</div>;

  const todayDate = today();
  const dueCards = (accounts.data ?? [])
    .filter((a): a is CardAccount => a.kind === "card" && !a.archived)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  const latest = (recent.data?.pages[0]?.items ?? []).slice(0, 6);

  const comingUp = (
    <Card>
      <SectionTitle to="/money" action="All accounts">
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
  );

  const recentCard = (
    <Card>
      <SectionTitle to="/activity" action="See all">
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
  );

  // Phone: the briefing, what is free, how the month went, net worth, the shortcuts, what is coming, recent entries,
  // then where income came from (only if any did) and where spending went.
  if (!wide) {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">Today</h1>
        {panel}
        <CommitmentsCard />
        <CashflowToday period={period} />
        {overview.data && <NetWorthToday overview={overview.data} />}
        {overview.data && <Shortcuts overview={overview.data} />}
        {comingUp}
        {recentCard}
        <Breakdown period={period} stacked />
      </div>
    );
  }

  // Tablet and desktop: the wide single column, with the whole Sankey drawn in the page.
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Today</h1>
      {panel}
      <CommitmentsCard />
      {overview.data && <Shortcuts overview={overview.data} />}
      <CashflowTiles period={period} />
      {overview.data && <NetWorthStrip overview={overview.data} />}
      <CashflowCard period={period} />
      <Breakdown period={period} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {comingUp}
        {recentCard}
      </div>
    </div>
  );
}
