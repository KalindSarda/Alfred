import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, transactions } from "../db/schema";
import { cycleRange, type DateRange, type IstDate, previousCycleSameDays } from "../domain/dates";
import { getSettings } from "./settings";

export interface AccountSpend {
  id: string;
  name: string;
  kind: "bank" | "card";
  archived: boolean;
  spentPaise: number;
  /** The same number of days of the previous month. */
  previousPaise: number;
  /** Share of this month's spending, one decimal; 0 when nothing was spent. */
  sharePct: number;
}

export interface SpendByAccountDto {
  /** This month so far, and the same stretch of the one before. */
  period: DateRange;
  previousPeriod: DateRange;
  totalPaise: number;
  previousTotalPaise: number;
  accounts: AccountSpend[];
}

async function totals(db: Db, userId: string, range: DateRange): Promise<Map<string, number>> {
  const total = sql<number>`SUM(${transactions.amountPaise})`;
  const rows = await db
    .select({ accountId: transactions.accountId, total })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.status, "confirmed"),
        isNull(transactions.deletedAt),
        eq(transactions.type, "expense"),
        sql`${transactions.txnDate} >= ${range.from}`,
        sql`${transactions.txnDate} <= ${range.to}`,
      ),
    )
    .groupBy(transactions.accountId);
  return new Map(rows.map((r) => [r.accountId, Number(r.total)]));
}

/**
 * What was spent from each account this month so far, against the same days last month. Only confirmed expenses count, on the
 * account they were paid from: a card's spending is on the card, and the bill payment from the bank that settles it is not an
 * expense, so nothing is counted twice. Refunds are not netted here.
 */
export async function getSpendByAccount(db: Db, userId: string, today: IstDate): Promise<SpendByAccountDto> {
  const { periodStartDay } = await getSettings(db, userId);
  const cycle = cycleRange(today, periodStartDay);
  const period: DateRange = { from: cycle.from, to: today < cycle.to ? today : cycle.to };
  const previousPeriod = previousCycleSameDays(today, periodStartDay);

  const [current, previous, list] = await Promise.all([
    totals(db, userId, period),
    totals(db, userId, previousPeriod),
    db
      .select({ id: accounts.id, name: accounts.name, kind: accounts.kind, archivedAt: accounts.archivedAt })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
  ]);

  const totalPaise = [...current.values()].reduce((s, v) => s + v, 0);
  const previousTotalPaise = [...previous.values()].reduce((s, v) => s + v, 0);

  const rows: AccountSpend[] = list
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      archived: a.archivedAt !== null,
      spentPaise: current.get(a.id) ?? 0,
      previousPaise: previous.get(a.id) ?? 0,
      sharePct: totalPaise > 0 ? Math.round(((current.get(a.id) ?? 0) / totalPaise) * 1000) / 10 : 0,
    }))
    .filter((a) => a.spentPaise > 0 || a.previousPaise > 0)
    .sort((a, b) => b.spentPaise - a.spentPaise || b.previousPaise - a.previousPaise || a.name.localeCompare(b.name));

  return { period, previousPeriod, totalPaise, previousTotalPaise, accounts: rows };
}
