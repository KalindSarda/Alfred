import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { debtPayments, debts } from "./schema";

export type DebtRow = typeof debts.$inferSelect;

export async function getDebtRow(db: Db, userId: string, id: string): Promise<DebtRow | undefined> {
  const [row] = await db.select().from(debts).where(and(eq(debts.userId, userId), eq(debts.id, id))).limit(1);
  return row;
}

/** What has been paid back against each debt. */
export async function paidByDebt(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ debtId: debtPayments.debtId, total: sql<number>`COALESCE(SUM(${debtPayments.amountPaise}), 0)` })
    .from(debtPayments)
    .where(eq(debtPayments.userId, userId))
    .groupBy(debtPayments.debtId);
  return new Map(rows.map((r) => [r.debtId, Number(r.total)]));
}

export interface DebtTotals {
  /** Still owed to you by people you lent to. */
  owedToYouPaise: number;
  /** Still owed by you to people you borrowed from. */
  youOwePaise: number;
}

/** What is outstanding in each direction, for net worth. Settled and written-off debts are not counted. */
export async function debtTotals(db: Db, userId: string): Promise<DebtTotals> {
  const [open, paid] = await Promise.all([
    db.select({ id: debts.id, direction: debts.direction, amountPaise: debts.amountPaise }).from(debts).where(and(eq(debts.userId, userId), eq(debts.status, "open"))),
    paidByDebt(db, userId),
  ]);
  const totals: DebtTotals = { owedToYouPaise: 0, youOwePaise: 0 };
  for (const d of open) {
    const left = Math.max(0, d.amountPaise - (paid.get(d.id) ?? 0));
    if (d.direction === "lent") totals.owedToYouPaise += left;
    else totals.youOwePaise += left;
  }
  return totals;
}
