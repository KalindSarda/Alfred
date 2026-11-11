import { addDays, type IstDate } from "./dates";

/**
 * Runway: how many months the money in your banks would last if income stopped today, at what you must spend: rent,
 * bills, groceries and the like (the categories marked essential) plus the instalments you are bound to (card EMIs and
 * loan EMIs). Pure rules. The burn is the recent average, scaled to a month, so a short history gives an early estimate.
 */

/** How far back the average looks. */
export const WINDOW_DAYS = 90;
/** Under this many days of entries there is too little to say anything. */
export const MIN_DAYS = 14;
/** From this many days the figure is no longer an early estimate. */
export const SOLID_DAYS = 60;
const MONTH_DAYS = 30;

export interface Outgo {
  date: IstDate;
  amountPaise: number;
}

export interface Runway {
  /** The bank money counted as available, less what is blocked. */
  liquidPaise: number;
  /** What must be spent in a month at the recent rate; null when there is too little history or nothing essential recorded. */
  burnPaise: number | null;
  /** How many months the money lasts at that rate, rounded down to one decimal; null without a burn. */
  months: number | null;
  /** The days of history the burn is based on. */
  basedOnDays: number;
  /** False when it rests on fewer than 60 days: an early estimate. */
  solid: boolean;
  windowFrom: IstDate;
  /** What was spent on essentials and instalments in the window. */
  essentialPaise: number;
}

const between = (from: IstDate, to: IstDate): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** `firstEntryDate` is the day of the person's earliest entry: nothing before it was tracked, so it does not count as a quiet day. */
export function runway(liquidPaise: number, outgo: readonly Outgo[], firstEntryDate: IstDate | null, today: IstDate): Runway {
  const earliest = addDays(today, -(WINDOW_DAYS - 1));
  const windowFrom = firstEntryDate !== null && firstEntryDate > earliest ? firstEntryDate : earliest;
  const basedOnDays = firstEntryDate === null ? 0 : Math.max(0, between(windowFrom, today) + 1);
  const essentialPaise = outgo.filter((o) => o.date >= windowFrom && o.date <= today).reduce((sum, o) => sum + o.amountPaise, 0);

  const burnPaise = basedOnDays >= MIN_DAYS && essentialPaise > 0 ? Math.round((essentialPaise / basedOnDays) * MONTH_DAYS) : null;
  const months = burnPaise === null ? null : liquidPaise <= 0 ? 0 : Math.floor((liquidPaise / burnPaise) * 10) / 10;
  return { liquidPaise, burnPaise, months, basedOnDays, solid: basedOnDays >= SOLID_DAYS, windowFrom, essentialPaise };
}
