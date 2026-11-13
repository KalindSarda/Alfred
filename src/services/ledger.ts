import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount, listAccounts, type AccountRow } from "../db/accounts";
import { getCategory } from "../db/categories";
import { NETTED_INCOME_CATEGORIES } from "../db/defaultCategories";
import {
  getTransactionRow,
  insertTransactionRow,
  listTotals,
  type ListTotals,
  listTransactionRows,
  loadLedgerTxns,
  toDto,
  updateTransactionRow,
} from "../db/transactions";
import {
  type BankLedgerAccount,
  bankBalance,
  type CardLedgerAccount,
  cardSummary,
  type CardSummary,
  type LedgerAccount,
  safeToSpend,
} from "../domain/balances";
import { type IstDate, isValidIstDate } from "../domain/dates";
import { emiToComeByCard } from "../db/emi";
import { goalsSetAside } from "../db/goals";
import { activeHoldTotals } from "../db/holds";
import { hasNoCategory, isDebtType, isMovement } from "../domain/txnTypes";
import { getHoldingRow } from "../db/holdings";
import {
  checkTransactionShape,
  CreateTransaction,
  type CreateTransactionInput,
  ListTransactionsQuery,
  type TransactionDto,
  UpdateTransaction,
} from "../schemas/transaction";
import { newId, nowIso } from "../utils/id";

type Source = TransactionDto["source"];

interface WriteContext {
  source: Source;
}

interface Resolved {
  type: TransactionDto["type"];
  amountPaise: number;
  txnDate: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  merchant: string | null;
  note: string | null;
  holdingId: string | null;
  countsForDate: string | null;
  status: TransactionDto["status"];
}

function failShape(issues: { path: string; message: string }[]): never {
  throw new ValidationError("Request validation failed", issues);
}

function assertValidDate(date: string): void {
  if (!isValidIstDate(date)) failShape([{ path: "txnDate", message: "Not a real calendar date" }]);
}

async function requireUsableAccount(db: Db, userId: string, id: string): Promise<AccountRow> {
  const account = await getAccount(db, userId, id);
  if (!account) throw new NotFoundError("Account not found");
  if (account.archivedAt) failShape([{ path: "accountId", message: "Account is archived" }]);
  return account;
}

/**
 * Transfers move money between two bank accounts. Paying a card is a bill payment (bank -> card), so a card
 * cannot appear in a transfer and a bill payment must go from a bank to a card.
 */
function assertAccountKinds(v: Resolved, fromKind: "bank" | "card", toKind: "bank" | "card" | undefined): void {
  if (v.type === "transfer") {
    if (fromKind === "card") failShape([{ path: "accountId", message: "Transfers are between bank accounts. Use a bill payment to pay a card" }]);
    if (toKind === "card") failShape([{ path: "toAccountId", message: "Transfers are between bank accounts. Use a bill payment to pay a card" }]);
  } else if (v.type === "bill_payment") {
    if (fromKind !== "bank") failShape([{ path: "accountId", message: "A bill payment is paid from a bank account" }]);
    if (toKind !== "card") failShape([{ path: "toAccountId", message: "A bill payment is paid to a credit card" }]);
  } else if (v.type === "investment") {
    if (fromKind !== "bank") failShape([{ path: "accountId", message: "An investment is paid from a bank account" }]);
  } else if (v.type === "investment_sale") {
    if (fromKind !== "bank") failShape([{ path: "accountId", message: "The proceeds of a sale come into a bank account" }]);
  } else if (v.type === "loan_payment") {
    if (fromKind !== "bank") failShape([{ path: "accountId", message: "A loan is paid from a bank account" }]);
  } else if (isDebtType(v.type)) {
    if (fromKind !== "bank") failShape([{ path: "accountId", message: "Lent and borrowed money moves through a bank account" }]);
  }
}

/** Enforces the cross-record rules that Zod alone cannot: ownership, archived accounts, category kind. */
async function validateReferences(db: Db, userId: string, v: Resolved): Promise<void> {
  assertValidDate(v.txnDate);
  if (v.holdingId) {
    const holding = await getHoldingRow(db, userId, v.holdingId);
    if (!holding) throw new NotFoundError("Holding not found");
    if (holding.status !== "active") failShape([{ path: "holdingId", message: "That holding is closed" }]);
  }
  const from = await requireUsableAccount(db, userId, v.accountId);
  const to = v.toAccountId ? await requireUsableAccount(db, userId, v.toAccountId) : undefined;
  assertAccountKinds(v, from.kind, to?.kind);
  if (v.categoryId) {
    const category = await getCategory(db, userId, v.categoryId);
    if (!category) throw new NotFoundError("Category not found");
    if (category.archivedAt) failShape([{ path: "categoryId", message: "Category is archived" }]);
    if (category.kind !== v.type) {
      failShape([{ path: "categoryId", message: `A ${category.kind} category cannot be used on an ${v.type}` }]);
    }
  }
  if (v.countsForDate) {
    if (!isValidIstDate(v.countsForDate)) failShape([{ path: "countsForDate", message: "Not a real calendar date" }]);
    const category = v.categoryId ? await getCategory(db, userId, v.categoryId) : undefined;
    if (!category || !NETTED_INCOME_CATEGORIES.includes(category.name)) {
      failShape([{ path: "countsForDate", message: "Only Refunds and Repaid by others can count for an earlier day" }]);
    }
  }
}

