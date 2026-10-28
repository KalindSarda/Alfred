import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { InvalidCodeError, UnauthenticatedError } from "../config/errors";
import type { Db } from "../db/client";
import { appSettings, loginCodes, sessions, telegramLinks, users } from "../db/schema";
import { hmacHex, randomDigits, randomToken, timingSafeEqual } from "../utils/crypto";
import { newId } from "../utils/id";
import { logger } from "../utils/logger";
import type { Notifiers } from "./notifiers";
import { enforceRateLimit } from "./rateLimit";
import { getSettings, nameFromEmail } from "./settings";
import { loginCodeMessages } from "../alfred/messages";

export const CODE_TTL_SECONDS = 5 * 60;
export const MAX_CODE_ATTEMPTS = 5;
export const DEFAULT_SESSION_DAYS = 30;
const SESSION_TOUCH_INTERVAL_SECONDS = 60 * 60;

export type Channel = "telegram" | "email";

export interface AuthDeps {
  db: Db;
  hmacKey: string;
  notifiers: Notifiers;
  /** Injectable clock, in epoch milliseconds. */
  now?: () => number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const clock = (deps: AuthDeps) => (deps.now ?? Date.now)();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findUserByEmail(db: Db, email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  return user;
}

export async function getLinkedChatId(db: Db, userId: string): Promise<string | undefined> {
  const [link] = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1);
  return link?.chatId;
}

/**
 * Sends a one-time code to the linked Telegram chat (default) or the registered email.
 * Always resolves the same way whether or not the email is registered; callers return a uniform 202.
 * Rate limits apply to every request, registered or not, so they cannot be used to probe accounts.
 */
export async function requestLoginCode(
  deps: AuthDeps,
  input: { email: string; channel?: Channel; ip: string },
): Promise<void> {
  const { db, hmacKey, notifiers } = deps;
  const nowMs = clock(deps);
  const nowSeconds = Math.floor(nowMs / 1000);
  const email = normalizeEmail(input.email);

  await enforceRateLimit(db, hmacKey, { bucket: "req-ip", subject: input.ip, limit: 20, windowSeconds: 3600 }, nowSeconds);
  await enforceRateLimit(db, hmacKey, { bucket: "req-email", subject: email, limit: 5, windowSeconds: 3600 }, nowSeconds);

  const user = await findUserByEmail(db, email);
  if (!user) return;

  const chatId = await getLinkedChatId(db, user.id);
  const channel: Channel = input.channel === "email" || !chatId ? "email" : "telegram";

  const code = randomDigits(6);
  const codeHash = await hmacHex(hmacKey, `login:${user.id}:${code}`);
  const createdAt = iso(nowMs);

  // A new code replaces any earlier unused one, so only the latest code is ever valid.
  await db.batch([
    db.update(loginCodes).set({ usedAt: createdAt }).where(and(eq(loginCodes.userId, user.id), isNull(loginCodes.usedAt))),
    db.insert(loginCodes).values({
      id: newId(),
      userId: user.id,
      codeHash,
      channel,
      expiresAt: iso(nowMs + CODE_TTL_SECONDS * 1000),
      createdAt,
    }),
  ]);

  const settings = await getSettings(db, user.id);
  const message = loginCodeMessages({
    name: settings.displayName ?? nameFromEmail(user.email),
    code,
    now: new Date(nowMs),
    ttlMinutes: CODE_TTL_SECONDS / 60,
  });
  try {
    if (channel === "telegram" && chatId) await notifiers.sendTelegram(chatId, message.telegram);
    else await notifiers.sendEmail(user.email, message.subject, message.text, message.html);
  } catch (error) {
    // Delivery failure is logged but not reported to the caller, to keep the response uniform.
    logger.error("login_code_delivery_failed", { channel, error: error instanceof Error ? error.message : "unknown" });
  }
}

async function sessionDaysFor(db: Db, userId: string): Promise<number> {
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  return settings?.sessionDays ?? DEFAULT_SESSION_DAYS;
}

