import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { holdings } from "./schema";

export type HoldingRow = typeof holdings.$inferSelect;

export async function getHoldingRow(db: Db, userId: string, id: string): Promise<HoldingRow | undefined> {
  const [row] = await db.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.id, id))).limit(1);
  return row;
}
