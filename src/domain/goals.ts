import type { IstDate } from "./dates";

/** Savings goals. Pure money and date rules; money put toward a goal is only set aside, never moved. */

/** How far along a goal is, 0 to 100 (more than the target still reads 100). */
export function progressPct(savedPaise: number, targetPaise: number): number {
  if (targetPaise <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((savedPaise / targetPaise) * 100)));
}

export const remainingPaise = (savedPaise: number, targetPaise: number): number => Math.max(0, targetPaise - savedPaise);

const dayNumber = (d: IstDate): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** Whole months between today and the target date, at least 1 while the date is still ahead; 0 once it has come. */
export function monthsLeft(targetDate: IstDate, today: IstDate): number {
  const days = dayNumber(targetDate) - dayNumber(today);
  return days <= 0 ? 0 : Math.max(1, Math.round(days / 30.4375));
}

/**
 * What to put aside each month to reach the target by the date, rounded up to a whole paisa.
 * Null when there is no date or the goal is already reached; the whole remainder once the date has come.
 */
export function monthlyNeededPaise(savedPaise: number, targetPaise: number, targetDate: IstDate | null, today: IstDate): number | null {
  const left = remainingPaise(savedPaise, targetPaise);
  if (left === 0 || !targetDate) return null;
  const months = monthsLeft(targetDate, today);
  return months === 0 ? left : Math.ceil(left / months);
}

/** Worth a mention in the briefing: not reached, and the date is within 30 days or has passed. */
export function needsAttention(savedPaise: number, targetPaise: number, targetDate: IstDate | null, today: IstDate): boolean {
  if (!targetDate || remainingPaise(savedPaise, targetPaise) === 0) return false;
  return dayNumber(targetDate) - dayNumber(today) <= 30;
}
