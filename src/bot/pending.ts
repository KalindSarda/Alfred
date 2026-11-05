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
  /** "hold": the amount is being blocked for an application (/ipo). "lent" and "borrowed": a loan (/lent, /borrowed). Never spent. */
  kind?: "hold" | "lent" | "borrowed";
  /** A loan that went through cash or is not tracked in an account. */
  cash?: boolean;
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
    const parsed = JSON.parse(row.payload) as PendingEntry & { emiFix?: unknown };
    return parsed.emiFix ? null : parsed;
  } catch {
    return null;
  }
}

/** Waiting for the amount the statement shows for one EMI entry (the person tapped "Different amount"). */
export async function createEmiFix(db: Db, userId: string, chatId: string, txnId: string, nowMs: number): Promise<void> {
  await db.insert(botPending).values({
    id: randomString(10, "abcdefghijkmnpqrstuvwxyz23456789"),
    userId,
    chatId,
    payload: JSON.stringify({ emiFix: { txnId } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
}

/** The latest fresh amount-wait for this person and chat, removed so it is used once; null when there is none. */
export async function takeEmiFix(db: Db, userId: string, chatId: string, nowMs: number): Promise<string | null> {
  const rows = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))));
  let found: { id: string; txnId: string; createdAt: string } | null = null;
  for (const row of rows) {
    try {
      const value = (JSON.parse(row.payload) as { emiFix?: { txnId?: unknown } }).emiFix;
      if (typeof value?.txnId === "string" && (!found || row.createdAt > found.createdAt)) found = { id: row.id, txnId: value.txnId, createdAt: row.createdAt };
    } catch {
      // Not ours; ignore.
    }
  }
  if (!found) return null;
  await db.delete(botPending).where(eq(botPending.id, found.id));
  return found.txnId;
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
