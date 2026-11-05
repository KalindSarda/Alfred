import type { IstDate } from "./dates";

/**
 * Holdings: things owned that are worth money, valued by hand. Pure money and date rules.
 *
 * What was put in is the amount invested before Alfred tracked it plus the purchases linked to the holding; what was
 * taken out is the sales. The value is the latest one typed, moved by the buying and selling since then, so a purchase
 * or a sale keeps the figure sensible until the next update.
 */

export interface Dated {
  date: IstDate;
  amountPaise: number;
}

export interface HoldingFacts {
  openingInvestedPaise: number;
  purchases: readonly Dated[];
  sales: readonly Dated[];
  /** Values as typed, one per day. */
  values: readonly { date: IstDate; valuePaise: number }[];
}

const upTo = (list: readonly Dated[], asOf?: IstDate) => list.filter((e) => asOf === undefined || e.date <= asOf);
const sum = (list: readonly Dated[]) => list.reduce((s, e) => s + e.amountPaise, 0);

export const investedPaise = (f: HoldingFacts, asOf?: IstDate): number => f.openingInvestedPaise + sum(upTo(f.purchases, asOf));

export const soldPaise = (f: HoldingFacts, asOf?: IstDate): number => sum(upTo(f.sales, asOf));

/** The latest value typed on or before the day, if any. */
export function latestValue(f: HoldingFacts, asOf?: IstDate): { date: IstDate; valuePaise: number } | null {
  let best: { date: IstDate; valuePaise: number } | null = null;
  for (const v of f.values) {
    if (asOf !== undefined && v.date > asOf) continue;
    if (!best || v.date > best.date) best = v;
  }
  return best;
}

/**
 * What it is worth: the latest value typed, plus what was bought after it and less what was sold after it. With no value
 * typed yet it is taken at cost: what was put in, less what was sold. Never below nothing.
 */
export function valuePaise(f: HoldingFacts, asOf?: IstDate): number {
  const latest = latestValue(f, asOf);
  if (!latest) return Math.max(0, investedPaise(f, asOf) - soldPaise(f, asOf));
  const after = (list: readonly Dated[]) => sum(upTo(list, asOf).filter((e) => e.date > latest.date));
  return Math.max(0, latest.valuePaise + after(f.purchases) - after(f.sales));
}

/** Total return so far: what it is worth plus what came back, less what went in. Works for a holding that was sold out. */
export const gainPaise = (f: HoldingFacts, asOf?: IstDate): number => valuePaise(f, asOf) + soldPaise(f, asOf) - investedPaise(f, asOf);

/** The return as a percentage of what went in, to one decimal place; null when nothing went in. */
export function gainPct(f: HoldingFacts, asOf?: IstDate): number | null {
  const invested = investedPaise(f, asOf);
  return invested > 0 ? Math.round((gainPaise(f, asOf) / invested) * 1000) / 10 : null;
}

const dayNumber = (d: IstDate): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/** How many days ago the latest value was typed; null when none was. */
export function staleDays(f: HoldingFacts, today: IstDate): number | null {
  const latest = latestValue(f, today);
  return latest ? Math.max(0, dayNumber(today) - dayNumber(latest.date)) : null;
}

/** A value is worth asking about again after this many days. */
export const STALE_AFTER_DAYS = 35;
