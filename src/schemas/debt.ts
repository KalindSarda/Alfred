import { z } from "zod";
import { Id, IstDateString } from "./transaction";

const Amount = z.number().int().positive().max(100_000_000_000_00);
const Name = z.string().trim().min(1).max(40);
const Note = z.string().trim().max(200);

export const CreateDebt = z
  .object({
    /** The person. A name seen before is the same person. */
    name: Name,
    direction: z.enum(["lent", "borrowed"]),
    amountPaise: Amount,
    /** Defaults to today; not in the future. */
    date: IstDateString.optional(),
    dueDate: IstDateString.nullable().optional(),
    note: Note.nullable().optional(),
    /** The bank account the money moved through; leave out for cash or untracked. */
    accountId: Id.nullable().optional(),
  })
  .strict();
export type CreateDebtData = z.output<typeof CreateDebt>;

export const UpdateDebt = z
  .object({
    dueDate: IstDateString.nullable(),
    note: Note.nullable(),
    /** True stops Alfred following up about this one; false starts it again. */
    followUpStopped: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateDebtData = z.output<typeof UpdateDebt>;

export const AddPayment = z
  .object({
    amountPaise: Amount,
    date: IstDateString.optional(),
    accountId: Id.nullable().optional(),
    note: Note.nullable().optional(),
  })
  .strict();
export type AddPaymentData = z.output<typeof AddPayment>;

export const SettleDebt = z.object({ date: IstDateString.optional(), accountId: Id.nullable().optional() }).strict();
export type SettleDebtData = z.output<typeof SettleDebt>;

export const ListDebtsQuery = z.object({ status: z.enum(["open", "all"]).default("open") });

export const UpdateContact = z.object({ trusted: z.boolean() }).strict();
