import type { ReactNode } from "react";
import type { FoundationRow } from "../api";
import { rupeesCompact } from "../format";
import { planPath } from "../planView";
import { useBudgets, useEmergencyFund, useFire, useGoals, useLadder, useProtection } from "../queries";
import { Link } from "../router";
import { Card, Icon } from "./ui";

/** Done is green, in progress blue, needs attention amber; the long-term goal is purple. */
const STATUS_COLOR: Record<FoundationRow["status"], string> = { ok: "#1f8a5b", building: "#2b6cde", attention: "#d98a1f" };
const LONG_TERM = "#7a5ea8";
const barColor = (r: FoundationRow): string => (r.key === "fire" && r.status !== "ok" ? LONG_TERM : STATUS_COLOR[r.status]);

function Bar({ pct, color = "#2b6cde" }: { pct: number | null; color?: string }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
      <span className="block h-full rounded-full" style={{ background: color, width: `${Math.max(pct && pct > 0 ? 3 : 0, Math.min(100, pct ?? 0))}%` }} />
    </span>
  );
}

/** One place to go next: a title, one line of where it stands, and a link to the whole thing. */
function Summary({ to, title, icon, color, children }: { to: string; title: string; icon: string; color: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 hover:bg-hover">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-medium">{title}</span>
          <span className="text-sm text-brand">Open →</span>
        </span>
        <span className="mt-0.5 block space-y-1.5 text-sm text-soft">{children}</span>
      </span>
    </Link>
  );
}

/**
 * Plan at a glance: the foundations first (each with how far along you are), then the emergency fund, independence and
 * cover, then the budgets, goals and recurring entries you set up ahead. Each card opens its own view.
 */
export function PlanOverview() {
  const ladder = useLadder().data;
  const fund = useEmergencyFund().data;
  const fire = useFire().data;
  const cover = useProtection().data;
  const budgets = useBudgets().data;
  const goals = useGoals().data;

  const target = fund?.targets.lifestyle;
  const topGap = cover?.gaps.find((g) => g.severity === "high") ?? cover?.gaps[0];
  const overBudget = budgets?.items.filter((i) => i.status === "over").length ?? 0;

  return (
    <div className="space-y-3">
      {ladder && (
        <Card id="foundations" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg">Your foundations</h2>
            <Link to={planPath("foundations")} className="text-sm text-brand hover:underline">
              Open →
            </Link>
          </div>
          <ul className="space-y-3">
            {ladder.rows.map((r) => (
              <li key={r.key}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {r.title}
                    {ladder.attention?.key === r.key && <span className="ml-2 rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-ink">needs attention</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-soft">{r.pct === null ? "n/a" : `${Math.round(r.pct)}%`}</span>
                </span>
                <span className="mt-1 block">
                  <Bar pct={r.pct} color={barColor(r)} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {fund && (
        <Summary to={planPath("foundations")} title="Emergency fund" icon="shield" color="#2b6cde">
          {target?.pct != null ? (
            <>
              <span className="block">
                {rupeesCompact(target.fundedPaise)} of {rupeesCompact(target.totalPaise ?? 0)} for your lifestyle goal · {Math.round(target.pct)}%
              </span>
              <Bar pct={target.pct} color="#2b6cde" />
            </>
          ) : (
            <span className="block">Set a target to see how far along you are.</span>
          )}
        </Summary>
      )}

      {fire && (
        <Summary to={planPath("foundations")} title="Independence" icon="sunrise" color="#7a5ea8">
          {fire.numberPaise != null && fire.progressPct != null ? (
            <>
              <span className="block">
                {rupeesCompact(fire.corpus.totalPaise)} toward {rupeesCompact(fire.numberPaise)} · {Math.round(fire.progressPct)}%
                {fire.projection?.year ? ` · about ${fire.projection.year} at this pace` : ""}
              </span>
              <Bar pct={fire.progressPct} color={LONG_TERM} />
            </>
          ) : (
            <span className="block">Add your age and what you spend to see your number.</span>
          )}
        </Summary>
      )}

      {cover && (
        <Summary to={planPath("protection")} title="Protection" icon="heart" color="#0f8f6e">
          <span className="block">
            {cover.policies.length === 0 ? "No cover recorded." : `${cover.policies.length} ${cover.policies.length === 1 ? "policy" : "policies"} recorded.`}
            {topGap ? ` ${topGap.title}.` : cover.policies.length > 0 ? " No gaps found." : ""}
          </span>
        </Summary>
      )}

      {budgets && (
        <Summary to={planPath("budgets")} title="Budgets" icon="pie" color="#d98a1f">
          <span className="block">
            {budgets.items.length === 0
              ? "No monthly limits set yet."
              : `${rupeesCompact(budgets.totalSpentPaise)} spent of ${rupeesCompact(budgets.totalLimitPaise)}${overBudget > 0 ? ` · ${overBudget} over` : ""}`}
          </span>
        </Summary>
      )}

      {goals && (
        <Summary to={planPath("goals")} title="Savings goals" icon="target" color="#c2457a">
          <span className="block">
            {goals.goals.length === 0 ? "No goals yet." : `${rupeesCompact(goals.setAsidePaise)} put toward ${goals.goals.length} ${goals.goals.length === 1 ? "goal" : "goals"}`}
          </span>
        </Summary>
      )}

      <Summary to={planPath("recurring")} title="Recurring entries" icon="repeat" color="#6b7280">
        <span className="block">Rent, subscriptions, salary and SIPs added on their day.</span>
      </Summary>
    </div>
  );
}
