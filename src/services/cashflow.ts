import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { categories, transactions } from "../db/schema";
import { type DateRange, type IstDate, type PeriodKey, resolvePeriod } from "../domain/dates";
import { FLOW_TYPES } from "../domain/txnTypes";
import { getSettings } from "./settings";

export type GroupBy = "category" | "merchant";

export interface CashflowRow {
  /** Stable key: the category id, "none" for uncategorized, or the lower-cased merchant. */
  key: string;
  categoryId: string | null;
  name: string;
  amountPaise: number;
  /** Share of the period's income, one decimal (0 when there was no income). */
  pctOfIncome: number;
}

export interface CashflowDto {
  period: { key: PeriodKey } & DateRange;
  groupBy: GroupBy;
  incomePaise: number;
  expensePaise: number;
  /** Income minus expenses; what Alfred calls savings when positive. */
  surplusPaise: number;
  income: CashflowRow[];
  expenses: CashflowRow[];
}

const pct = (amount: number, income: number) => (income > 0 ? Math.round((amount / income) * 1000) / 10 : 0);

function flowConditions(userId: string, range: DateRange) {
  return and(
    eq(transactions.userId, userId),
    eq(transactions.status, "confirmed"),
    isNull(transactions.deletedAt),
    inArray(transactions.type, [...FLOW_TYPES]),
    sql`${transactions.txnDate} >= ${range.from}`,
    sql`${transactions.txnDate} <= ${range.to}`,
  );
}

interface RawRow {
  type: "income" | "expense";
  key: string;
  categoryId: string | null;
  name: string;
  total: number;
}

async function groupedRows(db: Db, userId: string, range: DateRange, groupBy: GroupBy): Promise<RawRow[]> {
  const total = sql<number>`SUM(${transactions.amountPaise})`;
  if (groupBy === "category") {
    const rows = await db
      .select({ type: transactions.type, categoryId: transactions.categoryId, name: categories.name, total })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(flowConditions(userId, range))
      .groupBy(transactions.type, transactions.categoryId)
      .orderBy(desc(total));
    return rows.map((r) => ({
      type: r.type as "income" | "expense",
      key: r.categoryId ?? "none",
      categoryId: r.categoryId,
      name: r.name ?? "Uncategorized",
      total: Number(r.total),
    }));
  }

  const key = sql<string>`COALESCE(NULLIF(lower(trim(${transactions.merchant})), ''), '')`;
  const rows = await db
    .select({ type: transactions.type, key, name: sql<string | null>`MIN(${transactions.merchant})`, total })
    .from(transactions)
    .where(flowConditions(userId, range))
    .groupBy(transactions.type, key)
    .orderBy(desc(total));
  return rows.map((r) => ({
    type: r.type as "income" | "expense",
    key: r.key,
    categoryId: null,
    name: r.key === "" ? "No merchant" : (r.name ?? r.key),
    total: Number(r.total),
  }));
}

/**
 * Where income came from and where it went, for the Sankey, the Profit and loss table and the breakdown cards.
 * Only confirmed income and expense count: transfers, bill payments, drafts and deleted rows are excluded.
 */
export async function getCashflow(db: Db, userId: string, key: PeriodKey, groupBy: GroupBy, today: IstDate): Promise<CashflowDto> {
  const { periodStartDay } = await getSettings(db, userId);
  const range = resolvePeriod(key, today, periodStartDay);
  const rows = await groupedRows(db, userId, range, groupBy);

  const sumOf = (type: "income" | "expense") => rows.filter((r) => r.type === type).reduce((s, r) => s + r.total, 0);
  const incomePaise = sumOf("income");
  const expensePaise = sumOf("expense");

  const toRows = (type: "income" | "expense"): CashflowRow[] =>
    rows
      .filter((r) => r.type === type)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .map((r) => ({ key: r.key, categoryId: r.categoryId, name: r.name, amountPaise: r.total, pctOfIncome: pct(r.total, incomePaise) }));

  return {
    period: { key, ...range },
    groupBy,
    incomePaise,
    expensePaise,
    surplusPaise: incomePaise - expensePaise,
    income: toRows("income"),
    expenses: toRows("expense"),
  };
}
