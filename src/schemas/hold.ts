import { z } from "zod";
import { Id, IstDateString } from "./transaction";

const Title = z.string().trim().min(1).max(80);
const Amount = z.number().int().positive().max(100_000_000_000_00);

export const CreateHold = z
  .object({
    accountId: Id,
    title: Title,
    amountPaise: Amount,
    appliedDate: IstDateString.optional(),
    expectedDate: IstDateString.nullable().optional(),
  })
  .strict();
export type CreateHoldData = z.output<typeof CreateHold>;

export const UpdateHold = z
  .object({
    accountId: Id,
    title: Title,
    amountPaise: Amount,
    appliedDate: IstDateString,
    expectedDate: IstDateString.nullable(),
  })
  .partial()
  .strict();
export type UpdateHoldData = z.output<typeof UpdateHold>;

/** Allotted for a lower amount than was blocked? Say so; the rest is released. Both fields are optional. */
export const AllotHold = z.object({ amountPaise: Amount.optional(), date: IstDateString.optional() }).strict();
export type AllotHoldData = z.output<typeof AllotHold>;

export const ListHoldsQuery = z.object({ status: z.enum(["active", "all"]).default("active") });
