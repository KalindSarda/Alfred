import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { accounts, emiPlans } from "./schema";
import { type IstDate } from "../domain/dates";
import { emiToCome } from "../domain/emi";

export type EmiPlanRow = typeof emiPlans.$inferSelect;

export async function getPlanRow(db: Db, userId: string, id: string): Promise<EmiPlanRow | undefined> {
  const [row] = await db.select().from(emiPlans).where(and(eq(emiPlans.userId, userId), eq(emiPlans.id, id))).limit(1);
  return row;
}

export const toShape = (row: EmiPlanRow) => ({
  totalPaise: row.totalPaise,
  months: row.months,
  instalmentPaise: row.instalmentPaise,
  startMonth: row.startMonth,
  cancelled: row.cancelledAt !== null,
});

/** What is still to be billed on each card, from its running plans: part of the debt, not yet on a statement. */
export async function emiToComeByCard(db: Db, userId: string, today: IstDate): Promise<Map<string, number>> {
  const rows = await db
    .select({ plan: emiPlans, statementDay: accounts.statementDay, dueDay: accounts.dueDay })
    .from(emiPlans)
    .innerJoin(accounts, eq(accounts.id, emiPlans.cardAccountId))
    .where(and(eq(emiPlans.userId, userId), isNull(emiPlans.cancelledAt)));
  const totals = new Map<string, number>();
  for (const { plan, statementDay, dueDay } of rows) {
    const remaining = emiToCome(toShape(plan), { statementDay: statementDay ?? 1, dueDay: dueDay ?? 1 }, today);
    if (remaining > 0) totals.set(plan.cardAccountId, (totals.get(plan.cardAccountId) ?? 0) + remaining);
  }
  return totals;
}
