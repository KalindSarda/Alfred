import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { cachedRead } from "./readCache";
import { accounts, emiPlans } from "./schema";
import { type IstDate } from "../domain/dates";
import { emiToCome } from "../domain/emi";

export type EmiPlanRow = typeof emiPlans.$inferSelect;

export async function getPlanRow(db: Db, userId: string, id: string): Promise<EmiPlanRow | undefined> {
  const [row] = await db.select().from(emiPlans).where(and(eq(emiPlans.userId, userId), eq(emiPlans.id, id))).limit(1);
  return row;
}

/** The typed instalment amounts, or null for an even split (also when the stored list is unreadable). */
export function parseAmounts(json: string | null): number[] | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.every((v) => Number.isSafeInteger(v) && v > 0) ? (value as number[]) : null;
  } catch {
    return null;
  }
}

export const toShape = (row: EmiPlanRow) => ({
  totalPaise: row.totalPaise,
  months: row.months,
  instalmentPaise: row.instalmentPaise,
  startMonth: row.startMonth,
  amountsPaise: parseAmounts(row.amountsJson),
  cancelled: row.cancelledAt !== null,
});

/** What is still to be billed on each card, from its running plans: part of the debt, not yet on a statement. */
export function emiToComeByCard(db: Db, userId: string, today: IstDate): Promise<Map<string, number>> {
  return cachedRead(db, `emiToCome:${userId}:${today}`, () => loadEmiToComeByCard(db, userId, today));
}

/** The query behind `emiToComeByCard`, for callers that send several reads in one `db.batch()`. */
export function emiRowsQuery(db: Db, userId: string) {
  return db
    .select({ plan: emiPlans, statementDay: accounts.statementDay, dueDay: accounts.dueDay })
    .from(emiPlans)
    .innerJoin(accounts, eq(accounts.id, emiPlans.cardAccountId))
    .where(and(eq(emiPlans.userId, userId), isNull(emiPlans.cancelledAt)));
}

async function loadEmiToComeByCard(db: Db, userId: string, today: IstDate): Promise<Map<string, number>> {
  return emiToComeFromRows(await emiRowsQuery(db, userId), today);
}

export function emiToComeFromRows(rows: { plan: EmiPlanRow; statementDay: number | null; dueDay: number | null }[], today: IstDate): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { plan, statementDay, dueDay } of rows) {
    const remaining = emiToCome(toShape(plan), { statementDay: statementDay ?? 1, dueDay: dueDay ?? 1 }, today);
    if (remaining > 0) totals.set(plan.cardAccountId, (totals.get(plan.cardAccountId) ?? 0) + remaining);
  }
  return totals;
}
