import { calcSchedule } from "./emiCalc";
import { clampDay, type IstDate, parseIstDate, shiftMonth } from "./dates";

/**
 * Bank loans. Pure money and date rules.
 *
 * A loan is the money still owed (the outstanding principal), a yearly rate, and an EMI. Each month's interest is the
 * outstanding times the monthly rate; the rest of the EMI repays principal; the last instalment clears what is left.
 * The rate is held in basis points (16.5% is 1650) so it is a whole number.
 */

export interface Split {
  interestPaise: number;
  principalPaise: number;
  /** What leaves the bank: interest + principal. */
  totalPaise: number;
}

export const monthlyRate = (ratePctBp: number): number => ratePctBp / 10_000 / 12;

/** This month's instalment on what is outstanding. Null once nothing is owed. */
export function nextInstalment(outstandingPaise: number, ratePctBp: number, emiPaise: number): Split | null {
  if (outstandingPaise <= 0) return null;
  const interestPaise = Math.round(outstandingPaise * monthlyRate(ratePctBp));
  // The last one: what is left, with its interest, fits within an EMI. A level EMI is rounded to the paisa, so a sliver
  // (under half a percent of the EMI) left after the final instalment is folded into it, as a bank does.
  const principalPaise = Math.max(0, emiPaise - interestPaise);
  const leftover = outstandingPaise - principalPaise;
  if (outstandingPaise + interestPaise <= emiPaise || (principalPaise > 0 && leftover <= Math.max(100, Math.floor(emiPaise / 200)))) {
    return { interestPaise, principalPaise: outstandingPaise, totalPaise: outstandingPaise + interestPaise };
  }
  return { interestPaise, principalPaise, totalPaise: interestPaise + principalPaise };
}

/** Whether an EMI is big enough to ever clear the loan: it must beat a month's interest. */
export const emiClearsLoan = (outstandingPaise: number, ratePctBp: number, emiPaise: number): boolean =>
  emiPaise > Math.round(outstandingPaise * monthlyRate(ratePctBp));

/** The level EMI that clears `outstanding` in `months`, to the paisa (the same formula as card EMIs). */
export function levelEmi(outstandingPaise: number, ratePctBp: number, months: number): number {
  return calcSchedule({ principalPaise: outstandingPaise, annualRatePct: ratePctBp / 100, months })[0]?.instalmentPaise ?? 0;
}

export interface ScheduleRow {
  n: number;
  date: IstDate;
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
  /** Still outstanding after this instalment. */
  balancePaise: number;
}

/** The first due date after `asOf` that falls on `dueDay` (a day the month lacks becomes its last). */
export function firstDueAfter(asOf: IstDate, dueDay: number): IstDate {
  const { year, month } = parseIstDate(asOf);
  const here = clampDay(year, month, dueDay);
  if (here > asOf) return here;
  const next = shiftMonth(year, month, 1);
  return clampDay(next.year, next.month, dueDay);
}

/** The due date after `date`: the next month, on the due day. */
export function dueDateAfter(date: IstDate, dueDay: number): IstDate {
  const { year, month } = parseIstDate(date);
  const next = shiftMonth(year, month, 1);
  return clampDay(next.year, next.month, dueDay);
}

/** Every due date from `firstDue` up to `upTo`, oldest first. */
export function dueDatesUpTo(firstDue: IstDate, dueDay: number, upTo: IstDate): IstDate[] {
  const out: IstDate[] = [];
  let d = firstDue;
  while (d <= upTo && out.length < 1200) {
    out.push(d);
    d = dueDateAfter(d, dueDay);
  }
  return out;
}

/** The instalments still to come, until the loan is cleared (or `max`, for a loan that never would be). */
export function projectSchedule(outstandingPaise: number, ratePctBp: number, emiPaise: number, firstDue: IstDate, dueDay: number, max = 600): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let balance = outstandingPaise;
  let date = firstDue;
  while (balance > 0 && rows.length < max) {
    const split = nextInstalment(balance, ratePctBp, emiPaise);
    if (!split) break;
    balance -= split.principalPaise;
    rows.push({ n: rows.length + 1, date, ...split, balancePaise: balance });
    // An EMI that cannot even cover the interest would never end.
    if (split.principalPaise === 0) break;
    date = dueDateAfter(date, dueDay);
  }
  return rows;
}

/** Months until it is cleared at this EMI; null when it never would be. */
export function monthsToClear(outstandingPaise: number, ratePctBp: number, emiPaise: number): number | null {
  if (outstandingPaise <= 0) return 0;
  if (!emiClearsLoan(outstandingPaise, ratePctBp, emiPaise)) return null;
  const rows = projectSchedule(outstandingPaise, ratePctBp, emiPaise, "2000-01-01", 1, 1200);
  return rows.length >= 1200 ? null : rows.length;
}

/** After a lump-sum part-payment: keep the EMI (the loan ends sooner) or lower it over the months that were left. */
export function emiAfterPrepayment(effect: "shorten" | "lower", outstandingBeforePaise: number, prepaidPaise: number, ratePctBp: number, emiPaise: number): number {
  const left = Math.max(0, outstandingBeforePaise - prepaidPaise);
  if (effect === "shorten" || left <= 0) return emiPaise;
  const months = monthsToClear(outstandingBeforePaise, ratePctBp, emiPaise);
  if (months === null || months < 1) return emiPaise;
  return levelEmi(left, ratePctBp, months);
}

/** After a rate change: keep the EMI (the end date moves) or keep the end date (the EMI changes). */
export function emiAfterRateChange(keep: "emi" | "tenure", outstandingPaise: number, oldRatePctBp: number, newRatePctBp: number, emiPaise: number): number {
  if (keep === "emi") return emiPaise;
  const months = monthsToClear(outstandingPaise, oldRatePctBp, emiPaise);
  if (months === null || months < 1) return emiPaise;
  return levelEmi(outstandingPaise, newRatePctBp, months);
}

export const bpFromPct = (pct: number): number => Math.round(pct * 100);
export const pctFromBp = (bp: number): number => bp / 100;
