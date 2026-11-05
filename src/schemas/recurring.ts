import { z } from "zod";
import { IstDateString, Id } from "./transaction";

const Title = z.string().trim().min(1).max(80);
const Amount = z.number().int().positive().max(100_000_000_000_00);
/** Whole days ahead, 1 to 7. On the day itself the entry is simply there. */
const Remind = z.number().int().min(1).max(7);

export const CreateRecurring = z
  .object({
    title: Title,
    type: z.enum(["expense", "income", "investment"]),
    amountPaise: Amount,
    accountId: Id,
    categoryId: Id.nullable().optional(),
    frequency: z.enum(["weekly", "monthly", "yearly"]),
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12).nullable().optional(),
    /** Defaults to today. A start in the past adds the missed ones (the latest 36). */
    startDate: IstDateString.optional(),
    endDate: IstDateString.nullable().optional(),
    /** auto adds a confirmed entry; draft adds one for the person to confirm or correct. */
    mode: z.enum(["auto", "draft"]).default("auto"),
    remindDaysBefore: Remind.nullable().optional(),
    /** A SIP can add to a holding: the entries it makes belong to it. Investments only. */
    holdingId: Id.nullable().optional(),
  })
  .strict();
export type CreateRecurringData = z.output<typeof CreateRecurring>;

export const UpdateRecurring = z
  .object({
    title: Title,
    amountPaise: Amount,
    accountId: Id,
    categoryId: Id.nullable(),
    frequency: z.enum(["weekly", "monthly", "yearly"]),
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12).nullable(),
    startDate: IstDateString,
    endDate: IstDateString.nullable(),
    mode: z.enum(["auto", "draft"]),
    remindDaysBefore: Remind.nullable(),
    holdingId: Id.nullable(),
  })
  .partial()
  .strict();
export type UpdateRecurringData = z.output<typeof UpdateRecurring>;