/**
 * The single create contract shared by the web routes and the Telegram bot.
 * Card bill payments are their own type (bank -> card), never expenses.
 */
export async function createTransaction(
  db: Db,
  userId: string,
  input: CreateTransactionInput,
  ctx: WriteContext,
): Promise<TransactionDto> {
  const parsed = CreateTransaction.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      "Request validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const v = parsed.data;
  // Lending and borrowing are recorded from Lent and borrowed, which keeps the debt and the bank entry together.
  if (isDebtType(v.type)) failShape([{ path: "type", message: "Record lent and borrowed money under Commitments, Lent and borrowed" }]);
  // A sale is recorded from the holding, which keeps its value and the bank entry together.
  if (v.type === "investment_sale") failShape([{ path: "type", message: "Record a sale under Accounts, Investments" }]);
  if (v.type === "loan_payment") failShape([{ path: "type", message: "Loan instalments are recorded under Commitments, Loans" }]);
  const resolved: Resolved = {
    type: v.type,
    amountPaise: v.amountPaise,
    txnDate: v.txnDate,
    accountId: v.accountId,
    toAccountId: v.toAccountId ?? null,
    categoryId: v.categoryId ?? null,
    merchant: v.merchant ?? null,
    note: v.note ?? null,
    holdingId: v.holdingId ?? null,
    countsForDate: v.countsForDate ?? null,
    status: v.status,
  };
  await validateReferences(db, userId, resolved);

  const now = nowIso();
  const row = await insertTransactionRow(db, {
    id: newId(),
    userId,
    ...resolved,
    source: ctx.source,
    createdAt: now,
    updatedAt: now,
  });
  return toDto(row);
}

export async function getTransaction(db: Db, userId: string, id: string): Promise<TransactionDto> {
  const row = await getTransactionRow(db, userId, id);
  if (!row) throw new NotFoundError("Transaction not found");
  return toDto(row);
}

