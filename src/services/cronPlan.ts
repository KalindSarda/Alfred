import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { withReadCache } from "../db/readCache";
import { runDebtReminders } from "./debtJob";
import { runEmiCheckIns } from "./emiJob";
import { EVENING_CRON, runEveningCheckIns } from "./habitJob";
import { runHoldingNudges, runUnitsCheckIns } from "./holdingsJob";
import { runInsuranceReminders } from "./insuranceJob";
import { runLoanCheckIns } from "./loanJob";
import { runMaintenance } from "./maintenance";
import { runMandateChecks } from "./mandateJob";
import { runHoldReminders, runNudges } from "./nudges";
import { runMorningPush, runSalaryPlans } from "./planJob";
import { runPriceRefresh } from "./priceJob";
import { runMonthlyReview } from "./reviewJob";
import { runRecurring } from "./recurringJob";
import { runStatementChecks } from "./statementJob";
import type { FetchFn } from "./prices/feeds";
import { logger } from "../utils/logger";
import { withUserCaps } from "./userCap";

/**
 * The scheduled work, split over cron triggers so that no single invocation goes over the Workers Free limits: 50 D1 queries
 * (and 50 outside fetches) each. Cloudflare Free allows 5 cron triggers an account; this uses four and leaves one spare.
 *
 *   30 04 UTC (10:00 IST)  MORNING_DATA     adds what has come due: EMI and loan instalments, recurring entries; asks about statements
 *   35 04 UTC (10:05 IST)  MORNING_REMINDERS  reminders and salary plans, which read what the first run just wrote
 *   40 04 UTC (10:10 IST)  MORNING_REVIEW    weekly prices, monthly nudges and review, then the morning briefing and housekeeping
 *   15 17 UTC (22:45 IST)  EVENING           the late check-in and a salary logged during the day
 *
 * The runs are minutes apart, in that order, so a later one sees what an earlier one wrote. A job inside a run is independent
 * of the others: one failing is logged as `<name>_failed` and the rest still run. Each job also caps how many people it looks
 * after per run (`userCap.ts`), so the cost of a run does not grow with the number of people invited. People left out are
 * picked up on the next run: see each job's comment, and `<job>_deferred` in the logs when it happens.
 *
 * `test/cronBudget.test.ts` runs every cron expression over a counting D1 and fails when one reaches the budget.
 */
export const MORNING_DATA_CRON = "30 4 * * *";
export const MORNING_REMINDERS_CRON = "35 4 * * *";
export const MORNING_REVIEW_CRON = "40 4 * * *";

export interface CronDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
  fetch: FetchFn;
  /** Called after each job has finished (or failed), with its log name; the budget test uses it to cost each job. */
  onJob?: (name: string) => void;
}

interface Job {
  /** The name in the logs: `<name>_done` with the result, or `<name>_failed`. */
  done: string;
  failed: string;
  /** Only reads ledger data (it may write its own claim rows). Runs of read-only jobs share one read cache. */
  readOnly: boolean;
  run: (deps: CronDeps) => Promise<object | void>;
}

const job = (done: string, failed: string, readOnly: boolean, run: Job["run"]): Job => ({ done, failed, readOnly, run });

const emi = job("emi_instalments_added", "emi_failed", false, (d) => runEmiCheckIns(d));
const loan = job("loan_instalments_added", "loan_failed", false, (d) => runLoanCheckIns(d));
const statement = job("statement_checks_done", "statement_checks_failed", false, (d) => runStatementChecks(d));
const recurring = job("recurring_done", "recurring_failed", false, (d) => runRecurring(d));
const units = job("units_check_ins_done", "units_check_ins_failed", true, (d) => runUnitsCheckIns(d));
const mandate = job("mandate_checks_done", "mandate_checks_failed", true, (d) => runMandateChecks(d));
const nudges = job("nudges_done", "nudges_failed", true, (d) => runNudges(d));
const insurance = job("insurance_reminders_done", "insurance_reminders_failed", true, (d) => runInsuranceReminders(d));
const debt = job("debt_reminders_done", "debt_reminders_failed", true, (d) => runDebtReminders(d));
const holds = job("hold_reminders_done", "hold_reminders_failed", true, (d) => runHoldReminders(d));
const salary = job("salary_plans_done", "salary_plans_failed", true, (d) => runSalaryPlans(d));
// The price refresh writes holding values, which the nudges, review and briefing then read, so it is not read-only.
const price = job("price_refresh_done", "price_refresh_failed", false, (d) => runPriceRefresh(d));
const holdingNudges = job("holding_nudges_done", "holding_nudges_failed", true, (d) => runHoldingNudges(d));
const review = job("monthly_review_done", "monthly_review_failed", true, (d) => runMonthlyReview(d));
const push = job("morning_push_done", "morning_push_failed", true, (d) => runMorningPush(d));
const maintenance = job("maintenance_done", "maintenance_failed", false, (d) => runMaintenance(d.db, d.now()));
const evening = job("evening_check_ins_done", "evening_check_ins_failed", true, (d) => runEveningCheckIns(d));

// Instalments first, so a statement that has just come round already holds its EMI when reminders are worked out.
const MORNING_DATA = [emi, loan, statement, recurring, units];
const MORNING_REMINDERS = [mandate, nudges, insurance, debt, holds, salary];
const MORNING_REVIEW = [price, holdingNudges, review, push, maintenance];
// A salary logged during the day is planned for the same night.
const EVENING = [evening, salary];

export const CRON_GROUPS: Record<string, Job[]> = {
  [MORNING_DATA_CRON]: MORNING_DATA,
  [MORNING_REMINDERS_CRON]: MORNING_REMINDERS,
  [MORNING_REVIEW_CRON]: MORNING_REVIEW,
  [EVENING_CRON]: EVENING,
};

/** The jobs for a cron expression. An unknown one (a local `__scheduled?cron=` call) runs all the morning work. */
export function jobsFor(cron: string): Job[] {
  return CRON_GROUPS[cron] ?? [...MORNING_DATA, ...MORNING_REMINDERS, ...MORNING_REVIEW];
}

async function runOne(j: Job, deps: CronDeps): Promise<void> {
  try {
    const result = await j.run(deps);
    if (j.done !== "maintenance_done") logger.info(j.done, { ...(result ?? {}) });
  } catch (error) {
    logger.error(j.failed, { error: error instanceof Error ? error.message : "unknown" });
  }
  deps.onJob?.(j.done);
}

/** Runs one cron expression's jobs in order. Neighbouring read-only jobs share a read cache; a writer ends it. */
export async function runCron(cron: string, deps: CronDeps): Promise<void> {
  return withUserCaps(deps.db, () => runJobs(cron, deps));
}

async function runJobs(cron: string, deps: CronDeps): Promise<void> {
  const jobs = jobsFor(cron);
  for (let i = 0; i < jobs.length; ) {
    const first = jobs[i] as Job;
    if (!first.readOnly) {
      await runOne(first, deps);
      i += 1;
      continue;
    }
    let end = i;
    while (end < jobs.length && (jobs[end] as Job).readOnly) end += 1;
    const batch = jobs.slice(i, end);
    await withReadCache(deps.db, async () => {
      for (const j of batch) await runOne(j, deps);
    });
    i = end;
  }
}
