import { useState } from "react";
import { Link } from "../router";
import { Card, Empty, Spinner } from "../components/ui";
import { rupees, shortDate } from "../format";
import { useAccounts, useSummary } from "../queries";

const PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "ytd", label: "Year to date" },
];

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "";
  return (
    <Card className="p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </Card>
  );
}

export function Home() {
  const [period, setPeriod] = useState("30d");
  const summary = useSummary(period);
  const accounts = useAccounts();

  if (summary.isPending || accounts.isPending) return <Spinner />;
  if (summary.isError || accounts.isError) return <Empty title="Could not load your dashboard">Check your connection and reload.</Empty>;

  const s = summary.data;
  if ((accounts.data ?? []).length === 0) {
    return (
      <Empty title="Welcome! Let's set things up">
        <p>
          Start by adding a bank account or credit card in <Link to="/accounts" className="font-medium text-emerald-700 underline dark:text-emerald-400">Accounts and cards</Link>, or
          try the app with sample data from <Link to="/more" className="font-medium text-emerald-700 underline dark:text-emerald-400">More</Link>.
        </p>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cash flow</h1>

      <Card className="bg-emerald-600 text-white dark:border-emerald-700 dark:bg-emerald-700">
        <p className="text-sm text-emerald-100">Safe to spend (available now)</p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{rupees(s.safeToSpendPaise)}</p>
        <p className="mt-2 text-xs text-emerald-100">Counted bank balances minus everything owed on your cards.</p>
      </Card>

      <div>
        <label className="sr-only" htmlFor="period">
          Period
        </label>
        <select
          id="period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-900"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="ml-3 text-sm text-slate-500">
          {shortDate(s.period.from)} – {shortDate(s.period.to)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Income" value={rupees(s.incomePaise)} tone="good" />
        <Tile label="Expense" value={rupees(s.expensePaise)} />
        <Tile label="Net" value={rupees(s.netPaise)} tone={s.netPaise >= 0 ? "good" : "bad"} />
      </div>

      {s.reviewCount > 0 && (
        <Link to="/transactions" className="flex min-h-11 items-center justify-between rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>
            {s.reviewCount} transaction{s.reviewCount === 1 ? "" : "s"} uncategorized or waiting for review
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      )}

      <Card>
        <h2 className="font-medium">Where the money went</h2>
        <p className="mt-1 text-sm text-slate-500">
          The cash flow chart and Profit and loss table arrive in the next update. Your totals above are already live.
        </p>
      </Card>
    </div>
  );
}
