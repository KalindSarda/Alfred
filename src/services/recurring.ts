import { and, count, eq, isNull } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getHoldingRow } from "../db/holdings";
import { getAccount } from "../db/accounts";
import { getCategory } from "../db/categories";
import { getRuleRow, parseSkips, type RuleRow, toRuleShape } from "../db/recurring";
import { accounts, categories, recurringRules, transactions } from "../db/schema";
import { addDays, type IstDate, isValidIstDate, toIstDate } from "../domain/dates";
import { occurrencesBetween, repeatLabel, ruleDayIsValid } from "../domain/recurring";
import type { CreateRecurringData, UpdateRecurringData } from "../schemas/recurring";
import { newId, nowIso } from "../utils/id";

/** A rule that starts long ago adds only its latest this many missed entries, so one rule never floods the ledger. */
export const MAX_BACKFILL = 36;

export interface RecurringDto {
  id: string;
  title: string;
  type: "expense" | "income" | "investment";
  amountPaise: number;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  /** The holding a SIP adds to, if any. */
  holdingId: string | null;
  frequency: "weekly" | "monthly" | "yearly";
  day: number;
  month: number | null;
  /** "Every month on the 5th". */
  repeat: string;
  startDate: IstDate;
  endDate: IstDate | null;
  mode: "auto" | "draft";
  remindDaysBefore: number | null;
  status: "active" | "paused" | "ended";
  /** The next due date that has no entry yet, or null once the rule has ended. */
  nextDate: IstDate | null;
  /** The next three, for showing what the rule will do. */
  upcoming: IstDate[];
  /** Entries this rule has added so far. */
  entries: number;
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

async function madeDates(db: Db, userId: string, ruleId: string): Promise<Set<string>> {
  const rows = await db
    .select({ on: transactions.recurringOn })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.recurringRuleId, ruleId)));
  return new Set(rows.flatMap((r) => (r.on ? [r.on] : [])));
}

/** Due dates from today on that have no entry yet. */
function upcomingFor(row: RuleRow, made: Set<string>, today: IstDate, count: number): IstDate[] {
  const out: IstDate[] = [];
  let from = today;
  // A year at a time, so a weekly rule is not asked for ten years of dates.
  for (let step = 0; step < 6 && out.length < count; step++) {
    for (const d of occurrencesBetween(toRuleShape(row), from, addDays(from, 400))) {
      if (!made.has(d) && out.length < count) out.push(d);
    }
    from = addDays(from, 401);
  }
  return out;
}

/**
 * Every due date from `from` up to, not including, `to` that has no entry yet, for each running rule that spends or invests.
 * Skipped dates and paused rules are left out. Income rules are not commitments.
 */
export async function outflowOccurrences(
  db: Db,
  userId: string,
  from: IstDate,
  to: IstDate,
): Promise<{ id: string; title: string; amountPaise: number; accountId: string; accountName: string; dates: IstDate[] }[]> {
  const [rows, made] = await Promise.all([
    db
      .select({ rule: recurringRules, accountName: accounts.name })
      .from(recurringRules)
      .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
      .where(and(eq(recurringRules.userId, userId), isNull(recurringRules.pausedAt))),
    db
      .select({ ruleId: transactions.recurringRuleId, on: transactions.recurringOn })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.source, "recurring"))),
  ]);
  const byRule = new Map<string, Set<string>>();
  for (const m of made) if (m.ruleId && m.on) (byRule.get(m.ruleId) ?? byRule.set(m.ruleId, new Set()).get(m.ruleId)!).add(m.on);
  return rows
    .filter((r) => r.rule.type !== "income")
    .map((r) => {
      const done = byRule.get(r.rule.id) ?? new Set<string>();
      const dates = occurrencesBetween(toRuleShape(r.rule), from, addDays(to, -1)).filter((d) => !done.has(d));
      return { id: r.rule.id, title: r.rule.title, amountPaise: r.rule.amountPaise, accountId: r.rule.accountId, accountName: r.accountName, dates };
    })
    .filter((r) => r.dates.length > 0);
}

/** The next due date that has no entry yet, or null. */
export async function nextDue(db: Db, row: RuleRow, today: IstDate): Promise<IstDate | null> {
  return upcomingFor(row, await madeDates(db, row.userId, row.id), today, 1)[0] ?? null;
}

