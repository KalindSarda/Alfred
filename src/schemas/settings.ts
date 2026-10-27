import { z } from "zod";

export const UpdateSettings = z
  .object({
    nudgeLeadDays: z.number().int().min(1).max(7),
    nudgeTimeIst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm"),
    sessionDays: z.number().int().min(1).max(90),
  })
  .partial()
  .strict();

export interface SettingsDto {
  nudgeLeadDays: number;
  nudgeTimeIst: string;
  sessionDays: number;
}
