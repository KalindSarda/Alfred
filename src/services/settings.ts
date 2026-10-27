import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { appSettings } from "../db/schema";
import type { SettingsDto } from "../schemas/settings";

export const DEFAULT_SETTINGS: SettingsDto = { nudgeLeadDays: 3, nudgeTimeIst: "10:00", sessionDays: 30 };

export async function getSettings(db: Db, userId: string): Promise<SettingsDto> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
  return row
    ? { nudgeLeadDays: row.nudgeLeadDays, nudgeTimeIst: row.nudgeTimeIst, sessionDays: row.sessionDays }
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
