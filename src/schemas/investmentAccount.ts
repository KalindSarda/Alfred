import { z } from "zod";
import { Id } from "./transaction";

const Name = z.string().trim().min(1).max(40);
const Purpose = z.string().trim().max(80);

export const CreateInvestmentAccount = z.object({ name: Name, purpose: Purpose.nullable().optional() }).strict();
export type CreateInvestmentAccountData = z.output<typeof CreateInvestmentAccount>;

export const UpdateInvestmentAccount = z.object({ name: Name, purpose: Purpose.nullable() }).partial().strict();
export type UpdateInvestmentAccountData = z.output<typeof UpdateInvestmentAccount>;

/** Moves holdings into an account, or out of every account with null. */
export const MoveHoldings = z.object({ ids: z.array(Id).min(1).max(90), investmentAccountId: Id.nullable() }).strict();
export type MoveHoldingsData = z.output<typeof MoveHoldings>;
