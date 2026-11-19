import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { checkinLog, transactions } from "../db/schema";
import { allowance, type PaceView, streak, type StreakView, type WeekView } from "../domain/allowance";
import { addDays, cycleRange, type IstDate } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { getCommitments } from "./commitments";
import { listGoals } from "./goals";
import { MANUAL_SOURCES } from "./habit";
import { listReserves, type ReserveDto } from "./reserves";
import { getSettings } from "./settings";

/** How far back the no-spend streak looks. */
const LOOKBACK_DAYS = 400;

type EntryRow = { date: IstDate; type: string };

/** The streak from the person's own entries and "nothing today" answers over the look-back. */
function buildStreak(entries: readonly EntryRow[], markers: readonly { day: string }[], today: IstDate): { view: StreakView; nothing: Set<IstDate> } {
  const spendDays = new Set<IstDate>();
  const loggedDays = new Set<IstDate>();
  for (const e of entries) {
    loggedDays.add(e.date);
    if (e.type === "expense") spendDays.add(e.date);
  }
  const nothing = new Set(markers.map((m) => m.day as IstDate));
  const known = [...loggedDays, ...nothing].sort();
  return { view: streak({ today, spendDays, nothingDays: nothing, loggedDays, since: known[0] ?? today }), nothing };
}

async function streakRows(db: Db, userId: string, today: IstDate) {
  const lookback = addDays(today, -LOOKBACK_DAYS);
  return Promise.all([
    db
      .select({ date: transactions.txnDate, type: transactions.type, amountPaise: transactions.amountPaise })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"), inArray(transactions.source, [...MANUAL_SOURCES]), gte(transactions.txnDate, lookback))),
    db.select({ day: checkinLog.day }).from(checkinLog).where(and(eq(checkinLog.userId, userId), eq(checkinLog.kind, "none_today"), gte(checkinLog.day, lookback))),
  ]);
}

/** Just the no-spend streak, for a quick reply. */
export async function getStreak(db: Db, userId: string, today: IstDate): Promise<StreakView> {
  const [entries, markers] = await streakRows(db, userId, today);
  return buildStreak(entries, markers, today).view;
}

export interface AllowanceDto {
  /** The period: its first day, and the day it ends before (the next salary, or the next period start). */
  from: IstDate;
  until: IstDate;
  basis: "salary" | "month";
  today: IstDate;
  /** Free to spend: safe-to-spend less what is still to leave before `until`. */
  freeToSpendPaise: number;
  /** Goals' monthly amounts not yet put toward them this period. */
  goalsPaise: number;
  /** "Move first" items not yet moved this period. */
  reservesPaise: number;
  /** What is left to spend after the money that goes out first. */
  flexiblePaise: number;
  week: WeekView | null;
  pace: PaceView | null;
  streak: StreakView;
  /** The person said they have nothing to log today. */
  nothingToday: boolean;
  reserves: ReserveDto[];
}

/**
 * The weekly allowance: free to spend, less this month's goal amounts and the money to move first, cut into weeks that roll over;
 * with how the period's pace stands and the run of days with no everyday spending. Everyday spending is what the person logged
 * themselves as an expense: rules, EMIs and loans are not.
 */
export async function getAllowance(db: Db, userId: string, today: IstDate): Promise<AllowanceDto> {
  const settings = await getSettings(db, userId);
  const from = cycleRange(today, settings.periodStartDay).from;
  const [commitments, goals, reserves, [entries, markers]] = await Promise.all([getCommitments(db, userId, today), listGoals(db, userId, today, "active"), listReserves(db, userId, today), streakRows(db, userId, today)]);

  const goalsPaise = goals.goals.reduce((sum, g) => {
    if (g.monthlyNeededPaise === null) return sum;
    const put = g.contributions.filter((c) => c.date >= from).reduce((s, c) => s + c.amountPaise, 0);
    return sum + Math.max(0, g.monthlyNeededPaise - put);
  }, 0);
  const reservesPaise = reserves.filter((r) => !r.moved).reduce((s, r) => s + r.amountPaise, 0);
  const flexiblePaise = commitments.freeToSpendPaise - goalsPaise - reservesPaise;

  const spentByDay = new Map<IstDate, number>();
  for (const e of entries) {
    if (e.type === "expense" && e.date >= from && e.date <= today) spentByDay.set(e.date, (spentByDay.get(e.date) ?? 0) + e.amountPaise);
  }
  const { view: streakView, nothing } = buildStreak(entries, markers, today);
  const view = allowance({ from, until: commitments.until, today, flexiblePaise, spentByDay });
  return {
    from,
    until: commitments.until,
    basis: commitments.basis,
    today,
    freeToSpendPaise: commitments.freeToSpendPaise,
    goalsPaise,
    reservesPaise,
    flexiblePaise,
    week: view.week,
    pace: view.pace,
    streak: streakView,
    nothingToday: nothing.has(today),
    reserves,
  };
}

/** "Nothing today": no spending to log, which counts the day toward the streak. */
export async function markNothingToday(db: Db, userId: string, today: IstDate): Promise<void> {
  await db.insert(checkinLog).values({ id: newId(), userId, kind: "none_today", day: today, createdAt: nowIso() }).onConflictDoNothing();
}
