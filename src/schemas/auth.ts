import { z } from "zod";

export const RequestCodeBody = z.object({
  email: z.email().max(254),
  channel: z.enum(["telegram", "email"]).optional(),
});

export const VerifyCodeBody = z.object({
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});
