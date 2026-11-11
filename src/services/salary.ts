import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { commitmentsLines, salaryPlanLines } from "../alfred/botVoice";
import type { Db } from "../db/client";
import { categories, transactions } from "../db/schema";
import { addDays, type IstDate } from "../domain/dates";
import { formatRupees } from "../domain/money";
import { goalAsks, perDayPaise } from "../domain/salaryPlan";
import { getCommitments } from "./commitments";
import { listGoals } from "./goals";

export interface SalaryEntry {
  id: string;
  amountPaise: number;
  date: IstDate;
}

export interface Plan {
  text: string;
  /** Set-aside buttons for goals that want money this month: `g:<goalId>:s:<paise>`. */
  buttons: { text: string; data: string }[][];
}

/** Confirmed income filed under Salary, newest first, between `from` and today. */
export async function salaryEntries(db: Db, userId: string, from: IstDate, today: IstDate): Promise<SalaryEntry[]> {
  const rows = await db
    .select({ id: transactions.id, amountPaise: transactions.amountPaise, date: transactions.txnDate })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), eq(transactions.type, "income"), eq(transactions.status, "confirmed"), isNull(transactions.deletedAt), eq(categories.name, "Salary"), gte(transactions.txnDate, from), lte(transactions.txnDate, today)))
    .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));
  return rows.map((r) => ({ id: r.id, amountPaise: r.amountPaise, date: r.date as IstDate }));
}

/** The latest salary credit in the last 60 days, or null. */
export async function latestSalary(db: Db, userId: string, today: IstDate): Promise<SalaryEntry | null> {
  return (await salaryEntries(db, userId, addDays(today, -60), today))[0] ?? null;
}

/**
 * The salary day plan: what is still to leave before the next salary (the commitments view), what is free to spend after
 * it and about how much a day, and the goals that want money this month with a button to set it aside. Money set aside
 * stays in the bank, as goals work everywhere else.
 */
export async function buildSalaryPlan(db: Db, userId: string, today: IstDate, salary: SalaryEntry | null): Promise<Plan> {
  const [view, goals] = await Promise.all([getCommitments(db, userId, today), listGoals(db, userId, today, "active")]);
  const coming = view.items.filter((i) => !i.counted);
  const asks = goalAsks(goals.goals);
  const text = salaryPlanLines({
    salary: salary ? { amountPaise: salary.amountPaise, date: salary.date } : null,
    commitments: { until: view.until, basis: view.basis, items: coming, safeToSpendPaise: view.safeToSpendPaise, freeToSpendPaise: view.freeToSpendPaise, commitmentsPaise: view.commitmentsPaise },
    perDay: perDayPaise(view.freeToSpendPaise, today, view.until),
    goals: asks.map((a) => ({ name: a.name, paise: a.paise })),
  }).join("\n");
  return { text, buttons: asks.map((a) => [{ text: `Set aside ${formatRupees(a.paise)} for ${a.name}`, data: `g:${a.id}:s:${a.paise}` }]) };
}
