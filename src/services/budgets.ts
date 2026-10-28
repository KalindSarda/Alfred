import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getCategory } from "../db/categories";
import { budgets, categories, transactions } from "../db/schema";
import { cycleRange, type DateRange, type IstDate } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { getSettings } from "./settings";

export type BudgetStatus = "ok" | "near" | "over";

/** From this share of the limit onward a budget is "near". */
export const NEAR_THRESHOLD = 0.8;

export interface BudgetDto {
  categoryId: string;
  categoryName: string;
  limitPaise: number;
  /** Confirmed expenses in this category during the current month. */
  spentPaise: number;
  /** Limit minus spent; negative once over. */
  remainingPaise: number;
  /** Share of the limit spent, one decimal. */
  pct: number;
  status: BudgetStatus;
}

export interface BudgetsOverview {
  period: DateRange;
  totalLimitPaise: number;
  totalSpentPaise: number;
  items: BudgetDto[];
}

export function statusOf(spentPaise: number, limitPaise: number): BudgetStatus {
  if (spentPaise > limitPaise) return "over";
  return spentPaise >= limitPaise * NEAR_THRESHOLD ? "near" : "ok";
}

const toDto = (categoryId: string, categoryName: string, limitPaise: number, spentPaise: number): BudgetDto => ({
  categoryId,
  categoryName,
  limitPaise,
  spentPaise,
  remainingPaise: limitPaise - spentPaise,
  pct: Math.round((spentPaise / limitPaise) * 1000) / 10,
  status: statusOf(spentPaise, limitPaise),
});

async function spentByCategory(db: Db, userId: string, range: DateRange, categoryIds: string[]): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await db
    .select({ categoryId: transactions.categoryId, total: sql<number>`COALESCE(SUM(${transactions.amountPaise}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.type, "expense"),
        eq(transactions.status, "confirmed"),
        isNull(transactions.deletedAt),
        inArray(transactions.categoryId, categoryIds),
        sql`${transactions.txnDate} >= ${range.from}`,
        sql`${transactions.txnDate} <= ${range.to}`,
      ),
    )
    .groupBy(transactions.categoryId);
  return new Map(rows.flatMap((r) => (r.categoryId ? [[r.categoryId, Number(r.total)] as const] : [])));
}

/** Every budget with how much of it this month has used, most pressed first. */
export async function listBudgets(db: Db, userId: string, today: IstDate): Promise<BudgetsOverview> {
  const { periodStartDay } = await getSettings(db, userId);
  const period = cycleRange(today, periodStartDay);

  const rows = await db
    .select({ categoryId: budgets.categoryId, limitPaise: budgets.limitPaise, name: categories.name })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(eq(budgets.userId, userId));

  const spent = await spentByCategory(db, userId, period, rows.map((r) => r.categoryId));
  const items = rows
    .map((r) => toDto(r.categoryId, r.name, r.limitPaise, spent.get(r.categoryId) ?? 0))
    .sort((a, b) => b.pct - a.pct || a.categoryName.localeCompare(b.categoryName));

  return {
    period,
    totalLimitPaise: items.reduce((s, i) => s + i.limitPaise, 0),
    totalSpentPaise: items.reduce((s, i) => s + i.spentPaise, 0),
    items,
  };
}

/** The budget for one category, or null when it has none. Used to say "₹3,250 remaining" after a spend. */
export async function budgetFor(db: Db, userId: string, categoryId: string, today: IstDate): Promise<BudgetDto | null> {
  const overview = await listBudgets(db, userId, today);
  return overview.items.find((i) => i.categoryId === categoryId) ?? null;
}

/** Creates or changes the monthly limit for an expense category. */
export async function setBudget(db: Db, userId: string, categoryId: string, limitPaise: number): Promise<void> {
  if (!Number.isSafeInteger(limitPaise) || limitPaise <= 0) {
    throw new ValidationError("Request validation failed", [{ path: "limitPaise", message: "Must be a whole number of paise above zero" }]);
  }
  const category = await getCategory(db, userId, categoryId);
  if (!category) throw new NotFoundError("Category not found");
  if (category.kind !== "expense") {
    throw new ValidationError("Request validation failed", [{ path: "categoryId", message: "Budgets are for expense categories" }]);
  }
  if (category.archivedAt) {
    throw new ValidationError("Request validation failed", [{ path: "categoryId", message: "That category is archived" }]);
  }
  const now = nowIso();
  await db
    .insert(budgets)
    .values({ id: newId(), userId, categoryId, limitPaise, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [budgets.userId, budgets.categoryId], set: { limitPaise, updatedAt: now } });
}

export async function deleteBudget(db: Db, userId: string, categoryId: string): Promise<void> {
  const removed = await db
    .delete(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.categoryId, categoryId)))
    .returning({ id: budgets.id });
  if (removed.length === 0) throw new NotFoundError("No budget for that category");
}
