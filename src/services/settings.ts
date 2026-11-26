import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cachedRead } from "../db/readCache";
import { appSettings } from "../db/schema";
import type { SettingsDto } from "../schemas/settings";

export const DEFAULT_SETTINGS: SettingsDto = { nudgeLeadDays: 3, nudgeTimeIst: "10:00", sessionDays: 30, displayName: null, periodStartDay: 1, logNudge: true, balanceCheck: true, logNudgeUntil: null, morningPush: false, monthlyReview: true, priceRefresh: true, emergencyMonths: 6, emergencyTargetPaise: null, emergencyHorizonMonths: 12, medicalTargetPaise: null, costlyDebtBp: 1200 };

export function getSettings(db: Db, userId: string): Promise<SettingsDto> {
  return cachedRead(db, `settings:${userId}`, () => loadSettings(db, userId));
}

type SettingsRow = typeof appSettings.$inferSelect;

function fromRow(row: SettingsRow): SettingsDto {
  return {
    nudgeLeadDays: row.nudgeLeadDays,
    nudgeTimeIst: row.nudgeTimeIst,
    sessionDays: row.sessionDays,
    displayName: row.displayName,
    periodStartDay: row.periodStartDay,
    logNudge: row.logNudge,
    balanceCheck: row.balanceCheck,
    logNudgeUntil: row.logNudgeUntil,
    morningPush: row.morningPush,
    monthlyReview: row.monthlyReview,
    priceRefresh: row.priceRefresh,
    emergencyMonths: row.emergencyMonths,
    emergencyTargetPaise: row.emergencyTargetPaise,
    emergencyHorizonMonths: row.emergencyHorizonMonths,
    medicalTargetPaise: row.medicalTargetPaise,
    costlyDebtBp: row.costlyDebtBp,
  };
}

async function loadSettings(db: Db, userId: string): Promise<SettingsDto> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  return row ? fromRow(row) : { ...DEFAULT_SETTINGS };
}

/**
 * Many people's settings in one query (a few, for a very long list), for the scheduled jobs that must decide who is due
 * before spending queries on anyone. Someone with no row gets the defaults, as `getSettings` gives.
 */
export async function getSettingsMany(db: Db, userIds: readonly string[]): Promise<Map<string, SettingsDto>> {
  const out = new Map<string, SettingsDto>(userIds.map((id) => [id, { ...DEFAULT_SETTINGS }]));
  // D1 allows 100 bound variables a statement.
  for (let i = 0; i < userIds.length; i += 90) {
    const rows = await db.select().from(appSettings).where(inArray(appSettings.userId, userIds.slice(i, i + 90)));
    for (const row of rows) out.set(row.userId, fromRow(row));
  }
  return out;
}

export async function updateSettings(db: Db, userId: string, patch: Partial<SettingsDto>): Promise<SettingsDto> {
  const merged = { ...(await getSettings(db, userId)), ...patch };
  await db
    .insert(appSettings)
    .values({ userId, ...merged })
    .onConflictDoUpdate({ target: appSettings.userId, set: merged });
  return merged;
}

/** "kalind.s@example.com" -> "Kalind": first word of the email's local part, capitalised. */
export function nameFromEmail(email: string): string {
  const word = (email.split("@")[0] ?? "").split(/[^a-zA-Z]+/).find((w) => w.length > 0) ?? "";
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "there";
}
