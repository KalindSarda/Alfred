import { and, eq, isNull } from "drizzle-orm";
import {
  type Briefing,
  BRIEFING_FOOTER,
  buildBriefingLines,
  composeBriefing,
  emptyBriefingLines,
  greeting,
  subline,
} from "../alfred/voice";
import type { Db } from "../db/client";
import { accounts } from "../db/schema";
import { addDays, type IstDate, parseIstDate } from "../domain/dates";
import { formatRupees, formatRupeesCompact } from "../domain/money";
import { balanceOverview } from "./accounts";
import { listDebts } from "./debts";
import { listGoals } from "./goals";
import { getCommitments } from "./commitments";
import { lastLoggedDate } from "./habit";
import { listHoldings } from "./holdings";
import { listLoans } from "./loans";
import { STALE_AFTER_DAYS } from "../domain/holdings";
import { getMe } from "./auth";
import { daysBetween } from "../alfred/voice";
import { listBudgets } from "./budgets";
import { listPlans } from "./emi";
import { listRules } from "./recurring";
import { listHolds } from "./holds";
import { getSummary } from "./dashboard";
import { listAccountsWithFigures } from "./ledger";
import { getLadder } from "./ladder";
import { listPolicies } from "./protection";
import { getSettings } from "./settings";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Nov" from an IST date. */
function shortDate(date: IstDate): string {
  const { month, day } = parseIstDate(date);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * Alfred's briefing for the Home screen. Facts come from the ledger; the wording comes from his voice module.
 * The response shape is what an AI-written briefing will return later, with `source` switching to "ai".
 */
export async function getBriefing(db: Db, userId: string, today: IstDate, now: Date, options: { compact?: boolean } = {}): Promise<Briefing> {
  const [me, [anyAccount]] = await Promise.all([
    getMe(db, userId),
    db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt))).limit(1),
  ]);

  const base = { greeting: greeting(me.displayName, now), subline: subline(now), source: "template" as const, generatedAt: now.toISOString(), footer: BRIEFING_FOOTER };
  if (!anyAccount) {
    const lines = emptyBriefingLines();
    return { ...base, lines, sections: [{ key: "position", title: "Where you stand", lines }] };
  }

  const [summary, figures, settings, budgetOverview, activeHolds, emiPlans, rules, goalOverview, debtOverview, holdingOverview, loanOverview, commitmentView, lastLogged, ladder, policies] = await Promise.all([
    getSummary(db, userId, "cycle", today),
    listAccountsWithFigures(db, userId, today),
    getSettings(db, userId),
    listBudgets(db, userId, today),
    listHolds(db, userId, today, "active"),
    listPlans(db, userId, today),
    listRules(db, userId, today),
    listGoals(db, userId, today, "active"),
    listDebts(db, userId, today, "open"),
    listHoldings(db, userId, today, "active"),
    listLoans(db, userId, "active"),
    getCommitments(db, userId, today),
    lastLoggedDate(db, userId),
    getLadder(db, userId, today),
    listPolicies(db, userId, today),
  ]);
  const soonest = loanOverview.loans
    .filter((l) => l.nextDueDate !== null && l.nextInstalment !== null && daysBetween(today, l.nextDueDate) <= 7)
    .sort((x, y) => (x.nextDueDate as string).localeCompare(y.nextDueDate as string))[0];
  const stale = holdingOverview.holdings.filter((h) => h.staleDays === null || h.staleDays > STALE_AFTER_DAYS);
  const staleAges = stale.map((h) => h.staleDays);
  const overdue = debtOverview.people
    .flatMap((p) => p.debts.filter((d) => d.overdue && d.dueDate).map((d) => ({ name: p.name, direction: d.direction, outstandingPaise: d.outstandingPaise, dueDate: d.dueDate as string })))
    .sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const attention = goalOverview.goals.filter((g) => g.needsAttention && g.targetDate).sort((x, y) => (x.targetDate as string).localeCompare(y.targetDate as string))[0];
  const soon = rules
    .filter((r) => r.status === "active" && r.nextDate !== null && daysBetween(today, r.nextDate) <= 7)
    .sort((a, b) => (a.nextDate as string).localeCompare(b.nextDate as string))[0];
  const upcoming = emiPlans.filter((p) => p.status === "active" && p.nextDate !== null && p.nextAmountPaise !== null).sort((a, b) => (a.nextDate as string).localeCompare(b.nextDate as string))[0];
  const cards = figures.flatMap((a) =>
    a.kind === "card"
      ? [{ name: a.name, nextDueDate: a.summary.nextDueDate, statementOutstandingPaise: a.summary.statementOutstandingPaise }]
      : [],
  );

  const sooner = addDays(today, 3);
  const renewal = policies.filter((p) => p.status === "active" && p.source === "personal" && p.daysToDue <= 7).sort((a, b) => a.daysToDue - b.daysToDue)[0];
  const lifestyle = ladder.rows.find((r) => r.key === "lifestyle");
  const essentials = ladder.rows.find((r) => r.key === "essentials");
  const independence = ladder.rows.find((r) => r.key === "fire");

  const all = buildBriefingLines(
    {
      today,
      periodKey: summary.period.key,
      cycleStartDay: settings.periodStartDay,
      safeToSpendPaise: summary.safeToSpendPaise,
      setAsidePaise: balanceOverview(figures).setAsidePaise,
      expensePaise: summary.expensePaise,
      previousExpensePaise: summary.previousExpensePaise,
      uncategorizedCount: summary.uncategorizedCount,
      draftCount: summary.draftCount,
      cards,
      debts: { overdue },
      logging: lastLogged ? { daysSince: daysBetween(lastLogged, today), lastDate: lastLogged } : undefined,
      shortfalls: commitmentView.shortfalls
        .filter((s) => s.commitment.date <= sooner)
        .map((s) => ({ title: s.commitment.title, amountPaise: s.commitment.amountPaise, accountName: s.commitment.accountName ?? "the account", shortByPaise: s.shortByPaise, date: s.commitment.date })),
      insurance: renewal ? { insurer: renewal.insurer, kind: renewal.kind, premiumPaise: renewal.premiumPaise, date: renewal.nextDueDate } : null,
      progress: {
        emergency: ladder.fundMarked && lifestyle && lifestyle.pct !== null ? { lifestylePct: lifestyle.pct, essentialsPct: essentials?.pct ?? null } : null,
        firePct: independence?.pct ?? null,
        focus: ladder.attention ? { title: ladder.attention.title, detail: ladder.attention.detail } : null,
      },
      commitments: { count: commitmentView.items.filter((i) => !i.counted).length, untilDate: commitmentView.until, freeToSpendPaise: commitmentView.freeToSpendPaise },
      loans: { next: soonest && soonest.nextInstalment ? { name: soonest.name, totalPaise: soonest.nextInstalment.totalPaise, date: soonest.nextDueDate as string, accountName: soonest.accountName } : null },
      holdings: { staleCount: stale.length, oldestDays: staleAges.includes(null) ? null : staleAges.length ? Math.max(...(staleAges as number[])) : null },
      goals: {
        setAsidePaise: goalOverview.setAsidePaise,
        count: goalOverview.goals.length,
        attention: attention ? { name: attention.name, remainingPaise: attention.remainingPaise, targetDate: attention.targetDate as string } : null,
      },
      recurring: soon ? { title: soon.title, type: soon.type, amountPaise: soon.amountPaise, date: soon.nextDate as string } : null,
      emi: {
        toComePaise: balanceOverview(figures).emiToComePaise,
        next: upcoming ? { title: upcoming.title, amountPaise: upcoming.nextAmountPaise as number, date: upcoming.nextDate as string } : null,
      },
      holds: activeHolds.map((h) => ({ title: h.title, amountPaise: h.amountPaise, expectedDate: h.expectedDate })),
      budgets: budgetOverview.items.map((b) => ({ categoryName: b.categoryName, pct: b.pct, remainingPaise: b.remainingPaise, status: b.status })),
    },
    shortDate,
    options.compact === false ? formatRupees : formatRupeesCompact,
  );
  const composed = composeBriefing(all);
  return { ...base, lines: composed.lines, sections: composed.sections };
}
