import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "./client";
import { transactions } from "./schema";
import { FLOW_TYPES } from "../domain/txnTypes";

export interface MerchantHint {
  /** The merchant as last typed (its case is kept; matching is case-insensitive). */
  merchant: string;
  /** What it was filed under, and where it was paid from, the last time. */
  categoryId: string | null;
  accountId: string;
  /** How many of the recent entries named it. */
  count: number;
}

export interface EntryHints {
  /** One per merchant, the one used most recently first. */
  merchants: MerchantHint[];
  /** Accounts, the one used most recently first. */
  lastUsedAccountIds: string[];
}

const RECENT_ENTRIES = 300;

/**
 * What adding an entry can learn from the past: which category and account each merchant usually has, and which
 * accounts are used most lately. Instalments Alfred adds for an EMI plan are not merchants anyone typed, so they are left out. The bot and the web form share it, so both suggest the same things.
 */
export async function loadEntryHints(db: Db, userId: string, options: { merchantLimit?: number } = {}): Promise<EntryHints> {
  const [rows, used] = await Promise.all([
    db
      .select({ merchant: transactions.merchant, categoryId: transactions.categoryId, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), sql`${transactions.merchant} IS NOT NULL`, ne(transactions.source, "emi"), inArray(transactions.type, [...FLOW_TYPES])))
      .orderBy(desc(transactions.createdAt))
      .limit(RECENT_ENTRIES),
    db
      .select({ accountId: transactions.accountId, last: sql<string>`MAX(${transactions.createdAt})` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
      .groupBy(transactions.accountId)
      .orderBy(desc(sql`MAX(${transactions.createdAt})`)),
  ]);

  const byKey = new Map<string, MerchantHint>();
  for (const row of rows) {
    const text = (row.merchant ?? "").trim();
    const key = text.toLowerCase();
    if (!key) continue;
    const seen = byKey.get(key);
    if (seen) seen.count += 1;
    else byKey.set(key, { merchant: text, categoryId: row.categoryId, accountId: row.accountId, count: 1 });
  }
  return { merchants: [...byKey.values()].slice(0, options.merchantLimit ?? 100), lastUsedAccountIds: used.map((r) => r.accountId) };
}
