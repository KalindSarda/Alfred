/**
 * Which people a scheduled job looks after on a given day, when it cannot look after everyone in one run.
 *
 * Workers Free allows 50 D1 queries per invocation, and every person costs a handful of queries per job, so each job has a
 * cap on people per run (see `USER_CAP` in `src/services/cronPlan.ts`). People are put in a fixed order (by id) and the cap
 * is a window that moves along that order a window at a time each day: day N takes people [N*cap, N*cap + cap) counting
 * round the ring. So nobody is skipped for good, whoever is left out today is in the next window, and with `n` people
 * everyone has had a turn within `ceil(n / cap)` days. No state is stored: the day is the cursor.
 *
 * Pure: no clock, no database.
 */

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for an IST calendar date (YYYY-MM-DD). */
export function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

export interface Window {
  /** The people to look after in this run, in order. */
  chosen: string[];
  /** How many people were left for a later run. */
  deferred: number;
}

/**
 * Up to `cap` of `userIds` for `day`; everyone when there are no more than `cap`. `periodDays` is how often the job runs (1 for
 * a daily job, 7 for a weekly one), so that the window moves one step each time the job runs rather than each day.
 */
export function pickUsers(userIds: readonly string[], day: string, cap: number, periodDays = 1): Window {
  const ids = [...new Set(userIds)].sort();
  if (cap < 1) return { chosen: [], deferred: ids.length };
  if (ids.length <= cap) return { chosen: ids, deferred: 0 };
  const start = (Math.floor(dayNumber(day) / periodDays) * cap) % ids.length;
  const chosen: string[] = [];
  for (let i = 0; i < cap; i++) chosen.push(ids[(start + i) % ids.length] as string);
  return { chosen, deferred: ids.length - cap };
}
