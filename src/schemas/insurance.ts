import { z } from "zod";
import { IstDateString } from "./transaction";

const Money = z.number().int().min(0).max(100_000_000_000_00);

export const CreatePolicy = z
  .object({
    kind: z.enum(["health", "term", "other"]),
    /** Cover through work has no premium Alfred plans for. */
    source: z.enum(["personal", "employer"]).optional(),
    insurer: z.string().trim().min(1).max(40),
    coverPaise: Money,
    premiumPaise: Money.optional(),
    frequency: z.enum(["yearly", "half_yearly", "quarterly", "monthly"]).optional(),
    /** A premium or renewal date; later ones follow by the frequency. */
    renewalDate: IstDateString,
    note: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export type CreatePolicyData = z.output<typeof CreatePolicy>;

export const UpdatePolicy = CreatePolicy.partial().extend({ status: z.enum(["active", "lapsed"]).optional() }).strict();
export type UpdatePolicyData = z.output<typeof UpdatePolicy>;

export const UpdateProfile = z
  .object({
    dependants: z.enum(["yes", "no", "partly", "unknown"]),
    employerHealth: z.enum(["yes", "no", "unknown"]),
  })
  .partial()
  .strict();
export type UpdateProfileData = z.output<typeof UpdateProfile>;
