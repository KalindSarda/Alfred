import { z } from "zod";

export const UpdateSettings = z
  .object({
    nudgeLeadDays: z.number().int().min(1).max(7),
    nudgeTimeIst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm"),
    sessionDays: z.number().int().min(1).max(90),
    /** null clears the name so Alfred falls back to one derived from the email. */
    displayName: z.string().trim().min(1).max(40).nullable(),
  })
  .partial()
  .strict();

export interface SettingsDto {
  nudgeLeadDays: number;
  nudgeTimeIst: string;
  sessionDays: number;
  displayName: string | null;
}