export async function updateTransaction(
  db: Db,
  userId: string,
  id: string,
  patchInput: unknown,
): Promise<TransactionDto> {
  const parsed = UpdateTransaction.safeParse(patchInput);
  if (!parsed.success) {
    throw new ValidationError(
      "Request validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const existing = await getTransactionRow(db, userId, id);
  if (!existing) throw new NotFoundError("Transaction not found");
  if (isDebtType(existing.type) || (parsed.data.type !== undefined && isDebtType(parsed.data.type))) {
    throw new ConflictError("This entry belongs to lent and borrowed money. Change it there.");
  }
  if (existing.loanId !== null || existing.type === "loan_payment" || parsed.data.type === "loan_payment") {
    throw new ConflictError("This entry is part of a loan instalment. Change it under Commitments, Loans.");
  }
  if (existing.type === "investment_sale" || parsed.data.type === "investment_sale") {
    throw new ConflictError("This entry is the sale of a holding. Change it under Accounts, Investments.");
  }

  const p = parsed.data;
  const merged: Resolved = {
    type: p.type ?? existing.type,
    amountPaise: p.amountPaise ?? existing.amountPaise,
    txnDate: p.txnDate ?? existing.txnDate,
    accountId: p.accountId ?? existing.accountId,
    toAccountId: p.toAccountId === undefined ? existing.toAccountId : p.toAccountId,
    categoryId: p.categoryId === undefined ? existing.categoryId : p.categoryId,
    merchant: p.merchant === undefined ? existing.merchant : p.merchant,
    note: p.note === undefined ? existing.note : p.note,
    holdingId: p.holdingId === undefined ? existing.holdingId : p.holdingId,
    countsForDate: p.countsForDate === undefined ? existing.countsForDate : p.countsForDate,
    status: p.status ?? existing.status,
  };
  // Only an investment can belong to a holding; changing it into something else lets go of it.
  if (merged.type !== "investment" && p.holdingId === undefined) merged.holdingId = null;
  // Changing to a movement (transfer or bill payment) or an investment clears the category; changing away clears the destination.
  if (hasNoCategory(merged.type) && p.categoryId === undefined) merged.categoryId = null;
  if (!isMovement(merged.type) && p.toAccountId === undefined) merged.toAccountId = null;

  // The day it counts for belongs to a refund or a repayment: moved to something else, it lets go of it.
  if (merged.countsForDate !== null && p.countsForDate === undefined) {
    const category = merged.type === "income" && merged.categoryId ? await getCategory(db, userId, merged.categoryId) : undefined;
    if (!category || !NETTED_INCOME_CATEGORIES.includes(category.name)) merged.countsForDate = null;
  }

  const issues = checkTransactionShape(merged);
  if (issues.length) failShape(issues);
  await validateReferences(db, userId, merged);

  const row = await updateTransactionRow(db, userId, id, { ...merged, updatedAt: nowIso() });
  if (!row) throw new NotFoundError("Transaction not found");
  return toDto(row);
}

export async function softDeleteTransaction(db: Db, userId: string, id: string): Promise<void> {
  const row = await getTransactionRow(db, userId, id);
  if (!row) throw new NotFoundError("Transaction not found");
  if (isDebtType(row.type)) throw new ConflictError("This entry belongs to lent and borrowed money. Remove it there.");
  if (row.loanId !== null) throw new ConflictError("This entry is part of a loan instalment. Remove the instalment under Commitments, Loans.");
  const now = nowIso();
  await updateTransactionRow(db, userId, id, { deletedAt: now, updatedAt: now });
}

export async function restoreTransaction(db: Db, userId: string, id: string): Promise<TransactionDto> {
  const row = await getTransactionRow(db, userId, id, { includeDeleted: true });
  if (!row) throw new NotFoundError("Transaction not found");
  const restored = await updateTransactionRow(db, userId, id, { deletedAt: null, updatedAt: nowIso() });
  if (!restored) throw new NotFoundError("Transaction not found");
  return toDto(restored);
}

/** Draft -> confirmed, used by the review flow once an AI-created draft exists. */
export async function confirmTransaction(db: Db, userId: string, id: string): Promise<TransactionDto> {
  const row = await getTransactionRow(db, userId, id);
  if (!row) throw new NotFoundError("Transaction not found");
  if (row.status !== "draft") throw new ConflictError("Transaction is not a draft");
  const confirmed = await updateTransactionRow(db, userId, id, { status: "confirmed", updatedAt: nowIso() });
  if (!confirmed) throw new NotFoundError("Transaction not found");
  return toDto(confirmed);
}

export async function listTransactions(
  db: Db,
  userId: string,
  rawQuery: unknown,
): Promise<{ items: TransactionDto[]; nextCursor: string | null; totals: ListTotals }> {
  const parsed = ListTransactionsQuery.safeParse(rawQuery);
  if (!parsed.success) {
    throw new ValidationError(
      "Request validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const [{ rows, nextCursor }, totals] = await Promise.all([
    listTransactionRows(db, userId, parsed.data),
    listTotals(db, userId, parsed.data),
  ]);
  return { items: rows.map(toDto), nextCursor, totals };
}

export type AccountWithFigures =
  | (AccountRow & { kind: "bank"; balancePaise: number; blockedPaise: number })
  | (AccountRow & { kind: "card"; summary: CardSummary; emiToComePaise: number });

export function toLedgerAccount(row: AccountRow): LedgerAccount {
  if (row.kind === "bank") {
    return {
      id: row.id,
      kind: "bank",
      openingBalancePaise: row.openingBalancePaise,
      countsTowardSafeToSpend: row.countsTowardSafeToSpend,
    } satisfies BankLedgerAccount;
  }
  return {
    id: row.id,
    kind: "card",
    openingOutstandingPaise: row.openingOutstandingPaise,
    creditLimitPaise: row.creditLimitPaise ?? 0,
    statementDay: row.statementDay ?? 1,
    dueDay: row.dueDay ?? 1,
  } satisfies CardLedgerAccount;
}

/**
 * Accounts with derived figures. Loads only the columns the ledger math needs and computes in the
 * domain layer; fine at personal scale (thousands of rows a year), revisit with SQL aggregation if slow.
 */
export async function listAccountsWithFigures(
  db: Db,
  userId: string,
  today: IstDate,
  options: { includeArchived?: boolean } = {},
): Promise<AccountWithFigures[]> {
  const [rows, txns, blocked, emiToCome] = await Promise.all([
    listAccounts(db, userId, options),
    loadLedgerTxns(db, userId),
    activeHoldTotals(db, userId),
    emiToComeByCard(db, userId, today),
  ]);
  return rows.map((row): AccountWithFigures => {
    const ledger = toLedgerAccount(row);
    if (ledger.kind === "bank") {
      return { ...row, kind: "bank", balancePaise: bankBalance(ledger, txns, today), blockedPaise: blocked.get(row.id) ?? 0 };
    }
    return { ...row, kind: "card", summary: cardSummary(ledger, txns, today), emiToComePaise: emiToCome.get(row.id) ?? 0 };
  });
}

export async function getSafeToSpend(db: Db, userId: string, today: IstDate): Promise<number> {
  const [rows, txns, blocked, setAside] = await Promise.all([listAccounts(db, userId), loadLedgerTxns(db, userId), activeHoldTotals(db, userId), goalsSetAside(db, userId)]);
  return safeToSpend(rows.map(toLedgerAccount), txns, today, blocked) - setAside;
}
