import { sql } from "drizzle-orm";
import { RateLimitedError } from "../config/errors";
import type { Db } from "../db/client";
import { rateLimits } from "../db/schema";
import { hmacHex } from "../utils/crypto";

export interface RateRule {
  /** Namespace such as "req-email". */
  bucket: string;
  /** The thing being limited (email, IP). Hashed before storage. */
  subject: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter in D1. Counts the attempt first (a single atomic upsert), then rejects when the
 * window's count exceeds the limit. Throws RateLimitedError with the seconds until the window resets.
 */
export async function enforceRateLimit(db: Db, hmacKey: string, rule: RateRule, nowSeconds: number): Promise<void> {
  const key = `${rule.bucket}:${await hmacHex(hmacKey, rule.subject)}`;
  const expired = sql`${rateLimits.windowStart} <= ${nowSeconds - rule.windowSeconds}`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart: nowSeconds })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${nowSeconds} ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });

  if (row && row.count > rule.limit) {
    throw new RateLimitedError(Math.max(1, row.windowStart + rule.windowSeconds - nowSeconds));
  }
}

/** Removes counters whose window ended long ago; called from the daily cron in a later slice. */
export async function purgeExpiredRateLimits(db: Db, nowSeconds: number, olderThanSeconds = 86_400): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} <= ${nowSeconds - olderThanSeconds}`);
}
