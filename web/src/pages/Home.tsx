import { useMemo, useState } from "react";
import { buildBriefing, cardsByDue, daysBetween, greeting, inDays } from "../alfred";
import { AlfredPanel } from "../components/Alfred";
import { Card, Empty, Spinner } from "../components/ui";
import { rupees, shortDate, today } from "../format";
import { useAccounts, useCategories, useMe, useSummary, useTransactions } from "../queries";
import { Link } from "../router";
import { amountSign, amountTone, describeTxn } from "../txn";

const PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "ytd", label: "Year to date" },
];

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
  const [period, setPeriod] = useState("30d");
  const me = useMe();
  const summary = useSummary(period);
  const briefingSummary = useSummary("30d");
  const accounts = useAccounts();
  const categories = useCategories();
  const recent = useTransactions({ q: "", accountId: "", type: "" });

  const accountMap = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const categoryMap = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);

  if (summary.isPending || accounts.isPending || briefingSummary.isPending) return <Spinner />;
  if (summary.isError || accounts.isError || briefingSummary.isError) {
    return <Empty title="Could not load your dashboard">Check your connection and reload.</Empty>;
  }

  if ((accounts.data ?? []).length === 0) {
    return (
      <div className="space-y-5">
        <AlfredPanel
          greeting={greeting(me.data?.displayName ?? "there", new Date())}
          lines={[
            { key: "start", text: "Nothing is recorded yet. Add a bank account or credit card and I will take it from there.", to: "/accounts" },
            { key: "demo", text: "Or try me with sample data first, from More.", to: "/more" },
          ]}
        />
      </div>
    );
  }

  const s = summary.data;
  const todayDate = today();
  const lines = buildBriefing(briefingSummary.data, accounts.data ?? [], todayDate, shortDate);
  const dueCards = cardsByDue(accounts.data ?? []);
  const latest = (recent.data?.pages[0]?.items ?? []).slice(0, 6);

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Cash flow</h1>

      <AlfredPanel greeting={greeting(me.data?.displayName ?? "there", new Date())} lines={lines} />

      <section aria-label="Cash flow summary" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display mr-auto text-xl">Cash flow</h2>
          <label className="sr-only" htmlFor="period">
            Period
          </label>
          <select
            id="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="min-h-11 rounded-xl border border-line bg-card px-3 text-base"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-soft">
            {shortDate(s.period.from)} – {shortDate(s.period.to)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Income" value={rupees(s.incomePaise)} tone="good" />
          <Tile label="Expense" value={rupees(s.expensePaise)} />
          <Tile label="Net" value={rupees(s.netPaise)} tone={s.netPaise >= 0 ? "good" : "bad"} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle to="/accounts" action="All accounts">
            Coming up
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

      <Card>
        <SectionTitle>Where the money went</SectionTitle>
        <p className="text-sm text-soft">
          The cash flow chart and the Profit and loss table arrive in the next update. The totals above are already live.
        </p>
      </Card>
    </div>
  );
}
