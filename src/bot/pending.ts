import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { botPending } from "../db/schema";
import { randomString } from "../utils/crypto";
import type { ParsedEntry } from "./parser";

export const PENDING_TTL_MS = 15 * 60 * 1000;

export interface PendingEntry {
  /** "text" entries (typed without a command) wait for a confirming tap; commands record as soon as they are complete. */
  mode: "command" | "text";
  entry: ParsedEntry;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function createPending(db: Db, userId: string, chatId: string, payload: PendingEntry, nowMs: number): Promise<string> {
  const id = randomString(10, "abcdefghijkmnpqrstuvwxyz23456789");
  await db.insert(botPending).values({
    id,
    userId,
    chatId,
    payload: JSON.stringify(payload),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
  return id;
}

/** Only the owner, in the same chat, and only while it is still fresh. */
export async function getPending(db: Db, userId: string, chatId: string, id: string, nowMs: number): Promise<PendingEntry | null> {
  const [row] = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.id, id), eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))))
    .limit(1);
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as PendingEntry;
  } catch {
    return null;
  }
}

export async function updatePending(db: Db, id: string, payload: PendingEntry): Promise<void> {
  await db.update(botPending).set({ payload: JSON.stringify(payload) }).where(eq(botPending.id, id));
}

export async function deletePending(db: Db, id: string): Promise<void> {
  await db.delete(botPending).where(eq(botPending.id, id));
}

export async function purgeExpiredPending(db: Db, nowMs: number): Promise<void> {
  await db.delete(botPending).where(lt(botPending.expiresAt, iso(nowMs)));
}
