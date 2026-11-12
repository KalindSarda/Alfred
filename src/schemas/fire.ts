import { z } from "zod";

const Money = z.number().int().min(0).max(100_000_000_000_00);

/** Every field optional; a null amount or age means "use my recent average" or "not set". */
export const UpdateFirePlan = z
  .object({
    ageNow: z.number().int().min(18).max(90).nullable(),
    targetAge: z.number().int().min(19).max(100).nullable(),
    monthlySpendPaise: Money.positive().nullable(),
    withdrawalRateBp: z.number().int().min(100).max(1000),
    inflationBp: z.number().int().min(0).max(2000),
    returnBp: z.number().int().min(0).max(3000),
    monthlySavingPaise: Money.nullable(),
    stepupBp: z.number().int().min(0).max(3000),
  })
  .partial()
  .strict();
export type UpdateFirePlanData = z.output<typeof UpdateFirePlan>;
