import { useState } from "react";
import { ActivityTabs } from "../components/ActivityTabs";
import { Breakdown } from "../components/Breakdown";
import { CashflowCard } from "../components/CashflowCard";
import { NetWorthTrend } from "../components/NetWorthTrend";
import { SpendByAccount } from "../components/SpendByAccount";
import { useWide } from "../useWide";

const PERIODS = [
  { key: "cycle", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "This year" },
] as const;

/** The charts in one place: where the money went, by category and merchant, by account, and net worth over time. */
export function Trends() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("cycle");
  const wide = useWide();

  return (
    <div className="space-y-4">
      <h1 className="text-3xl">Activity</h1>
      <ActivityTabs current="trends" />

      <div role="group" aria-label="Period" className="flex gap-1 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={period === p.key}
            onClick={() => setPeriod(p.key)}
            className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-medium ${period === p.key ? "bg-brand text-white" : "bg-sunk text-soft"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <CashflowCard period={period} />
      <SpendByAccount period={period} />
      <Breakdown period={period} stacked={!wide} />
      <NetWorthTrend />
    </div>
  );
}
