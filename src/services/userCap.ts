import type { Db } from "../db/client";
import { pickUsers } from "../domain/userWindow";
import { logger } from "../utils/logger";

/**
 * People per run, per job: the most one scheduled invocation looks after. Workers Free allows 50 D1 queries per invocation,
 * so each cap is set from what a person costs in that job (measured by `test/cronBudget.test.ts`, which fails if a run
 * crosses the budget) so that a whole group of jobs stays under it however many people are invited.
 *
 * What happens to the rest: see `pickUsers`. People left out are first in line again as the window moves on the next day,
 * and each job is written to catch up on its own, as its doc comment says (reminders look ahead several days, an instalment
 * is added once its date has passed, a claimed message is never sent twice). A job logs `<job>_deferred` when it leaves
 * people out, so a cap that is too small shows up in Workers Logs instead of silently dropping anyone.
 */
export const USER_CAP = {
  // Morning run 1 (data): about 5 queries a person for instalments, 10 for recurring rules.
  emi: 2,
  loan: 1,
  statement: 2,
  recurring: 2,
  units: 3,
  // Morning run 2 (reminders and salary plans): a salary plan is about 16 queries, a payment check about 7.
  mandate: 2,
  nudges: 2,
  insurance: 1,
  debt: 1,
  holds: 1,
  salary: 1,
  // Morning run 3 (review and briefing): a monthly review is about 22 queries.
  holdingNudges: 2,
  review: 1,
  push: 2,
  price: 1,
  // Evening run.
  evening: 2,
} as const;

export type CappedJob = keyof typeof USER_CAP;

/**
 * The caps apply only inside `withUserCaps`, which the cron runner opens around every scheduled run. A job called on its own (a test,
 * a script) looks after everyone, as it always did; the Workers Free budget only matters to a scheduled invocation.
 */
const capped = new WeakSet<object>();

export async function withUserCaps<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  capped.add(db);
  try {
    return await fn();
  } finally {
    capped.delete(db);
  }
}

/** The items belonging to the people chosen for `job` today; logs how many people were left for a later run. */
export function takeUsers<T>(db: Db, job: CappedJob, items: readonly T[], userOf: (item: T) => string, today: string, periodDays = 1, cap: number = USER_CAP[job]): T[] {
  if (!capped.has(db)) return [...items];
  const { chosen, deferred } = pickUsers(items.map(userOf), today, cap, periodDays);
  if (deferred > 0) logger.warn(`${job}_deferred`, { deferred, cap, day: today });
  const keep = new Set(chosen);
  return items.filter((item) => keep.has(userOf(item)));
}