function toDto(row: RuleRow, accountName: string, categoryName: string | null, made: Set<string>, today: IstDate): RecurringDto {
  const upcoming = upcomingFor(row, made, today, 3);
  const nextDate = upcoming[0] ?? null;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    amountPaise: row.amountPaise,
    accountId: row.accountId,
    accountName,
    categoryId: row.categoryId,
    categoryName,
    holdingId: row.holdingId,
    frequency: row.frequency,
    day: row.day,
    month: row.month,
    repeat: repeatLabel(row),
    startDate: row.startDate,
    endDate: row.endDate,
    mode: row.mode,
    remindDaysBefore: row.remindDaysBefore,
    status: row.pausedAt ? "paused" : nextDate === null ? "ended" : "active",
    nextDate,
    upcoming,
    entries: made.size,
  };
}

/** Running rules first, soonest due first; then paused; then ended. */
export async function listRules(db: Db, userId: string, today: IstDate): Promise<RecurringDto[]> {
  const [rows, made] = await Promise.all([
    db
      .select({ rule: recurringRules, accountName: accounts.name, categoryName: categories.name })
      .from(recurringRules)
      .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
      .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
      .where(eq(recurringRules.userId, userId)),
    db
      .select({ ruleId: transactions.recurringRuleId, on: transactions.recurringOn })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.source, "recurring"))),
  ]);
  const byRule = new Map<string, Set<string>>();
  for (const m of made) if (m.ruleId && m.on) (byRule.get(m.ruleId) ?? byRule.set(m.ruleId, new Set()).get(m.ruleId)!).add(m.on);
  const rank = { active: 0, paused: 1, ended: 2 } as const;
  return rows
    .map((r) => toDto(r.rule, r.accountName, r.categoryName, byRule.get(r.rule.id) ?? new Set(), today))
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.title.localeCompare(b.title));
}

async function dtoFor(db: Db, userId: string, id: string, today: IstDate): Promise<RecurringDto> {
  const found = (await listRules(db, userId, today)).find((r) => r.id === id);
  if (!found) throw new NotFoundError("Recurring entry not found");
  return found;
}

async function checkReferences(db: Db, userId: string, rule: { type: RuleRow["type"]; accountId: string; categoryId: string | null; holdingId?: string | null }) {
  const account = await getAccount(db, userId, rule.accountId);
  if (!account) throw new NotFoundError("Account not found");
  if (account.archivedAt) throw invalid("accountId", "That account is archived");
  if (rule.type === "investment" && account.kind !== "bank") throw invalid("accountId", "An investment is paid from a bank account");
  if (rule.type === "investment" && rule.categoryId) throw invalid("categoryId", "Investments have no category");
  if (rule.holdingId) {
    if (rule.type !== "investment") throw invalid("holdingId", "Only an investment can add to a holding");
    const holding = await getHoldingRow(db, userId, rule.holdingId);
    if (!holding) throw new NotFoundError("Holding not found");
    if (holding.status !== "active") throw invalid("holdingId", "That holding is closed");
  }
  if (rule.categoryId) {
    const category = await getCategory(db, userId, rule.categoryId);
    if (!category) throw new NotFoundError("Category not found");
    if (category.archivedAt) throw invalid("categoryId", "That category is archived");
    if (category.kind !== rule.type) throw invalid("categoryId", `A ${category.kind} category cannot be used on ${rule.type === "income" ? "income" : "an expense"}`);
  }
}

function checkSchedule(r: { frequency: RuleRow["frequency"]; day: number; month: number | null; startDate: string; endDate: string | null }) {
  if (!ruleDayIsValid(r.frequency, r.day, r.month)) {
    throw invalid("day", r.frequency === "yearly" ? "Choose a month and a day that exist" : r.frequency === "weekly" ? "Choose a weekday from 1 (Monday) to 7 (Sunday)" : "Choose a day from 1 to 31");
  }
  if (!isValidIstDate(r.startDate)) throw invalid("startDate", "Not a real calendar date");
  if (r.endDate !== null && !isValidIstDate(r.endDate)) throw invalid("endDate", "Not a real calendar date");
  if (r.endDate !== null && r.endDate < r.startDate) throw invalid("endDate", "The end cannot be before the start");
}

/**
 * Adds, as entries on the account, every due date up to today that has none yet: confirmed for "auto" rules, as drafts
 * for "draft" rules. Safe to run as often as you like: a due date gets one entry, and a deleted one is not brought back.
 * Returns what was added.
 */
