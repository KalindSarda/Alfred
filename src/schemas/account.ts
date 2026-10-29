import { z } from "zod";

const Name = z.string().trim().min(1).max(40);
const Last4 = z.string().regex(/^\d{4}$/, "Expected 4 digits").nullable();
const Day = z.number().int().min(1).max(31);

export const CreateAccount = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bank"),
    name: Name,
    last4: Last4.optional(),
    openingBalancePaise: z.number().int(),
    countsTowardSafeToSpend: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("card"),
    name: Name,
    last4: Last4.optional(),
    creditLimitPaise: z.number().int().positive(),
    statementDay: Day,
    dueDay: Day,
    openingOutstandingPaise: z.number().int().min(0).default(0),
  }),
]);
export type CreateAccountData = z.output<typeof CreateAccount>;

/** `kind` cannot change. Fields that do not apply to the account's kind are rejected by the service. */
export const UpdateAccount = z
  .object({
    name: Name,
    last4: Last4,
    openingBalancePaise: z.number().int(),
    countsTowardSafeToSpend: z.boolean(),
    creditLimitPaise: z.number().int().positive(),
    statementDay: Day,
    dueDay: Day,
    openingOutstandingPaise: z.number().int().min(0),
  })
  .partial()
  .strict();
export type UpdateAccountData = z.output<typeof UpdateAccount>;

export const MergeAccount = z.object({ intoId: z.string().min(1).max(64) }).strict();

export const ListAccountsQuery = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
