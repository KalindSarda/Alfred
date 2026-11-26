import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { commitmentsLines, salaryPlanLines } from "../alfred/botVoice";
import type { Db } from "../db/client";
import { categories, salaryLog, transactions } from "../db/schema";
import { addDays, type IstDate } from "../domain/dates";
import { formatRupees } from "../domain/money";
import { goalAsks, perDayPaise } from "../domain/salaryPlan";
import { getCommitments } from "./commitments";
import { transferOffer } from "./fundTalk";
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

/**
 * Salary credits between `from` and today that no salary plan has been sent for, newest first, for each of these people: two
 * queries for everyone (a few more beyond ninety people), where asking person by person costs two each. People with none are
 * left out. The same rule as `salaryEntries` and the salary log, applied to many people at once.
 */
export async function unplannedSalaryByUser(db: Db, userIds: readonly string[], from: IstDate, today: IstDate): Promise<Map<string, SalaryEntry[]>> {
  const out = new Map<string, SalaryEntry[]>();
  for (let i = 0; i < userIds.length; i += 90) {
    const ids = userIds.slice(i, i + 90);
    const rows = await db
      .select({ id: transactions.id, userId: transactions.userId, amountPaise: transactions.amountPaise, date: transactions.txnDate })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(inArray(transactions.userId, ids), eq(transactions.type, "income"), eq(transactions.status, "confirmed"), isNull(transactions.deletedAt), eq(categories.name, "Salary"), gte(transactions.txnDate, from), lte(transactions.txnDate, today)))
      .orderBy(desc(transactions.txnDate), desc(transactions.createdAt));
    if (rows.length === 0) continue;
    // A transaction belongs to one person, so its id alone says whether a plan was sent for it. Chunked: D1 allows 100 bound variables.
    const seen = new Set<string>();
    for (let j = 0; j < rows.length; j += 90) {
      const done = await db.select({ txnId: salaryLog.txnId }).from(salaryLog).where(inArray(salaryLog.txnId, rows.slice(j, j + 90).map((r) => r.id)));
      for (const d of done) seen.add(d.txnId);
    }
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      const list = out.get(r.userId) ?? [];
      list.push({ id: r.id, amountPaise: r.amountPaise, date: r.date as IstDate });
      out.set(r.userId, list);
    }
  }
  return out;
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
export async function buildSalaryPlan(db: Db, userId: string, today: IstDate, salary: SalaryEntry | null, chat?: { chatId: string; nowMs: number }): Promise<Plan> {
  const [view, goals, offer] = await Promise.all([getCommitments(db, userId, today), listGoals(db, userId, today, "active"), transferOffer(db, userId, today, chat)]);
  const coming = view.items.filter((i) => !i.counted);
  const asks = goalAsks(goals.goals);
  const text = salaryPlanLines({
    salary: salary ? { amountPaise: salary.amountPaise, date: salary.date } : null,
    commitments: { until: view.until, basis: view.basis, items: coming, safeToSpendPaise: view.safeToSpendPaise, freeToSpendPaise: view.freeToSpendPaise, commitmentsPaise: view.commitmentsPaise },
    perDay: perDayPaise(view.freeToSpendPaise, today, view.until),
    goals: asks.map((a) => ({ name: a.name, paise: a.paise })),
  }).join("\n");
  // Paying yourself first: when part of the emergency fund is missing and some money is safe to move, say so.
  const goalButtons = asks.map((a) => [{ text: `Set aside ${formatRupees(a.paise)} for ${a.name}`, data: `g:${a.id}:s:${a.paise}` }]);
  return offer.suggested ? { text: `${text}\n\n${offer.text}`, buttons: [...goalButtons, ...offer.buttons] } : { text, buttons: goalButtons };
}
