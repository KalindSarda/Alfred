import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getGoalRow, type GoalRow, savedByGoal } from "../db/goals";
import { goalContributions, goals } from "../db/schema";
import { type IstDate, isValidIstDate } from "../domain/dates";
import { monthlyNeededPaise, needsAttention, progressPct, remainingPaise } from "../domain/goals";
import type { AddContributionData, CreateGoalData, UpdateGoalData } from "../schemas/goal";
import { newId, nowIso } from "../utils/id";

export interface ContributionDto {
  id: string;
  amountPaise: number;
  date: IstDate;
  note: string | null;
}

export interface GoalDto {
  id: string;
  name: string;
  targetPaise: number;
  targetDate: IstDate | null;
  status: "active" | "achieved" | "archived";
  savedPaise: number;
  remainingPaise: number;
  progressPct: number;
  /** What to put aside each month to make the date; null with no date or once reached. */
  monthlyNeededPaise: number | null;
  /** Not reached, and the date is within 30 days or has passed. */
  needsAttention: boolean;
  achievedAt: string | null;
  contributions: ContributionDto[];
}

export interface GoalsOverview {
  /** Saved across active goals: taken off safe-to-spend. */
  setAsidePaise: number;
  goals: GoalDto[];
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);
const keyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

function checkDate(path: string, date: string) {
  if (!isValidIstDate(date)) throw invalid(path, "Not a real calendar date");
}

function toDto(row: GoalRow, saved: number, contributions: ContributionDto[], today: IstDate): GoalDto {
  return {
    id: row.id,
    name: row.name,
    targetPaise: row.targetPaise,
    targetDate: row.targetDate,
    status: row.status,
    savedPaise: saved,
    remainingPaise: remainingPaise(saved, row.targetPaise),
    progressPct: progressPct(saved, row.targetPaise),
    monthlyNeededPaise: row.status === "active" ? monthlyNeededPaise(saved, row.targetPaise, row.targetDate, today) : null,
    needsAttention: row.status === "active" && needsAttention(saved, row.targetPaise, row.targetDate, today),
    achievedAt: row.achievedAt,
    contributions,
  };
}

/** Active goals first (soonest date, then name), then achieved and archived ones when asked for. */
export async function listGoals(db: Db, userId: string, today: IstDate, status: "active" | "all"): Promise<GoalsOverview> {
  const [rows, saved, contribs] = await Promise.all([
    db.select().from(goals).where(status === "active" ? and(eq(goals.userId, userId), eq(goals.status, "active")) : eq(goals.userId, userId)),
    savedByGoal(db, userId),
    db.select().from(goalContributions).where(eq(goalContributions.userId, userId)),
  ]);
  const byGoal = new Map<string, ContributionDto[]>();
  for (const c of [...contribs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))) {
    const list = byGoal.get(c.goalId) ?? [];
    list.push({ id: c.id, amountPaise: c.amountPaise, date: c.date, note: c.note });
    byGoal.set(c.goalId, list);
  }
  const rank = { active: 0, achieved: 1, archived: 2 } as const;
  const dtos = rows
    .map((r) => toDto(r, saved.get(r.id) ?? 0, byGoal.get(r.id) ?? [], today))
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31") ||
        a.name.localeCompare(b.name),
    );
  return { setAsidePaise: dtos.filter((g) => g.status === "active").reduce((s, g) => s + g.savedPaise, 0), goals: dtos };
}

export async function getGoal(db: Db, userId: string, id: string, today: IstDate): Promise<GoalDto> {
  const found = (await listGoals(db, userId, today, "all")).goals.find((g) => g.id === id);
  if (!found) throw new NotFoundError("Goal not found");
  return found;
}

async function requireOpen(db: Db, userId: string, id: string): Promise<GoalRow> {
  const row = await getGoalRow(db, userId, id);
  if (!row) throw new NotFoundError("Goal not found");
  if (row.status !== "active") throw new ConflictError("That goal is closed");
  return row;
}

async function requireFreeName(db: Db, userId: string, name: string, exceptId?: string) {
  const key = keyOf(name);
  const active = await db.select({ id: goals.id, name: goals.name }).from(goals).where(and(eq(goals.userId, userId), eq(goals.status, "active")));
  if (active.some((g) => g.id !== exceptId && keyOf(g.name) === key)) throw invalid("name", "You already have a goal with that name");
}

