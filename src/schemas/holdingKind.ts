import { z } from "zod";

const Name = z.string().trim().min(1).max(40);
const Unit = z.string().trim().min(1).max(12);
const RatePer = z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]);
export const BrokerUse = z.enum(["required", "optional", "never"]);

export const CreateHoldingKind = z.object({ name: Name, unit: Unit.nullable().optional(), ratePer: RatePer.optional(), brokerUse: BrokerUse.optional() }).strict();
export type CreateHoldingKindData = z.output<typeof CreateHoldingKind>;

export const UpdateHoldingKind = z
  .object({
    name: Name.optional(),
    unit: Unit.nullable().optional(),
    ratePer: RatePer.optional(),
    archived: z.boolean().optional(),
    brokerUse: BrokerUse.optional(),
    /** A price feed for holdings of this kind outside a broker: IBJA gold or silver, exactly as published. */
    feed: z.enum(["gold", "silver"]).nullable().optional(),
  })
  .strict();
export type UpdateHoldingKindData = z.output<typeof UpdateHoldingKind>;

export const MergeHoldingKind = z.object({ intoId: z.string().min(1).max(64) }).strict();

export interface HoldingKindDto {
  id: string;
  key: string;
  name: string;
  /** Counted by quantity in this unit; null means valued by typing. */
  unit: string | null;
  /** The unit for one ("share", "coin"): the unit without a trailing s. */
  unitOne: string | null;
  /** The quantity a rate is quoted for. */
  ratePer: number;
  archived: boolean;
  isSystem: boolean;
  /** Held through a broker account: required, optional, or never. */
  brokerUse: "required" | "optional" | "never";
  /** Holdings (active or closed) of this kind. */
  holdingCount: number;
  /** A holding counted by quantity uses it, so its unit and rate cannot change. */
  locked: boolean;
  /** The price feed (gold or silver from the IBJA benchmark); null when rates are typed. */
  feed: "gold" | "silver" | null;
}
