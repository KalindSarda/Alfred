import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { telegramLinkCodes, telegramLinks } from "../db/schema";
import { hmacHex, randomString } from "../utils/crypto";
import { newId } from "../utils/id";

export const LINK_CODE_TTL_SECONDS = 10 * 60;
/** No 0/O/1/I/L: a code typed by hand should not be ambiguous. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

const iso = (ms: number) => new Date(ms).toISOString();
const hashOf = (hmacKey: string, code: string) => hmacHex(hmacKey, `tglink:${code}`);

/** People paste codes with spaces, dashes or lower case; all of that is forgiven. */
export const normalizeLinkCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A fresh one-time code to send to the bot as "/start CODE". Any earlier unused code stops working. */
export async function createLinkCode(
  db: Db,
  hmacKey: string,
  userId: string,
  nowMs: number,
): Promise<{ code: string; expiresAt: string }> {
  const code = randomString(CODE_LENGTH, ALPHABET);
  const expiresAt = iso(nowMs + LINK_CODE_TTL_SECONDS * 1000);
  await db.batch([
    db.update(telegramLinkCodes).set({ usedAt: iso(nowMs) }).where(and(eq(telegramLinkCodes.userId, userId), isNull(telegramLinkCodes.usedAt))),
    db.insert(telegramLinkCodes).values({ id: newId(), userId, codeHash: await hashOf(hmacKey, code), expiresAt }),
  ]);
  return { code, expiresAt };
}

/**
 * Links a chat to the account that generated the code. Returns the user, or null when the code is unknown,
 * expired or already used. A user has one linked chat: linking a new one replaces the old.
 */
export async function linkChat(db: Db, hmacKey: string, rawCode: string, chatId: string, nowMs: number): Promise<string | null> {
  const code = normalizeLinkCode(rawCode);
  if (code.length !== CODE_LENGTH) return null;
  const codeHash = await hashOf(hmacKey, code);

  const [row] = await db
    .select()
    .from(telegramLinkCodes)
    .where(and(eq(telegramLinkCodes.codeHash, codeHash), isNull(telegramLinkCodes.usedAt), gt(telegramLinkCodes.expiresAt, iso(nowMs))))
    .limit(1);
  if (!row) return null;

  // Only the request that flips used_at from NULL wins, so a code links once even under a race.
  const claimed = await db
    .update(telegramLinkCodes)
    .set({ usedAt: iso(nowMs) })
    .where(and(eq(telegramLinkCodes.id, row.id), isNull(telegramLinkCodes.usedAt)))
    .returning({ id: telegramLinkCodes.id });
  if (claimed.length !== 1) return null;

  await db.batch([
    db.delete(telegramLinks).where(eq(telegramLinks.userId, row.userId)),
    db.delete(telegramLinks).where(eq(telegramLinks.chatId, chatId)),
    db.insert(telegramLinks).values({ userId: row.userId, chatId, linkedAt: iso(nowMs) }),
  ]);
  return row.userId;
}

export async function unlinkChat(db: Db, userId: string): Promise<void> {
  await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
}

export async function userForChat(db: Db, chatId: string): Promise<string | null> {
  const [row] = await db.select().from(telegramLinks).where(eq(telegramLinks.chatId, chatId)).limit(1);
  return row?.userId ?? null;
}
