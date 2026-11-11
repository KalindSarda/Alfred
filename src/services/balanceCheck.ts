import { NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getCategoryByName } from "../db/categories";
import type { IstDate } from "../domain/dates";
import { createCategory, updateCategory } from "./categories";
import { createTransaction, listAccountsWithFigures } from "./ledger";

export const UNLOGGED_SPENDING = "Unlogged spending";
export const UNRECORDED_INCOME = "Unrecorded income";

export interface BalancePreview {
  accountId: string;
  accountName: string;
  /** What Alfred has for the account. */
  alfredPaise: number;
  /** What the bank says. */
  typedPaise: number;
  /** The bank's figure less Alfred's: negative means money left that was not logged. */
  differencePaise: number;
}

async function bankFigures(db: Db, userId: string, accountId: string, today: IstDate) {
  const all = await listAccountsWithFigures(db, userId, today);
  const found = all.find((a) => a.id === accountId);
  if (!found) throw new NotFoundError("Account not found");
  if (found.kind !== "bank") throw new ValidationError("Request validation failed", [{ path: "accountId", message: "A balance check is for a bank account" }]);
  return found;
}

/** What a typed bank balance says about the account: how far apart Alfred and the bank are. */
export async function previewBalance(db: Db, userId: string, accountId: string, typedPaise: number, today: IstDate): Promise<BalancePreview> {
  const a = await bankFigures(db, userId, accountId, today);
  return { accountId, accountName: a.name, alfredPaise: a.balancePaise, typedPaise, differencePaise: typedPaise - a.balancePaise };
}

/** The category for a booking, created the first time it is needed (and brought back if it was archived). */
export async function categoryFor(db: Db, userId: string, name: string, kind: "expense" | "income"): Promise<string> {
  const found = await getCategoryByName(db, userId, kind, name);
  if (!found) return (await createCategory(db, userId, { name, kind })).id;
  if (found.archivedAt) await updateCategory(db, userId, found.id, { archived: false });
  return found.id;
}

export interface BalanceSettled {
  kind: "spending" | "income" | "none";
  bookedPaise: number;
  accountName: string;
  /** What Alfred has for the account afterwards. */
  balancePaise: number;
}

/**
 * Makes Alfred agree with the bank: the gap is booked as one entry dated today, spending when the bank holds less and
 * income when it holds more. It is worked out again here, so a balance that moved since the question is still left right.
 */
export async function settleBalance(db: Db, userId: string, accountId: string, typedPaise: number, today: IstDate): Promise<BalanceSettled> {
  const preview = await previewBalance(db, userId, accountId, typedPaise, today);
  const diff = preview.differencePaise;
  if (diff === 0) return { kind: "none", bookedPaise: 0, accountName: preview.accountName, balancePaise: preview.alfredPaise };
  const spending = diff < 0;
  await createTransaction(
    db,
    userId,
    {
      type: spending ? "expense" : "income",
      amountPaise: Math.abs(diff),
      txnDate: today,
      accountId,
      categoryId: await categoryFor(db, userId, spending ? UNLOGGED_SPENDING : UNRECORDED_INCOME, spending ? "expense" : "income"),
      note: "Balance check",
    },
    { source: "check" },
  );
  return { kind: spending ? "spending" : "income", bookedPaise: Math.abs(diff), accountName: preview.accountName, balancePaise: typedPaise };
}
