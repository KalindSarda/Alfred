import { z } from "zod";
import { IstDateString, Id } from "./transaction";

const Title = z.string().trim().min(1).max(80);
const Amount = z.number().int().positive().max(100_000_000_000_00);
/** Whole days ahead, 1 to 7. On the day itself the entry is simply there. */
const Remind = z.number().int().min(1).max(7);
/** One part of a contribution: nought is allowed (no pension share, say). */
const Part = z.number().int().min(0).max(100_000_000_000_00);

export const CreateRecurring = z
  .object({
    /** Left out on a contribution, it is "<investment> contribution". */
    title: Title.optional(),
    type: z.enum(["expense", "income", "investment", "contribution"]),
    /** Not sent on a contribution: it is your share plus the employer's. */
    amountPaise: Amount.optional(),
    /** Not sent on a contribution: it adds to an investment, with no bank entry. */
    accountId: Id.optional(),
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
    /** A contribution (EPF, NPS, PPF): the investment it adds to, the shares, and where a pension share goes. */
    ownPaise: Part.optional(),
    employerPaise: Part.optional(),
    pensionPaise: Part.optional(),
    pensionHoldingId: Id.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = (path: string, ok: boolean, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (v.type === "contribution") {
      need("holdingId", !!v.holdingId, "Choose the investment it adds to");
      need("accountId", v.accountId === undefined, "A contribution has no account");
      need("categoryId", v.categoryId === undefined || v.categoryId === null, "A contribution has no category");
      need("amountPaise", v.amountPaise === undefined, "Send your share and the employer's, not one amount");
      need("mode", v.mode === "auto", "A contribution is always added by itself");
      need("frequency", v.frequency === "monthly", "A contribution repeats every month");
    } else {
      need("title", v.title !== undefined, "Give it a name");
      need("amountPaise", v.amountPaise !== undefined, "Enter an amount");
      need("accountId", v.accountId !== undefined, "Choose an account");
      for (const k of ["ownPaise", "employerPaise", "pensionPaise", "pensionHoldingId"] as const) need(k, v[k] === undefined, "Only a contribution has shares");
    }
  });
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
    ownPaise: Part,
    employerPaise: Part,
    pensionPaise: Part,
    pensionHoldingId: Id.nullable(),
  })
  .partial()
  .strict();
export type UpdateRecurringData = z.output<typeof UpdateRecurring>;
