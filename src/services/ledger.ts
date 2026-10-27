import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount, listAccounts, type AccountRow } from "../db/accounts";
import { getCategory } from "../db/categories";
import {
  getTransactionRow,
  insertTransactionRow,
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
import { isMovement } from "../domain/txnTypes";
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
  }
}

/** Enforces the cross-record rules that Zod alone cannot: ownership, archived accounts, category kind. */
async function validateReferences(db: Db, userId: string, v: Resolved): Promise<void> {
  assertValidDate(v.txnDate);
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
  const resolved: Resolved = {
    type: v.type,
    amountPaise: v.amountPaise,
    txnDate: v.txnDate,
    accountId: v.accountId,
    toAccountId: v.toAccountId ?? null,
    categoryId: v.categoryId ?? null,
    merchant: v.merchant ?? null,
    note: v.note ?? null,
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
    status: p.status ?? existing.status,
  };
  // Changing to a movement (transfer or bill payment) clears the category; changing away clears the destination.
  if (isMovement(merged.type) && p.categoryId === undefined) merged.categoryId = null;
  if (!isMovement(merged.type) && p.toAccountId === undefined) merged.toAccountId = null;

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
): Promise<{ items: TransactionDto[]; nextCursor: string | null }> {
  const parsed = ListTransactionsQuery.safeParse(rawQuery);
  if (!parsed.success) {
    throw new ValidationError(
      "Request validation failed",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const { rows, nextCursor } = await listTransactionRows(db, userId, parsed.data);
  return { items: rows.map(toDto), nextCursor };
}

export type AccountWithFigures =
  | (AccountRow & { kind: "bank"; balancePaise: number })
  | (AccountRow & { kind: "card"; summary: CardSummary });

function toLedgerAccount(row: AccountRow): LedgerAccount {
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
  const [rows, txns] = await Promise.all([listAccounts(db, userId, options), loadLedgerTxns(db, userId)]);
  return rows.map((row): AccountWithFigures => {
    const ledger = toLedgerAccount(row);
    if (ledger.kind === "bank") {
      return { ...row, kind: "bank", balancePaise: bankBalance(ledger, txns, today) };
    }
    return { ...row, kind: "card", summary: cardSummary(ledger, txns, today) };
  });
}

export async function getSafeToSpend(db: Db, userId: string, today: IstDate): Promise<number> {
  const [rows, txns] = await Promise.all([listAccounts(db, userId), loadLedgerTxns(db, userId)]);
  return safeToSpend(rows.map(toLedgerAccount), txns, today);
}
