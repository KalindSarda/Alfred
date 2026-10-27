import { z } from "zod";
import type { ErrorDetail } from "../config/errors";

export const Paise = z.number().int().positive();
export const IstDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const Id = z.string().min(1);

export const TransactionType = z.enum(["expense", "income", "transfer"]);
export const TxnStatus = z.enum(["draft", "confirmed"]);
export const TxnSource = z.enum(["web", "telegram", "seed", "ai"]);

const TransactionFields = z.object({
  type: TransactionType,
  amountPaise: Paise,
  txnDate: IstDateString,
  accountId: Id,
  toAccountId: Id.nullable().optional(),
  categoryId: Id.nullable().optional(),
  merchant: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(280).nullable().optional(),
});

/** Shape rules shared by create (zod refinement) and update (service, on the merged result). */
export function checkTransactionShape(v: {
  type: z.infer<typeof TransactionType>;
  accountId: string;
  toAccountId?: string | null | undefined;
  categoryId?: string | null | undefined;
}): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if (v.type === "transfer") {
    if (!v.toAccountId || v.toAccountId === v.accountId) {
      issues.push({ path: "toAccountId", message: "Transfer needs a different destination account" });
    }
    if (v.categoryId) issues.push({ path: "categoryId", message: "Transfers have no category" });
  } else if (v.toAccountId) {
    issues.push({ path: "toAccountId", message: "Only transfers have a destination" });
  }
  return issues;
}

export const CreateTransaction = TransactionFields.extend({
  status: TxnStatus.default("confirmed"),
}).superRefine((v, ctx) => {
  for (const issue of checkTransactionShape(v)) {
    ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  }
});

export const UpdateTransaction = TransactionFields.partial().extend({ status: TxnStatus.optional() });

export type CreateTransactionInput = z.input<typeof CreateTransaction>;
export type CreateTransactionData = z.output<typeof CreateTransaction>;
export type UpdateTransactionData = z.output<typeof UpdateTransaction>;

export const Transaction = z.object({
  id: Id,
  type: TransactionType,
  amountPaise: Paise,
  txnDate: IstDateString,
  accountId: Id,
  toAccountId: Id.nullable(),
  categoryId: Id.nullable(),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  status: TxnStatus,
  source: TxnSource,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TransactionDto = z.infer<typeof Transaction>;

export const ListTransactionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  from: IstDateString.optional(),
  to: IstDateString.optional(),
  accountId: Id.optional(),
  categoryId: z.string().optional(), // a category id, or "none" for uncategorized
  type: TransactionType.optional(),
  status: TxnStatus.optional(),
  q: z.string().trim().max(80).optional(),
});
export type ListTransactionsData = z.output<typeof ListTransactionsQuery>;
