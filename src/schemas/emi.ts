import { z } from "zod";
import { Id, IstDateString } from "./transaction";

const Title = z.string().trim().min(1).max(80);
const Amount = z.number().int().positive().max(100_000_000_000_00);
const Months = z.number().int().min(1).max(60);
const StartMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

export const CreateEmiPlan = z
  .object({
    cardAccountId: Id,
    title: Title,
    categoryId: Id.nullable().optional(),
    /** The amount converted. With an instalment given, the plan's total becomes instalment times months (interest included). Not needed when every instalment is given. */
    totalPaise: Amount.optional(),
    months: Months,
    instalmentPaise: Amount.optional(),
    /** Every instalment's exact amount, in order, when the bank's schedule is uneven. Its length must equal months; the total is their sum. */
    instalmentsPaise: z.array(Amount).min(1).max(60).optional(),
    startMonth: StartMonth,
    /** An entry already logged for this purchase on the same card; it is removed so it is not counted twice. */
    replacesTransactionId: Id.optional(),
    /** The one-off processing fee with its GST, added as an expense on the card (not part of the instalments). */
    feePaise: Amount.optional(),
    /** The day the fee was billed; defaults to today and cannot be in the future. */
    feeDate: IstDateString.optional(),
  })
  .strict();
export type CreateEmiPlanData = z.output<typeof CreateEmiPlan>;

export const UpdateEmiPlan = z
  .object({
    title: Title,
    categoryId: Id.nullable(),
    totalPaise: Amount,
    months: Months,
    instalmentPaise: Amount,
    instalmentsPaise: z.array(Amount).min(1).max(60),
    startMonth: StartMonth,
  })
  .partial()
  .strict();
export type UpdateEmiPlanData = z.output<typeof UpdateEmiPlan>;

export const SetInstalment = z.object({ amountPaise: Amount }).strict();
export type SetInstalmentData = z.output<typeof SetInstalment>;
