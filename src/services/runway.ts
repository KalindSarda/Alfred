import { and, eq, gte, inArray, isNotNull, isNull, lte, min, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, transactions } from "../db/schema";
import { addDays, type IstDate } from "../domain/dates";
import { WINDOW_DAYS, type Runway, runway } from "../domain/runway";
import { balanceOverview } from "./accounts";
import { listAccountsWithFigures } from "./ledger";

/**
 * How many months the bank money would last at what must be spent. "Must be spent" is every expense in a category marked
 * essential, every card EMI instalment, and every loan instalment (its interest and its principal), over the last 90 days
 * or as far back as the person has entries. Prepayments and foreclosure are choices, not burn, and are left out.
 */
export async function getRunway(db: Db, userId: string, today: IstDate): Promise<Runway> {
  const [figures, [first]] = await Promise.all([
    listAccountsWithFigures(db, userId, today),
    db.select({ day: min(transactions.txnDate) }).from(transactions).where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"))),
  ]);
  const overview = balanceOverview(figures);
  const firstEntryDate = (first?.day ?? null) as IstDate | null;
  const from = addDays(today, -(WINDOW_DAYS - 1));

  const rows = await db
    .select({ date: transactions.txnDate, amountPaise: transactions.amountPaise })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        eq(transactions.status, "confirmed"),
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, today),
        or(
          and(eq(transactions.type, "expense"), or(eq(categories.isEssential, true), eq(transactions.source, "emi"), and(eq(transactions.source, "loan"), isNotNull(transactions.loanOn)))),
          and(inArray(transactions.type, ["loan_payment"]), isNotNull(transactions.loanOn)),
        ),
      ),
    );
  return runway(overview.countedPaise - overview.blockedPaise, rows as { date: IstDate; amountPaise: number }[], firstEntryDate, today);
}
