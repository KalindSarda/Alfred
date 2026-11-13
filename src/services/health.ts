import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { NETTED_INCOME_CATEGORIES } from "../db/defaultCategories";
import { categories, transactions } from "../db/schema";
import { addDays, cycleRange, type DateRange, type IstDate } from "../domain/dates";
import { type Health, healthOf, type PeriodFacts } from "../domain/health";
import { listAccountsWithFigures } from "./ledger";
import { getNetWorthAt } from "./networth";
import { getRunway } from "./runway";
import { getSettings } from "./settings";

export type HealthPeriod = "last" | "current";

export interface HealthView extends Health {
  period: { kind: HealthPeriod; from: IstDate; to: IstDate };
  /** Nothing came in and nothing was spent: there is nothing to say about the period. */
  empty: boolean;
  /** What the cards owe against their limits, now. */
  utilizationPct: number | null;
  runway: { months: number | null; burnPaise: number | null; solid: boolean; basedOnDays: number };
  /** Net worth at the end of the period and how much it moved over it; null when nothing is on the books yet. */
  netWorth: { endPaise: number; changePaise: number } | null;
}

/** The person's last full month (their own, from their month-start day), or the current one so far. */
export function healthRange(today: IstDate, startDay: number, which: HealthPeriod): DateRange {
  const current = cycleRange(today, startDay);
  return which === "last" ? cycleRange(addDays(current.from, -1), startDay) : { from: current.from, to: today };
}

/**
 * What the period looked like. Income leaves out refunds, money other people paid back and balance-check bookings (they are
 * not earnings); the refunds and repayments are taken off spending instead, in the month of the spending they pay back (the day
 * set on the entry, else the day it arrived), wants first and then needs. Needs are
 * the essential categories plus card EMIs and loan interest, each counted once; wants are every other expense, including
 * "Unlogged spending". Investing and loan principal are not spending: they are part of what was saved.
 */
export async function periodFacts(db: Db, userId: string, range: DateRange): Promise<PeriodFacts> {
  const rows = await db
    .select({ type: transactions.type, source: transactions.source, amountPaise: transactions.amountPaise, loanOn: transactions.loanOn, txnDate: transactions.txnDate, countsForDate: transactions.countsForDate, category: categories.name, essential: categories.isEssential })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.status, "confirmed"),
        // Entries dated in the range, and refunds or repayments that count for a day in it.
        or(and(gte(transactions.txnDate, range.from), lte(transactions.txnDate, range.to)), and(isNotNull(transactions.countsForDate), gte(transactions.countsForDate, range.from), lte(transactions.countsForDate, range.to))),
      ),
    );

  const f: PeriodFacts = { incomePaise: 0, needsPaise: 0, wantsPaise: 0, investedPaise: 0, principalRepaidPaise: 0, emiPaise: 0, reimbursedPaise: 0 };
  for (const r of rows) {
    const netted = r.type === "income" && r.category !== null && NETTED_INCOME_CATEGORIES.includes(r.category);
    // Only a refund or a repayment can count on another day than it arrived.
    const day = netted ? (r.countsForDate ?? r.txnDate) : r.txnDate;
    if (day < range.from || day > range.to) continue;
    const instalment = r.loanOn !== null && r.source === "loan";
    if (r.type === "income") {
      if (r.source === "check") continue;
      if (netted) f.reimbursedPaise += r.amountPaise;
      else f.incomePaise += r.amountPaise;
    } else if (r.type === "expense") {
      const emi = r.source === "emi";
      if (r.essential || emi || instalment) f.needsPaise += r.amountPaise;
      else f.wantsPaise += r.amountPaise;
      if (emi || instalment) f.emiPaise += r.amountPaise;
    } else if (r.type === "investment") {
      f.investedPaise += r.amountPaise;
    } else if (r.type === "loan_payment") {
      f.principalRepaidPaise += r.amountPaise;
      if (instalment) f.emiPaise += r.amountPaise;
    }
  }
  // What came back is taken off what was spent: first off the wants, then off the needs, never below zero.
  const fromWants = Math.min(f.reimbursedPaise, f.wantsPaise);
  f.wantsPaise -= fromWants;
  f.needsPaise -= Math.min(f.reimbursedPaise - fromWants, f.needsPaise);
  return f;
}

export async function getHealth(db: Db, userId: string, today: IstDate, which: HealthPeriod): Promise<HealthView> {
  const { periodStartDay } = await getSettings(db, userId);
  const range = healthRange(today, periodStartDay, which);
  const [facts, figures, runway, nw] = await Promise.all([
    periodFacts(db, userId, range),
    listAccountsWithFigures(db, userId, today),
    getRunway(db, userId, today),
    getNetWorthAt(db, userId, [addDays(range.from, -1), range.to]),
  ]);
  const health = healthOf(facts);

  let owed = 0;
  let limit = 0;
  for (const a of figures) {
    if (a.kind !== "card" || a.archivedAt) continue;
    owed += Math.max(0, a.summary.owedPaise);
    limit += a.creditLimitPaise ?? 0;
  }
  const start = nw.values.get(addDays(range.from, -1));
  const end = nw.values.get(range.to);
  return {
    ...health,
    period: { kind: which, ...range },
    empty: facts.incomePaise === 0 && health.spentPaise === 0 && facts.reimbursedPaise === 0,
    utilizationPct: limit > 0 ? Math.round((owed / limit) * 1000) / 10 : null,
    runway: { months: runway.months, burnPaise: runway.burnPaise, solid: runway.solid, basedOnDays: runway.basedOnDays },
    netWorth: nw.firstDate !== null && start !== undefined && end !== undefined ? { endPaise: end, changePaise: end - start } : null,
  };
}
