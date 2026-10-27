import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { appSettings } from "../db/schema";
import type { SettingsDto } from "../schemas/settings";

export const DEFAULT_SETTINGS: SettingsDto = { nudgeLeadDays: 3, nudgeTimeIst: "10:00", sessionDays: 30, displayName: null };

export async function getSettings(db: Db, userId: string): Promise<SettingsDto> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  return row
    ? {
        nudgeLeadDays: row.nudgeLeadDays,
        nudgeTimeIst: row.nudgeTimeIst,
        sessionDays: row.sessionDays,
        displayName: row.displayName,
      }
    : { ...DEFAULT_SETTINGS };
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
