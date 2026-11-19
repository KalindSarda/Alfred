import { addDays, type IstDate } from "./dates";

/**
 * The weekly allowance: what is left to spend after the money that must go out first, cut into weeks of seven days from the start of
 * the period (the last one shorter). Unspent money stays in the pool and so rolls into the later weeks; overspending shrinks them.
 * Pure rules; where the figures come from is the allowance service.
 */

const days = (from: IstDate, to: IstDate): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface AllowanceInput {
  /** The first day of the period, and the day it ends before (the next salary, or the next period start). */
  from: IstDate;
  until: IstDate;
  today: IstDate;
  /** What is left to spend today, after everything that must go out first. May be negative. */
  flexiblePaise: number;
  /** Everyday spending made on each day since `from` (days with none are simply missing). */
  spentByDay: ReadonlyMap<IstDate, number>;
}

export interface WeekView {
  /** 1-based, of how many weeks the period has. */
  index: number;
  of: number;
  from: IstDate;
  /** The last day of the week. */
  to: IstDate;
  budgetPaise: number;
  spentPaise: number;
  leftPaise: number;
  /** How far past the week's budget the spending already is. */
  overPaise: number;
  /** What is left spread over the days of the week that remain, today included. */
  perDayPaise: number;
  daysLeft: number;
  /** What the next week would be if this week's remaining budget were all spent; null in the last week. */
  nextWeekPaise: number | null;
}

export interface PaceView {
  /** Spending so far in the period. */
  spentPaise: number;
  /** What an even spread of the period's flexible money would have allowed by now. */
  expectedPaise: number;
  /** Positive: under the pace. Negative: over it. */
  aheadPaise: number;
}

export interface AllowanceView {
  week: WeekView | null;
  pace: PaceView | null;
}

const spentBetween = (spent: ReadonlyMap<IstDate, number>, from: IstDate, to: IstDate): number => {
  let total = 0;
  for (const [day, paise] of spent) if (day >= from && day <= to) total += paise;
  return total;
};

export function allowance(input: AllowanceInput): AllowanceView {
  const { from, until, today, flexiblePaise, spentByDay } = input;
  const total = days(from, until);
  if (total < 1 || today < from || today >= until) return { week: null, pace: null };

  const elapsed = days(from, today);
  const weeks = Math.ceil(total / 7);
  const index = Math.floor(elapsed / 7);
  const weekFrom = addDays(from, index * 7);
  const weekEnd = addDays(from, Math.min(total, index * 7 + 7)); // exclusive
  const daysInWeek = days(weekFrom, weekEnd);
  const daysLeftInPeriodFromWeek = days(weekFrom, until);
  const spentWeek = spentBetween(spentByDay, weekFrom, today);

  // The money at the start of the week is what is left now plus what the week has already spent.
  const atWeekStart = Math.max(0, flexiblePaise + spentWeek);
  const budget = Math.floor((atWeekStart * daysInWeek) / daysLeftInPeriodFromWeek);
  const left = Math.max(0, budget - spentWeek);
  const daysLeft = days(today, weekEnd);

  const daysAfter = days(weekEnd, until);
  const nextDays = Math.min(7, daysAfter);
  const next = daysAfter > 0 ? Math.floor((Math.max(0, flexiblePaise - left) * nextDays) / daysAfter) : null;

  const spentSoFar = spentBetween(spentByDay, from, today);
  const poolAtStart = flexiblePaise + spentSoFar;
  const pace: PaceView | null = poolAtStart > 0 ? (() => {
    const expected = Math.floor((poolAtStart * (elapsed + 1)) / total);
    return { spentPaise: spentSoFar, expectedPaise: expected, aheadPaise: expected - spentSoFar };
  })() : null;

  return {
    week: { index: index + 1, of: weeks, from: weekFrom, to: addDays(weekEnd, -1), budgetPaise: budget, spentPaise: spentWeek, leftPaise: left, overPaise: Math.max(0, spentWeek - budget), perDayPaise: daysLeft > 0 ? Math.floor(left / daysLeft) : 0, daysLeft, nextWeekPaise: next },
    pace,
  };
}

export interface StreakInput {
  today: IstDate;
  /** Days with everyday spending. */
  spendDays: ReadonlySet<IstDate>;
  /** Days the person said they had nothing to log ("Nothing today"). */
  nothingDays: ReadonlySet<IstDate>;
  /** Days the person logged something of any kind. */
  loggedDays: ReadonlySet<IstDate>;
  /** The first day that can count: before it nothing is known. */
  since: IstDate;
}

export interface StreakView {
  /** Days in a row with no everyday spending, through yesterday, plus today when today already qualifies. */
  current: number;
  best: number;
  /** Today qualifies so far (it can still be broken by a spend). */
  todayCounts: boolean;
}

/** A day counts when nothing everyday was spent and the person said so: "nothing today", or they logged something else that day. */
export const isNoSpendDay = (day: IstDate, i: Pick<StreakInput, "spendDays" | "nothingDays" | "loggedDays">): boolean => !i.spendDays.has(day) && (i.nothingDays.has(day) || i.loggedDays.has(day));

export function streak(i: StreakInput): StreakView {
  let best = 0;
  let run = 0;
  let current = 0;
  const lastDay = i.today;
  for (let d = i.since; d <= lastDay; d = addDays(d, 1)) {
    if (isNoSpendDay(d, i)) {
      run += 1;
      if (run > best) best = run;
    } else {
      // Today is still open: nothing said yet is not a break, but a spend is.
      if (d === lastDay) {
        current = i.spendDays.has(d) ? 0 : run;
        run = 0;
        continue;
      }
      run = 0;
    }
    if (d === lastDay) current = run;
  }
  const todayCounts = isNoSpendDay(i.today, i);
  return { current, best, todayCounts };
}
