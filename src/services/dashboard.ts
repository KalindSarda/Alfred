import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { transactions } from "../db/schema";
import { type DateRange, type IstDate, type PeriodKey, resolvePeriod } from "../domain/dates";
import { getSafeToSpend } from "./ledger";

export interface SummaryDto {
  period: { key: PeriodKey } & DateRange;
  safeToSpendPaise: number;
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  reviewCount: number;
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
        ne(transactions.type, "transfer"),
        sql`${transactions.txnDate} >= ${range.from}`,
        sql`${transactions.txnDate} <= ${range.to}`,
      ),
    )
    .groupBy(transactions.type);
  const sum = (type: "income" | "expense") => Number(rows.find((r) => r.type === type)?.total ?? 0);
  return { incomePaise: sum("income"), expensePaise: sum("expense") };
}

/** Drafts plus confirmed income/expense entries that still have no category. */
export async function reviewCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        or(eq(transactions.status, "draft"), and(ne(transactions.type, "transfer"), isNull(transactions.categoryId))),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function getSummary(db: Db, userId: string, key: PeriodKey, today: IstDate): Promise<SummaryDto> {
  const range = resolvePeriod(key, today);
  const [totals, safeToSpendPaise, review] = await Promise.all([
    periodTotals(db, userId, range),
    getSafeToSpend(db, userId, today),
    reviewCount(db, userId),
  ]);
  return {
    period: { key, ...range },
    safeToSpendPaise,
    ...totals,
    netPaise: totals.incomePaise - totals.expensePaise,
    reviewCount: review,
  };
}
