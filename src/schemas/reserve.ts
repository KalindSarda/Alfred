import { z } from "zod";

const Name = z.string().trim().min(1).max(60);
const Amount = z.number().int().positive().max(100_000_000_000_00);

/** Money to move out first each period (a transfer to savings, money to invest). */
export const CreateReserve = z.object({ name: Name, amountPaise: Amount }).strict();
export type CreateReserveData = z.output<typeof CreateReserve>;

export const UpdateReserve = z.object({ name: Name, amountPaise: Amount }).partial().strict();
export type UpdateReserveData = z.output<typeof UpdateReserve>;

/** Marks it moved for this period (the default), or not moved yet. */
export const SetMoved = z.object({ moved: z.boolean().optional() }).strict();
export type SetMovedData = z.output<typeof SetMoved>;