async function materializeRule(db: Db, row: RuleRow, today: IstDate): Promise<{ id: string; date: IstDate }[]> {
  if (row.pausedAt) return [];
  const made = await madeDates(db, row.userId, row.id);
  const missing = occurrencesBetween(toRuleShape(row), row.startDate, today).filter((d) => !made.has(d)).slice(-MAX_BACKFILL);
  if (missing.length === 0) return [];
  const now = nowIso();
  const rows = missing.map((date) => ({
    id: newId(),
    userId: row.userId,
    type: row.type,
    amountPaise: row.amountPaise,
    txnDate: date,
    accountId: row.accountId,
    toAccountId: null,
    categoryId: row.categoryId,
    holdingId: row.holdingId,
    merchant: row.title,
    note: row.mode === "draft" ? "Recurring: please confirm the amount" : "Recurring",
    status: row.mode === "draft" ? ("draft" as const) : ("confirmed" as const),
    source: "recurring" as const,
    recurringRuleId: row.id,
    recurringOn: date,
    createdAt: now,
    updatedAt: now,
  }));
  const added: { id: string; date: IstDate }[] = [];
  // D1 allows 100 bound variables a statement, so insert a few rows at a time.
  for (let i = 0; i < rows.length; i += 4) {
    const made = await db.insert(transactions).values(rows.slice(i, i + 4)).onConflictDoNothing().returning({ id: transactions.id, date: transactions.txnDate });
    added.push(...made);
  }
  return added;
}

export async function createRule(db: Db, userId: string, input: CreateRecurringData, today: IstDate): Promise<RecurringDto> {
  const rule = {
    frequency: input.frequency,
    day: input.day,
    month: input.frequency === "yearly" ? (input.month ?? null) : null,
    startDate: input.startDate ?? today,
    endDate: input.endDate ?? null,
  };
  checkSchedule(rule);
  await checkReferences(db, userId, { type: input.type, accountId: input.accountId, categoryId: input.categoryId ?? null, holdingId: input.holdingId ?? null });

  const id = newId();
  await db.insert(recurringRules).values({
    id,
    userId,
    title: input.title,
    type: input.type,
    amountPaise: input.amountPaise,
    accountId: input.accountId,
    categoryId: input.type === "investment" ? null : (input.categoryId ?? null),
    holdingId: input.type === "investment" ? (input.holdingId ?? null) : null,
    ...rule,
    mode: input.mode,
    remindDaysBefore: input.remindDaysBefore ?? null,
    createdAt: nowIso(),
  });
  const row = (await getRuleRow(db, userId, id))!;
  await materializeRule(db, row, today);
  return dtoFor(db, userId, id, today);
}

/**
 * Changes a rule. Entries already made stay as they are; the new amount, account, category and mode apply to the next ones.
 * Changing how it repeats starts the new pattern from today, so it cannot re-create what already exists.
 */
export async function updateRule(db: Db, userId: string, id: string, patch: UpdateRecurringData, today: IstDate): Promise<RecurringDto> {
  const row = await getRuleRow(db, userId, id);
  if (!row) throw new NotFoundError("Recurring entry not found");

  const patternChanged = patch.frequency !== undefined || patch.day !== undefined || patch.month !== undefined;
  const frequency = patch.frequency ?? row.frequency;
  const next = {
    frequency,
    day: patch.day ?? row.day,
    month: frequency === "yearly" ? (patch.month === undefined ? row.month : patch.month) : null,
    startDate: patch.startDate ?? (patternChanged ? today : row.startDate),
    endDate: patch.endDate === undefined ? row.endDate : patch.endDate,
  };
  checkSchedule(next);
  const accountId = patch.accountId ?? row.accountId;
  const categoryId = patch.categoryId === undefined ? row.categoryId : patch.categoryId;
  const holdingId = patch.holdingId === undefined ? row.holdingId : patch.holdingId;
  await checkReferences(db, userId, { type: row.type, accountId, categoryId, holdingId });

  await db
    .update(recurringRules)
    .set({
      title: patch.title ?? row.title,
      amountPaise: patch.amountPaise ?? row.amountPaise,
      accountId,
      categoryId,
      holdingId,
      ...next,
      mode: patch.mode ?? row.mode,
      remindDaysBefore: patch.remindDaysBefore === undefined ? row.remindDaysBefore : patch.remindDaysBefore,
    })
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
  await materializeRule(db, (await getRuleRow(db, userId, id))!, today);
  return dtoFor(db, userId, id, today);
}

