import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { LedgerTxn } from "../domain/balances";
import type { ListTransactionsData, TransactionDto } from "../schemas/transaction";
import { ValidationError } from "../config/errors";
import { FLOW_TYPES } from "../domain/txnTypes";
import type { Db } from "./client";
import { transactions } from "./schema";

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;

export function toDto(row: TransactionRow): TransactionDto {
  return {
    id: row.id,
    type: row.type,
    amountPaise: row.amountPaise,
    txnDate: row.txnDate,
    accountId: row.accountId,
    toAccountId: row.toAccountId,
    categoryId: row.categoryId,
    merchant: row.merchant,
    note: row.note,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertTransactionRow(db: Db, row: NewTransactionRow): Promise<TransactionRow> {
  const [created] = await db.insert(transactions).values(row).returning();
  if (!created) throw new Error("Transaction insert returned no row");
  return created;
}

export async function getTransactionRow(
  db: Db,
  userId: string,
  id: string,
  options: { includeDeleted?: boolean } = {},
): Promise<TransactionRow | undefined> {
  const conditions = [eq(transactions.userId, userId), eq(transactions.id, id)];
  if (!options.includeDeleted) conditions.push(isNull(transactions.deletedAt));
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .limit(1);
  return row;
}

export async function updateTransactionRow(
  db: Db,
  userId: string,
  id: string,
  patch: Partial<NewTransactionRow>,
): Promise<TransactionRow | undefined> {
  const [row] = await db
    .update(transactions)
    .set(patch)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .returning();
  return row;
}

/** Transactions that count toward balances: confirmed and not deleted, only the columns the ledger math needs. */
export async function loadLedgerTxns(db: Db, userId: string): Promise<LedgerTxn[]> {
  return db
    .select({
      type: transactions.type,
      amountPaise: transactions.amountPaise,
      txnDate: transactions.txnDate,
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
      status: transactions.status,
      deletedAt: transactions.deletedAt,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, "confirmed"), isNull(transactions.deletedAt)));
}

interface Cursor {
  d: string;
  i: string;
}

export function encodeCursor(row: Pick<TransactionRow, "txnDate" | "id">): string {
  return btoa(JSON.stringify({ d: row.txnDate, i: row.id } satisfies Cursor));
}

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(atob(cursor));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Cursor).d === "string" &&
      typeof (parsed as Cursor).i === "string"
    ) {
      return parsed as Cursor;
    }
  } catch {
    // fall through to the error below
  }
  throw new ValidationError("Invalid cursor", [{ path: "cursor", message: "Invalid cursor" }]);
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The WHERE conditions shared by the list and its totals (everything except the paging cursor). */
function filterConditions(userId: string, query: ListTransactionsData): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [eq(transactions.userId, userId), isNull(transactions.deletedAt)];

  if (query.from) conditions.push(sql`${transactions.txnDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${transactions.txnDate} <= ${query.to}`);
  if (query.minAmountPaise !== undefined) conditions.push(sql`${transactions.amountPaise} >= ${query.minAmountPaise}`);
  if (query.maxAmountPaise !== undefined) conditions.push(sql`${transactions.amountPaise} <= ${query.maxAmountPaise}`);
  if (query.accountId) {
    conditions.push(or(eq(transactions.accountId, query.accountId), eq(transactions.toAccountId, query.accountId)));
  }

  // categoryId is a comma-separated list of category ids; "none" means entries without a category.
  const categoryIds = (query.categoryId ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (categoryIds.length > 0) {
    const ids = categoryIds.filter((c) => c !== "none");
    const parts: (SQL | undefined)[] = [];
    if (ids.length > 0) parts.push(inArray(transactions.categoryId, ids));
    if (categoryIds.includes("none")) {
      parts.push(and(isNull(transactions.categoryId), inArray(transactions.type, [...FLOW_TYPES])));
    }
    conditions.push(or(...parts));
  }

  if (query.type) conditions.push(eq(transactions.type, query.type));
  if (query.status) conditions.push(eq(transactions.status, query.status));

  if (query.q) {
    // Matches merchant, note, the category's name and the names of the accounts involved.
    const pattern = `%${escapeLike(query.q.toLowerCase())}%`;
    conditions.push(
      or(
        sql`lower(${transactions.merchant}) LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(${transactions.note}) LIKE ${pattern} ESCAPE '\\'`,
        sql`EXISTS (SELECT 1 FROM categories c WHERE c.id = ${transactions.categoryId} AND lower(c.name) LIKE ${pattern} ESCAPE '\\')`,
        sql`EXISTS (SELECT 1 FROM accounts a WHERE (a.id = ${transactions.accountId} OR a.id = ${transactions.toAccountId}) AND lower(a.name) LIKE ${pattern} ESCAPE '\\')`,
      ),
    );
  }
  return conditions;
}

export async function listTransactionRows(
  db: Db,
  userId: string,
  query: ListTransactionsData,
): Promise<{ rows: TransactionRow[]; nextCursor: string | null }> {
  const conditions = filterConditions(userId, query);
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conditions.push(or(lt(transactions.txnDate, c.d), and(eq(transactions.txnDate, c.d), lt(transactions.id, c.i))));
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null };
}

export interface ListTotals {
  count: number;
  /** Confirmed income and expense only; drafts, transfers and bill payments are counted but not summed. */
  incomePaise: number;
  expensePaise: number;
}

/** Count and in/out sums for everything the filters match, ignoring paging. */
export async function listTotals(db: Db, userId: string, query: ListTransactionsData): Promise<ListTotals> {
  const confirmed = sql`${transactions.status} = 'confirmed'`;
  const [row] = await db
    .select({
      count: sql<number>`COUNT(*)`,
      income: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income' AND ${confirmed} THEN ${transactions.amountPaise} ELSE 0 END), 0)`,
      expense: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'expense' AND ${confirmed} THEN ${transactions.amountPaise} ELSE 0 END), 0)`,
    })
    .from(transactions)
    .where(and(...filterConditions(userId, query)));
  return { count: Number(row?.count ?? 0), incomePaise: Number(row?.income ?? 0), expensePaise: Number(row?.expense ?? 0) };
}
