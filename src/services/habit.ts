import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import type { Db } from "../db/client";
import { checkinLog, transactions } from "../db/schema";
import { addDays, type IstDate, toIstDate } from "../domain/dates";
import type { UsualEntry } from "../domain/habits";

/** Entries the person made themselves. Rent, EMIs, loan instalments and balance bookings are not logging. */
export const MANUAL_SOURCES = ["web", "telegram", "ai"] as const;

/**
 * The day the person last logged something: the latest manual entry (by when it was entered, not the date on it), or a
 * "nothing today" answer, whichever is later. Null when they never have.
 */
export async function lastLoggedDate(db: Db, userId: string): Promise<IstDate | null> {
  const [[entry], [marker]] = await Promise.all([
    db
      .select({ at: max(transactions.createdAt) })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"), inArray(transactions.source, [...MANUAL_SOURCES]))),
    db
      .select({ day: max(checkinLog.day) })
      .from(checkinLog)
      .where(and(eq(checkinLog.userId, userId), eq(checkinLog.kind, "none_today"))),
  ]);
  const days: IstDate[] = [];
  if (entry?.at) days.push(toIstDate(new Date(entry.at)));
  if (marker?.day) days.push(marker.day as IstDate);
  return days.sort().at(-1) ?? null;
}

/** The person's own recent spends, for working out what they usually buy. */
export async function recentManualEntries(db: Db, userId: string, today: IstDate): Promise<UsualEntry[]> {
  const rows = await db
    .select({ id: transactions.id, type: transactions.type, amountPaise: transactions.amountPaise, merchant: transactions.merchant, note: transactions.note, accountId: transactions.accountId, txnDate: transactions.txnDate })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"), inArray(transactions.source, [...MANUAL_SOURCES]), eq(transactions.type, "expense")))
    .orderBy(desc(transactions.txnDate))
    .limit(400);
  const from = addDays(today, -62);
  return rows.filter((r) => r.txnDate >= from);
}
