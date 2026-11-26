import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { memoDb } from "./readCache";
import { goalContributions, goals } from "./schema";

export type GoalRow = typeof goals.$inferSelect;

export async function getGoalRow(db: Db, userId: string, id: string): Promise<GoalRow | undefined> {
  const [row] = await db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.id, id))).limit(1);
  return row;
}

/** What has been saved toward each goal. */
export async function savedByGoal(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ goalId: goalContributions.goalId, total: sql<number>`COALESCE(SUM(${goalContributions.amountPaise}), 0)` })
    .from(goalContributions)
    .where(eq(goalContributions.userId, userId))
    .groupBy(goalContributions.goalId);
  return new Map(rows.map((r) => [r.goalId, Number(r.total)]));
}

/** Money set aside for active goals: taken off safe-to-spend. Achieved and archived goals release theirs. */
export const goalsSetAside = memoDb("goalsSetAside", goalsSetAsideUncached);
async function goalsSetAsideUncached(db: Db, userId: string): Promise<number> {
  const [row] = await goalsSetAsideQuery(db, userId);
  return setAsideFromRow(row);
}

/** The query behind `goalsSetAside`, for callers that send several reads in one `db.batch()`. */
export function goalsSetAsideQuery(db: Db, userId: string) {
  return db
    .select({ total: sql<number>`COALESCE(SUM(${goalContributions.amountPaise}), 0)` })
    .from(goalContributions)
    .innerJoin(goals, eq(goals.id, goalContributions.goalId))
    .where(and(eq(goalContributions.userId, userId), eq(goals.status, "active")));
}

export const setAsideFromRow = (row: { total: number } | undefined): number => Math.max(0, Number(row?.total ?? 0));
