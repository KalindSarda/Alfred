import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { transactions } from "../db/schema";
import { addDays, type DateRange, type IstDate, type PeriodKey, previousCycleSameDays, resolvePeriod } from "../domain/dates";
import { FLOW_TYPES } from "../domain/txnTypes";
import { getSafeToSpend } from "./ledger";
import { getSettings } from "./settings";

export interface SummaryDto {
  period: { key: PeriodKey } & DateRange;
  safeToSpendPaise: number;
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  /** Expenses in the period of equal length immediately before this one, for the "vs before" comparison. */
  previousExpensePaise: number;
  /** Income/expense entries with no category. */
  uncategorizedCount: number;
  /** Entries waiting for confirmation. */
  draftCount: number;
}

/** Income and expense totals for a range. Transfers, drafts and deleted rows never count. */
export async function periodTotals(
  db: Db,
  userId: string,
  range: DateRange,
): Promise<{ incomePaise: number; expensePaise: number }> {
  const rows = await db
    .select({ type: transactions.type, total: sql<number>`COALESCE(SUM(${transactions.amountPaise}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.status, "confirmed"),
        isNull(transactions.deletedAt),
        inArray(transactions.type, [...FLOW_TYPES]),
        sql`${transactions.txnDate} >= ${range.from}`,
        sql`${transactions.txnDate} <= ${range.to}`,
      ),
    )
    .groupBy(transactions.type);
  const sum = (type: "income" | "expense") => Number(rows.find((r) => r.type === type)?.total ?? 0);
  return { incomePaise: sum("income"), expensePaise: sum("expense") };
}

/** The period of the same number of days that ends the day before `range` starts. */
export function previousRange(range: DateRange): DateRange {
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

export interface ReviewCounts {
  uncategorizedCount: number;
  draftCount: number;
}

/** Entries that need attention: income/expense without a category, and drafts waiting for confirmation. */
export async function reviewCounts(db: Db, userId: string): Promise<ReviewCounts> {
  const [row] = await db
    .select({
      uncategorized: sql<number>`COALESCE(SUM(CASE WHEN ${inArray(transactions.type, [...FLOW_TYPES])} AND ${transactions.categoryId} IS NULL THEN 1 ELSE 0 END), 0)`,
      drafts: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.status} = 'draft' THEN 1 ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)));
  return { uncategorizedCount: Number(row?.uncategorized ?? 0), draftCount: Number(row?.drafts ?? 0) };
}

export async function getSummary(db: Db, userId: string, key: PeriodKey, today: IstDate): Promise<SummaryDto> {
  const { periodStartDay } = await getSettings(db, userId);
  const range = resolvePeriod(key, today, periodStartDay);
  // For the user's own month, compare with the same stretch of the previous one; otherwise the period before.
  const comparison = key === "cycle" ? previousCycleSameDays(today, periodStartDay) : previousRange(range);
  const [totals, previous, safeToSpendPaise, review] = await Promise.all([
    periodTotals(db, userId, range),
    periodTotals(db, userId, comparison),
    getSafeToSpend(db, userId, today),
    reviewCounts(db, userId),
  ]);
  return {
    period: { key, ...range },
    safeToSpendPaise,
    ...totals,
    netPaise: totals.incomePaise - totals.expensePaise,
    previousExpensePaise: previous.expensePaise,
    ...review,
  };
}