export interface SessionGrant {
  token: string;
  expiresAt: string;
  maxAgeSeconds: number;
}

export async function createSession(deps: AuthDeps, userId: string): Promise<SessionGrant> {
  const nowMs = clock(deps);
  const days = await sessionDaysFor(deps.db, userId);
  const token = randomToken();
  const tokenHash = await hmacHex(deps.hmacKey, `session:${token}`);
  const expiresAt = iso(nowMs + days * 86_400_000);
  await deps.db.insert(sessions).values({
    id: newId(),
    userId,
    tokenHash,
    expiresAt,
    createdAt: iso(nowMs),
    lastSeenAt: iso(nowMs),
  });
  return { token, expiresAt, maxAgeSeconds: days * 86_400 };
}

/** Exchanges a valid code for a session. Every failure looks identical to the caller. */
export async function verifyLoginCode(
  deps: AuthDeps,
  input: { email: string; code: string; ip: string },
): Promise<{ userId: string; session: SessionGrant }> {
  const { db, hmacKey } = deps;
  const nowMs = clock(deps);
  const nowSeconds = Math.floor(nowMs / 1000);

  await enforceRateLimit(db, hmacKey, { bucket: "verify-ip", subject: input.ip, limit: 30, windowSeconds: 900 }, nowSeconds);

  const user = await findUserByEmail(db, input.email);
  if (!user) throw new InvalidCodeError();

  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.userId, user.id), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, iso(nowMs))))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) throw new InvalidCodeError();

  const expected = await hmacHex(hmacKey, `login:${user.id}:${input.code}`);
  if (!timingSafeEqual(expected, row.codeHash)) {
    await db.update(loginCodes).set({ attempts: sql`${loginCodes.attempts} + 1` }).where(eq(loginCodes.id, row.id));
    throw new InvalidCodeError();
  }

  // Single use: only the request that flips used_at from NULL wins, even under concurrent attempts.
  const claimed = await db
    .update(loginCodes)
    .set({ usedAt: iso(nowMs) })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.usedAt)))
    .returning({ id: loginCodes.id });
  if (claimed.length !== 1) throw new InvalidCodeError();

  return { userId: user.id, session: await createSession(deps, user.id) };
}

export interface AuthenticatedSession {
  userId: string;
  sessionId: string;
}

export async function authenticateSession(deps: AuthDeps, token: string | undefined): Promise<AuthenticatedSession> {
  if (!token) throw new UnauthenticatedError();
  const nowMs = clock(deps);
  const tokenHash = await hmacHex(deps.hmacKey, `session:${token}`);
  const [row] = await deps.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  if (!row || row.expiresAt <= iso(nowMs)) throw new UnauthenticatedError();

  // Refresh last-seen at most hourly to avoid a write on every request.
  if (nowMs - Date.parse(row.lastSeenAt) > SESSION_TOUCH_INTERVAL_SECONDS * 1000) {
    await deps.db.update(sessions).set({ lastSeenAt: iso(nowMs) }).where(eq(sessions.id, row.id));
  }
  return { userId: row.userId, sessionId: row.id };
}

export async function logout(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function logoutEverywhere(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export interface MeDto {
  id: string;
  email: string;
  /** What Alfred calls the user: the saved display name, or one derived from the email. */
  displayName: string;
  telegramLinked: boolean;
  settings: { nudgeLeadDays: number; nudgeTimeIst: string };
}

export async function getMe(db: Db, userId: string): Promise<MeDto> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new UnauthenticatedError();
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  return {
    id: user.id,
    email: user.email,
    displayName: settings?.displayName ?? nameFromEmail(user.email),
    telegramLinked: (await getLinkedChatId(db, userId)) !== undefined,
    settings: { nudgeLeadDays: settings?.nudgeLeadDays ?? 3, nudgeTimeIst: settings?.nudgeTimeIst ?? "10:00" },
  };
}
