import { z } from "zod";
import { Id, IstDateString } from "./transaction";

const Name = z.string().trim().min(1).max(40);
const Note = z.string().trim().max(200);
const Positive = z.number().int().positive().max(100_000_000_000_00);
const Money = z.number().int().min(0).max(100_000_000_000_00);

/** The key of one of the person's investment kinds (see /api/holding-kinds). */
export const HoldingKind = z.string().trim().min(1).max(40);

/** A quantity in 1/10,000 of a unit (15.2 g is 152000). */
const UnitsE4 = z.number().int().positive().max(1_000_000_000_000);
const Rate = z.number().int().positive().max(100_000_000_000_00);

export const CreateHolding = z
  .object({
    name: Name,
    kind: HoldingKind,
    /** Count it by quantity held times a rate (gold, funds, stocks) instead of a typed value. */
    tracking: z.enum(["value", "units"]).optional(),
    /** The quantity held before tracking (units only). */
    unitsE4: UnitsE4.optional(),
    /** The rate now, for the holding's rate quantity (units only). */
    ratePaise: Rate.optional(),
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

export const SetHoldingRate = z.object({ ratePaise: Rate, date: IstDateString.optional() }).strict();
export type SetHoldingRateData = z.output<typeof SetHoldingRate>;

/** A purchase made before tracking: the quantity, what it cost, and the day. No bank is touched. */
export const AddLot = z.object({ unitsE4: UnitsE4, costPaise: Money, date: IstDateString, note: Note.nullable().optional() }).strict();
export type AddLotData = z.output<typeof AddLot>;

/** Switch a holding with a typed value to quantity times rate. */
export const ConvertHolding = z.object({ unitsE4: UnitsE4, ratePaise: Rate, date: IstDateString.optional() }).strict();
export type ConvertHoldingData = z.output<typeof ConvertHolding>;

export const BuyHolding = z.object({ amountPaise: Positive, unitsE4: UnitsE4.optional(), accountId: Id, date: IstDateString.optional(), note: Note.nullable().optional() }).strict();
export type BuyHoldingData = z.output<typeof BuyHolding>;

export const SellHolding = z
  .object({ amountPaise: Positive, unitsE4: UnitsE4.optional(), accountId: Id, date: IstDateString.optional(), note: Note.nullable().optional(), closeOut: z.boolean().optional() })
  .strict();
export type SellHoldingData = z.output<typeof SellHolding>;

export const ListHoldingsQuery = z.object({ status: z.enum(["active", "all"]).default("active") });

export const SetEntryUnits = z.object({ unitsE4: UnitsE4 }).strict();
