import { z } from "zod";
import { Id, IstDateString } from "./transaction";

const Name = z.string().trim().min(1).max(40);
const Note = z.string().trim().max(200);
const Positive = z.number().int().positive().max(100_000_000_000_00);
const Money = z.number().int().min(0).max(100_000_000_000_00);

export const HOLDING_KINDS = ["stock", "gold", "crypto", "other"] as const;
export const HoldingKind = z.enum(HOLDING_KINDS);

export const CreateHolding = z
  .object({
    name: Name,
    kind: HoldingKind,
    /** What was put in before Alfred tracked it, with no bank entry. */
    investedPaise: Money.optional(),
    /** What it is worth now, as of `valueDate`. */
    valuePaise: Money.optional(),
    valueDate: IstDateString.optional(),
  })
  .strict();
export type CreateHoldingData = z.output<typeof CreateHolding>;

export const UpdateHolding = z.object({ name: Name, kind: HoldingKind }).partial().strict();
export type UpdateHoldingData = z.output<typeof UpdateHolding>;

export const SetHoldingValue = z.object({ valuePaise: Money, date: IstDateString.optional() }).strict();
export type SetHoldingValueData = z.output<typeof SetHoldingValue>;

export const BuyHolding = z.object({ amountPaise: Positive, accountId: Id, date: IstDateString.optional(), note: Note.nullable().optional() }).strict();
export type BuyHoldingData = z.output<typeof BuyHolding>;

export const SellHolding = z
  .object({ amountPaise: Positive, accountId: Id, date: IstDateString.optional(), note: Note.nullable().optional(), closeOut: z.boolean().optional() })
  .strict();
export type SellHoldingData = z.output<typeof SellHolding>;

export const ListHoldingsQuery = z.object({ status: z.enum(["active", "all"]).default("active") });
