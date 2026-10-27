import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { idempotencyKeys } from "../db/schema";
import { nowIso } from "../utils/id";

const TTL_MS = 24 * 3600 * 1000;

/** Returns the transaction id a previous request with this key created, if it is still fresh. */
export async function findIdempotent(db: Db, userId: string, key: string): Promise<string | undefined> {
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), lt(idempotencyKeys.createdAt, cutoff)));
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
    .limit(1);
  return row?.transactionId;
}

export async function rememberIdempotent(db: Db, userId: string, key: string, transactionId: string): Promise<void> {
  await db
    .insert(idempotencyKeys)
    .values({ userId, key, transactionId, createdAt: nowIso() })
    .onConflictDoNothing();
}