export async function pauseRule(db: Db, userId: string, id: string, today: IstDate): Promise<RecurringDto> {
  const row = await getRuleRow(db, userId, id);
  if (!row) throw new NotFoundError("Recurring entry not found");
  if (row.pausedAt) throw new ConflictError("That one is already paused");
  await db.update(recurringRules).set({ pausedAt: nowIso() }).where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
  return dtoFor(db, userId, id, today);
}

/** Resumes a paused rule. The due dates that fell during the pause are skipped, not added afterwards. */
export async function resumeRule(db: Db, userId: string, id: string, today: IstDate): Promise<RecurringDto> {
  const row = await getRuleRow(db, userId, id);
  if (!row) throw new NotFoundError("Recurring entry not found");
  if (!row.pausedAt) throw new ConflictError("That one is not paused");
  const pausedOn = toIstDate(new Date(row.pausedAt));
  const missed = pausedOn < today ? occurrencesBetween(toRuleShape(row), pausedOn, addDays(today, -1)) : [];
  const made = await madeDates(db, userId, id);
  const skips = [...new Set([...parseSkips(row.skipsJson), ...missed.filter((d) => !made.has(d))])].sort();
  await db
    .update(recurringRules)
    .set({ pausedAt: null, skipsJson: skips.length ? JSON.stringify(skips) : null })
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
  await materializeRule(db, (await getRuleRow(db, userId, id))!, today);
  return dtoFor(db, userId, id, today);
}

/** Skips the next due date, once, without changing the rule. */
export async function skipNext(db: Db, userId: string, id: string, today: IstDate): Promise<RecurringDto> {
  const row = await getRuleRow(db, userId, id);
  if (!row) throw new NotFoundError("Recurring entry not found");
  const made = await madeDates(db, userId, id);
  const next = upcomingFor(row, made, today, 1)[0];
  if (!next) throw new ConflictError("There is nothing left to skip");
  const skips = [...new Set([...parseSkips(row.skipsJson), next])].sort();
  await db.update(recurringRules).set({ skipsJson: JSON.stringify(skips) }).where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
  return dtoFor(db, userId, id, today);
}

/** Removes the rule. Entries it already made stay in the ledger. */
export async function deleteRule(db: Db, userId: string, id: string): Promise<void> {
  if (!(await getRuleRow(db, userId, id))) throw new NotFoundError("Recurring entry not found");
  await db.delete(recurringRules).where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id)));
}

export interface NewDraft {
  userId: string;
  txnId: string;
  date: IstDate;
  title: string;
  amountPaise: number;
  accountName: string;
}

/** One person's rules: adds what has come due. Returns the drafts that now wait for a confirmation. */
export async function materializeRules(db: Db, userId: string, today: IstDate): Promise<{ added: number; drafts: NewDraft[] }> {
  const rows = await db
    .select({ rule: recurringRules, accountName: accounts.name })
    .from(recurringRules)
    .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .where(and(eq(recurringRules.userId, userId), isNull(recurringRules.pausedAt)));
  let added = 0;
  const drafts: NewDraft[] = [];
  for (const { rule, accountName } of rows) {
    const made = await materializeRule(db, rule, today);
    added += made.length;
    if (rule.mode === "draft") {
      for (const m of made) drafts.push({ userId, txnId: m.id, date: m.date, title: rule.title, amountPaise: rule.amountPaise, accountName });
    }
  }
  return { added, drafts };
}

/** The daily job: everyone's rules. One person failing does not stop the rest. */
export async function materializeAllRules(db: Db, today: IstDate, onError: (error: unknown) => void = () => undefined): Promise<{ added: number; drafts: NewDraft[] }> {
  const owners = await db.selectDistinct({ userId: recurringRules.userId }).from(recurringRules).where(isNull(recurringRules.pausedAt));
  let added = 0;
  const drafts: NewDraft[] = [];
  for (const { userId } of owners) {
    try {
      const r = await materializeRules(db, userId, today);
      added += r.added;
      drafts.push(...r.drafts);
    } catch (error) {
      onError(error);
    }
  }
  return { added, drafts };
}

/** Rules that start on an account, for refusing to delete, archive or empty it. */
export async function rulesOnAccount(db: Db, userId: string, accountId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(recurringRules).where(and(eq(recurringRules.userId, userId), eq(recurringRules.accountId, accountId)));
  return row?.n ?? 0;
}
