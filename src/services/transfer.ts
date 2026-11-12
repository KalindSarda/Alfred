import { and, eq, gte, isNull, lte, notInArray, sql } from "drizzle-orm";
import { daysBetween } from "../alfred/voice";
import type { Db } from "../db/client";
import { transactions } from "../db/schema";
import type { IstDate } from "../domain/dates";
import { suggestTransfer, type TransferSuggestion } from "../domain/transfer";
import { getCommitments } from "./commitments";
import { getEmergencyFund } from "./emergency";
import { listAccountsWithFigures } from "./ledger";
import { getRunway } from "./runway";

export interface TransferView extends TransferSuggestion {
  freeToSpendPaise: number;
  until: IstDate;
  daysLeft: number;
  gapPaise: number | null;
  /** Where it would come from and go to; null when no account fits. */
  from: { id: string; name: string; availablePaise: number } | null;
  to: { id: string; name: string; countsTowardSafeToSpend: boolean } | null;
}

/** Everyday spending a day: expenses that are not already counted as committed (EMIs, loan instalments, repeating rules). */
async function dailySpend(db: Db, userId: string, from: IstDate, today: IstDate, days: number): Promise<number | null> {
  if (days < 14) return null;
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amountPaise}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.type, "expense"), eq(transactions.status, "confirmed"), isNull(transactions.deletedAt), gte(transactions.txnDate, from), lte(transactions.txnDate, today), notInArray(transactions.source, ["emi", "loan", "recurring"])));
  return Math.round(Number(row?.total ?? 0) / days);
}

/**
 * How much could move from spending money into the emergency fund today. It comes from the counted bank with the most
 * available money and goes to a bank account marked as the emergency fund. Alfred only suggests; the person moves the money.
 */
export async function getTransferSuggestion(db: Db, userId: string, today: IstDate): Promise<TransferView> {
  const [fund, commitments, figures, runway] = await Promise.all([getEmergencyFund(db, userId, today), getCommitments(db, userId, today), listAccountsWithFigures(db, userId, today), getRunway(db, userId, today)]);
  const banks = figures.flatMap((a) => (a.kind === "bank" && !a.archivedAt ? [a] : []));
  const to = banks.find((a) => a.isEmergency) ?? null;
  const from = banks.filter((a) => a.countsTowardSafeToSpend && !a.isEmergency).sort((a, b) => b.balancePaise - b.blockedPaise - (a.balancePaise - a.blockedPaise))[0] ?? null;
  const available = from ? Math.max(0, from.balancePaise - from.blockedPaise) : null;
  const daysLeft = Math.max(0, daysBetween(today, commitments.until));
  const daily = await dailySpend(db, userId, runway.windowFrom, today, runway.basedOnDays);

  const suggestion = suggestTransfer({ gapPaise: fund.gapPaise, freeToSpendPaise: commitments.freeToSpendPaise, dailySpendPaise: daily, daysLeft, sourceAvailablePaise: available, hasDestination: to !== null });
  return {
    ...suggestion,
    freeToSpendPaise: commitments.freeToSpendPaise,
    until: commitments.until,
    daysLeft,
    gapPaise: fund.gapPaise,
    from: from && available !== null ? { id: from.id, name: from.name, availablePaise: available } : null,
    to: to ? { id: to.id, name: to.name, countsTowardSafeToSpend: to.countsTowardSafeToSpend } : null,
  };
}
