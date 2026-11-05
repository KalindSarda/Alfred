import { z } from "zod";
import { IstDateString } from "./transaction";

const Amount = z.number().int().positive().max(100_000_000_000_00);
const Name = z.string().trim().min(1).max(40);
const Note = z.string().trim().max(200);

export const CreateGoal = z.object({ name: Name, targetPaise: Amount, targetDate: IstDateString.nullable().optional() }).strict();
export type CreateGoalData = z.output<typeof CreateGoal>;

export const UpdateGoal = z.object({ name: Name, targetPaise: Amount, targetDate: IstDateString.nullable() }).partial().strict();
export type UpdateGoalData = z.output<typeof UpdateGoal>;

/** Positive puts money toward the goal; negative takes it back out. */
export const AddContribution = z
  .object({
    amountPaise: z.number().int().refine((n) => n !== 0, "Enter an amount").refine((n) => Math.abs(n) <= 100_000_000_000_00, "Too large"),
    date: IstDateString.optional(),
    note: Note.nullable().optional(),
  })
  .strict();
export type AddContributionData = z.output<typeof AddContribution>;

export const ListGoalsQuery = z.object({ status: z.enum(["active", "all"]).default("active") });