export async function createGoal(db: Db, userId: string, input: CreateGoalData, today: IstDate): Promise<GoalDto> {
  if (input.targetDate) checkDate("targetDate", input.targetDate);
  await requireFreeName(db, userId, input.name);
  const id = newId();
  await db.insert(goals).values({ id, userId, name: tidy(input.name), targetPaise: input.targetPaise, targetDate: input.targetDate ?? null, createdAt: nowIso() });
  return getGoal(db, userId, id, today);
}

export async function updateGoal(db: Db, userId: string, id: string, patch: UpdateGoalData, today: IstDate): Promise<GoalDto> {
  const row = await requireOpen(db, userId, id);
  if (patch.targetDate) checkDate("targetDate", patch.targetDate);
  if (patch.name !== undefined) await requireFreeName(db, userId, patch.name, id);
  await db
    .update(goals)
    .set({
      name: patch.name === undefined ? row.name : tidy(patch.name),
      targetPaise: patch.targetPaise ?? row.targetPaise,
      targetDate: patch.targetDate === undefined ? row.targetDate : patch.targetDate,
    })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)));
  return getGoal(db, userId, id, today);
}

/** Puts money toward a goal, or takes it back out (negative, never more than is saved). */
export async function addContribution(db: Db, userId: string, goalId: string, input: AddContributionData, today: IstDate): Promise<GoalDto> {
  await requireOpen(db, userId, goalId);
  const date = input.date ?? today;
  checkDate("date", date);
  if (date > today) throw invalid("date", "That date is in the future");
  const saved = (await savedByGoal(db, userId)).get(goalId) ?? 0;
  if (saved + input.amountPaise < 0) throw invalid("amountPaise", "That is more than has been put toward this goal");
  await db.insert(goalContributions).values({ id: newId(), userId, goalId, amountPaise: input.amountPaise, date, note: input.note ?? null, createdAt: nowIso() });
  return getGoal(db, userId, goalId, today);
}

export async function removeContribution(db: Db, userId: string, goalId: string, contributionId: string, today: IstDate): Promise<GoalDto> {
  await requireOpen(db, userId, goalId);
  const [row] = await db
    .select()
    .from(goalContributions)
    .where(and(eq(goalContributions.id, contributionId), eq(goalContributions.goalId, goalId), eq(goalContributions.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError("Entry not found");
  const saved = (await savedByGoal(db, userId)).get(goalId) ?? 0;
  if (saved - row.amountPaise < 0) throw new ConflictError("Removing that would leave less than nothing saved; remove the later withdrawal first");
  await db.delete(goalContributions).where(eq(goalContributions.id, contributionId));
  return getGoal(db, userId, goalId, today);
}

/** The goal is reached (or the money was spent on it): what was set aside is released. No bank entry is made. */
export async function markAchieved(db: Db, userId: string, id: string, today: IstDate): Promise<GoalDto> {
  await requireOpen(db, userId, id);
  await db.update(goals).set({ status: "achieved", achievedAt: nowIso() }).where(and(eq(goals.id, id), eq(goals.userId, userId)));
  return getGoal(db, userId, id, today);
}

/** Drops the goal without achieving it; its set-aside is released too. */
export async function archiveGoal(db: Db, userId: string, id: string, today: IstDate): Promise<GoalDto> {
  await requireOpen(db, userId, id);
  await db.update(goals).set({ status: "archived" }).where(and(eq(goals.id, id), eq(goals.userId, userId)));
  return getGoal(db, userId, id, today);
}

/** A goal with no money put toward it can be removed outright; otherwise archive it. */
export async function deleteGoal(db: Db, userId: string, id: string): Promise<void> {
  const row = await getGoalRow(db, userId, id);
  if (!row) throw new NotFoundError("Goal not found");
  const [counted] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(goalContributions)
    .where(and(eq(goalContributions.goalId, id), eq(goalContributions.userId, userId)));
  if (Number(counted?.n ?? 0) > 0) throw new ConflictError("This goal has money put toward it; archive it instead");
  await db.batch([db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)))] as [BatchItem<"sqlite">]);
}
