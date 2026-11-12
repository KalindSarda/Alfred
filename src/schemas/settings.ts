import { z } from "zod";

export const UpdateSettings = z
  .object({
    nudgeLeadDays: z.number().int().min(1).max(7),
    nudgeTimeIst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm"),
    sessionDays: z.number().int().min(1).max(90),
    /** The day your month starts on, for example your salary day. Short months use their last day. */
    periodStartDay: z.number().int().min(1).max(31),
    /** null clears the name so Alfred falls back to one derived from the email. */
    displayName: z.string().trim().min(1).max(40).nullable(),
    /** The evening check-in when nothing was logged, and the Sunday balance check. */
    logNudge: z.boolean(),
    balanceCheck: z.boolean(),
    /** Pause the evening check-in through this day; null resumes it. */
    morningPush: z.boolean(),
    monthlyReview: z.boolean(),
    /** The emergency fund: months of essential spending to cover, a typed target that replaces it (null clears), and the months to close a gap over. */
    emergencyMonths: z.number().int().min(1).max(24),
    emergencyTargetPaise: z.number().int().positive().max(100_000_000_000_00).nullable(),
    emergencyHorizonMonths: z.number().int().min(1).max(60),
    emergencyBasis: z.enum(["essentials", "lifestyle"]),
    medicalTargetPaise: z.number().int().positive().max(100_000_000_000_00).nullable(),
    /** Loans at or above this yearly rate (in basis points) count as costly debt; and the ladder steps to skip. */
    costlyDebtBp: z.number().int().min(100).max(5000),
    ladderSkipped: z.array(z.enum(["starter", "debt", "protection", "emergency", "medical", "fire"])).max(6),
    logNudgeUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })
  .partial()
  .strict();

export interface SettingsDto {
  nudgeLeadDays: number;
  nudgeTimeIst: string;
  sessionDays: number;
  displayName: string | null;
  periodStartDay: number;
  logNudge: boolean;
  balanceCheck: boolean;
  logNudgeUntil: string | null;
  morningPush: boolean;
  monthlyReview: boolean;
  emergencyMonths: number;
  emergencyTargetPaise: number | null;
  emergencyHorizonMonths: number;
  emergencyBasis: "essentials" | "lifestyle";
  medicalTargetPaise: number | null;
  costlyDebtBp: number;
  ladderSkipped: string[];
}
