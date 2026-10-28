/** IST calendar dates are plain "YYYY-MM-DD" strings. Never use the runtime's local timezone. */

const IST_OFFSET_MINUTES = 330;

export type IstDate = string;

/** "cycle" is the user's own month: from their chosen start day (often payday) to the day before the next one. */
export type PeriodKey = "7d" | "30d" | "90d" | "this_month" | "last_month" | "ytd" | "cycle";

export interface DateRange {
  from: IstDate;
  to: IstDate;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function toIstDate(instant: Date): IstDate {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function todayIst(now: Date = new Date()): IstDate {
  return toIstDate(now);
}

export function parseIstDate(date: IstDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid IST date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid IST date: ${date}`);
  }
  return { year, month, day };
}

export function formatIstDate(year: number, month: number, day: number): IstDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function isValidIstDate(date: string): boolean {
  try {
    parseIstDate(date);
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A statement/due day that does not exist in the month (e.g. 30 in February) becomes the last day. */
export function clampDay(year: number, month: number, day: number): IstDate {
  return formatIstDate(year, month, Math.min(day, daysInMonth(year, month)));
}

export function addDays(date: IstDate, days: number): IstDate {
  const { year, month, day } = parseIstDate(date);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return formatIstDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Shifts a year/month pair by whole months (month is 1-12). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthOf(date: IstDate): string {
  return date.slice(0, 7);
}

export function monthRange(month: string): DateRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError(`Invalid month: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  return { from: formatIstDate(year, m, 1), to: formatIstDate(year, m, daysInMonth(year, m)) };
}

/**
 * The monthly cycle that contains `today`, starting on `startDay` (clamped in short months, so 30 becomes
 * 28 in February). With startDay 1 this is the calendar month. The range covers the whole cycle, including
 * days that have not happened yet.
 */
export function cycleRange(today: IstDate, startDay: number): DateRange {
  const { year, month } = parseIstDate(today);
  const thisStart = clampDay(year, month, startDay);
  const startMonth = thisStart <= today ? { year, month } : shiftMonth(year, month, -1);
  const from = clampDay(startMonth.year, startMonth.month, startDay);
  const next = shiftMonth(startMonth.year, startMonth.month, 1);
  return { from, to: addDays(clampDay(next.year, next.month, startDay), -1) };
}

/**
 * The same stretch of the previous cycle: if today is day 10 of this cycle, the first 10 days of the one
 * before. Used to say whether spending so far is more or less than "this point last month".
 */
export function previousCycleSameDays(today: IstDate, startDay: number): DateRange {
  const current = cycleRange(today, startDay);
  const previous = cycleRange(addDays(current.from, -1), startDay);
  const elapsedDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${current.from}T00:00:00Z`)) / 86_400_000);
  const to = addDays(previous.from, elapsedDays);
  return { from: previous.from, to: to > previous.to ? previous.to : to };
}

/**
 * Resolves a dashboard period against today (IST). Rolling periods include today.
 * "this_month" and "ytd" run from their start to today. "cycle" uses `cycleStartDay`.
 */
export function resolvePeriod(key: PeriodKey, today: IstDate, cycleStartDay = 1): DateRange {
  const { year, month } = parseIstDate(today);
  switch (key) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "this_month":
      return { from: formatIstDate(year, month, 1), to: today };
    case "last_month": {
      const prev = shiftMonth(year, month, -1);
      return monthRange(`${pad(prev.year, 4)}-${pad(prev.month)}`);
    }
    case "ytd":
      return { from: formatIstDate(year, 1, 1), to: today };
    case "cycle":
      return cycleRange(today, cycleStartDay);
  }
}
