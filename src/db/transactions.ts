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

export async function listTransactionRows(
  db: Db,
  userId: string,
  query: ListTransactionsData,
): Promise<{ rows: TransactionRow[]; nextCursor: string | null }> {
  const conditions: (SQL | undefined)[] = [eq(transactions.userId, userId), isNull(transactions.deletedAt)];

  if (query.from) conditions.push(sql`${transactions.txnDate} >= ${query.from}`);
  if (query.to) conditions.push(sql`${transactions.txnDate} <= ${query.to}`);
  if (query.accountId) {
    conditions.push(or(eq(transactions.accountId, query.accountId), eq(transactions.toAccountId, query.accountId)));
  }
  if (query.categoryId === "none") {
    conditions.push(isNull(transactions.categoryId), inArray(transactions.type, [...FLOW_TYPES]));
  } else if (query.categoryId) {
    conditions.push(eq(transactions.categoryId, query.categoryId));
  }
  if (query.type) conditions.push(eq(transactions.type, query.type));
  if (query.status) conditions.push(eq(transactions.status, query.status));
  if (query.q) {
    const pattern = `%${escapeLike(query.q.toLowerCase())}%`;
    conditions.push(
      or(
        sql`lower(${transactions.merchant}) LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(${transactions.note}) LIKE ${pattern} ESCAPE '\\'`,
      ),
    );
  }
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    conditions.push(
      or(lt(transactions.txnDate, c.d), and(eq(transactions.txnDate, c.d), lt(transactions.id, c.i))),
    );
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
