import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { holds } from "./schema";

export type HoldRow = typeof holds.$inferSelect;

/** What is currently blocked in each bank account (active holds only). */
export async function activeHoldTotals(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ accountId: holds.accountId, total: sql<number>`COALESCE(SUM(${holds.amountPaise}), 0)` })
    .from(holds)
    .where(and(eq(holds.userId, userId), eq(holds.status, "active")))
    .groupBy(holds.accountId);
  return new Map(rows.map((r) => [r.accountId, Number(r.total)]));
}

export async function getHold(db: Db, userId: string, id: string): Promise<HoldRow | undefined> {
  const [row] = await db.select().from(holds).where(and(eq(holds.userId, userId), eq(holds.id, id))).limit(1);
  return row;
}
