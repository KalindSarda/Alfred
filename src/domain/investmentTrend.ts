import { addDays, type IstDate } from "./dates";
import { monthPoints } from "./networth";

/** Investments through time: which days to look at, and how a period's rise in worth splits into money added and market growth. Pure rules. */

export type TrendRange = "3m" | "1y" | "all";

/** Weeks shown for "3m" (the last 13, ending today). */
const WEEKS = 13;
/** Months shown for "1y" and for "all" (at most five years). */
const YEAR = 12;
const MOST = 60;

/** The days to show, oldest first: weekly for three months, month ends for a year or everything (the latest is today). */
export function trendDates(today: IstDate, range: TrendRange): IstDate[] {
  if (range === "3m") return Array.from({ length: WEEKS }, (_, i) => addDays(today, -7 * (WEEKS - 1 - i)));
  return monthPoints(today, range === "1y" ? YEAR : MOST).map((p) => p.asOf);
}

export interface Stand {
  worthPaise: number;
  putInPaise: number;
  soldPaise: number;
}

/**
 * From one day to the next: the money added is the change in what was put in less the change in what was taken out; the market's
 * part is whatever else moved the worth. The first day has nothing before it, so both are nought.
 */
export function growthSplit(prev: Stand | null, cur: Stand): { addedPaise: number; growthPaise: number } {
  if (!prev) return { addedPaise: 0, growthPaise: 0 };
  const added = cur.putInPaise - cur.soldPaise - (prev.putInPaise - prev.soldPaise);
  return { addedPaise: added, growthPaise: cur.worthPaise - prev.worthPaise - added };
}

/** Whether a day has nothing yet (no worth, nothing put in or taken out): the days before the first investment. */
export const isEmptyStand = (s: Stand): boolean => s.worthPaise === 0 && s.putInPaise === 0 && s.soldPaise === 0;
