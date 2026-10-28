import { lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { botPending, idempotencyKeys, loginCodes, rateLimits, sessions, telegramLinkCodes, telegramUpdates } from "../db/schema";

const DAY_MS = 86_400_000;

/**
 * Housekeeping, run with the daily job: removes rows that are expired and can never be used again, so the free
 * database does not slowly fill with them. Nothing here touches money records.
 */
export async function runMaintenance(db: Db, nowMs: number): Promise<void> {
  const iso = (ms: number) => new Date(ms).toISOString();
  await db.batch([
    db.delete(sessions).where(lt(sessions.expiresAt, iso(nowMs))),
    db.delete(loginCodes).where(lt(loginCodes.expiresAt, iso(nowMs - DAY_MS))),
    db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, iso(nowMs - DAY_MS))),
    db.delete(botPending).where(lt(botPending.expiresAt, iso(nowMs))),
    db.delete(telegramUpdates).where(lt(telegramUpdates.receivedAt, iso(nowMs - 7 * DAY_MS))),
    db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, iso(nowMs - DAY_MS))),
    db.delete(rateLimits).where(lt(rateLimits.windowStart, Math.floor((nowMs - DAY_MS) / 1000))),
  ]);
}
