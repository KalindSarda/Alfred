import { addDays, clampDay, daysInMonth, type IstDate, parseIstDate, shiftMonth } from "./dates";

/**
 * Recurring rules: what repeats and on which dates. Pure date math. A day a month does not have (the 31st in
 * April, 29 February in a common year) becomes that month's last day, so a monthly rule on the 31st fires every month.
 */

export type Frequency = "weekly" | "monthly" | "yearly";

export interface RuleShape {
  frequency: Frequency;
  /** Weekly: 1 (Monday) to 7 (Sunday). Monthly and yearly: the day of the month. */
  day: number;
  /** Yearly only: 1 to 12. */
  month: number | null;
  startDate: IstDate;
  endDate: IstDate | null;
  /** Due dates skipped on purpose. */
  skips?: readonly IstDate[] | undefined;
}

/** 1 (Monday) to 7 (Sunday). */
export function weekdayOf(date: IstDate): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Whether the day, and for a yearly rule the month, can ever occur (no 30 February). */
export function ruleDayIsValid(frequency: Frequency, day: number, month: number | null): boolean {
  if (!Number.isInteger(day)) return false;
  if (frequency === "weekly") return day >= 1 && day <= 7 && month === null;
  if (frequency === "monthly") return day >= 1 && day <= 31 && month === null;
  if (month === null || !Number.isInteger(month) || month < 1 || month > 12) return false;
  // Judged against a leap year, so 29 February is allowed (it falls on the 28th in other years).
  return day >= 1 && day <= daysInMonth(2024, month);
}

const SAFETY_LIMIT = 2_000;

/** Every due date from `from` to `to`, both included, oldest first, within the rule's own start and end. */
export function occurrencesBetween(rule: RuleShape, from: IstDate, to: IstDate): IstDate[] {
  const lo = from > rule.startDate ? from : rule.startDate;
  const hi = rule.endDate !== null && rule.endDate < to ? rule.endDate : to;
  if (lo > hi) return [];
  const skip = new Set(rule.skips ?? []);
  const out: IstDate[] = [];
  const take = (date: IstDate) => {
    if (date >= lo && date <= hi && !skip.has(date) && out.length < SAFETY_LIMIT) out.push(date);
  };

  if (rule.frequency === "weekly") {
    let date = addDays(lo, (rule.day - weekdayOf(lo) + 7) % 7);
    for (; date <= hi && out.length < SAFETY_LIMIT; date = addDays(date, 7)) take(date);
  } else if (rule.frequency === "monthly") {
    const a = parseIstDate(lo);
    const b = parseIstDate(hi);
    for (let m = { year: a.year, month: a.month }; m.year * 12 + m.month <= b.year * 12 + b.month; m = shiftMonth(m.year, m.month, 1)) {
      take(clampDay(m.year, m.month, rule.day));
    }
  } else {
    const a = parseIstDate(lo);
    const b = parseIstDate(hi);
    for (let year = a.year; year <= b.year; year++) take(clampDay(year, rule.month ?? 1, rule.day));
  }
  return out;
}

/** The first due date on or after `from`, or null once the rule has ended. */
export function nextOccurrence(rule: RuleShape, from: IstDate): IstDate | null {
  // A year ahead always holds the next one, whatever the pattern.
  return occurrencesBetween(rule, from, addDays(from, 400))[0] ?? null;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
}

/** "Every Monday", "Every month on the 5th", "Every year on 14 Mar". */
export function repeatLabel(rule: Pick<RuleShape, "frequency" | "day" | "month">): string {
  if (rule.frequency === "weekly") return `Every ${WEEKDAYS[rule.day - 1] ?? "week"}`;
  if (rule.frequency === "monthly") return rule.day === 31 ? "Every month on the last day" : `Every month on the ${ordinal(rule.day)}`;
  return `Every year on ${rule.day} ${MONTHS[(rule.month ?? 1) - 1]}`;
}
