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

/**
 * Holdings counted by quantity: gold in grams, fund units, shares. Quantities are whole numbers of 1/10,000 of a unit
 * (so 15.2 g is 152,000). The value is the quantity held times the latest rate typed; the rate is for `ratePer` units
 * (gold is quoted for 10 g).
 */
export interface UnitsFacts {
  ratePer: number;
  openingUnitsE4: number;
  /** Bought before tracking, with no bank entry: the cost also sits in `purchases`. */
  lots: readonly { date: IstDate; unitsE4: number }[];
  buys: readonly { date: IstDate; unitsE4: number }[];
  sells: readonly { date: IstDate; unitsE4: number }[];
  rates: readonly { date: IstDate; ratePaise: number }[];
}

export interface HoldingFacts {
  /** Present when the holding is counted by quantity. */
  units?: UnitsFacts;
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

export const UNIT_SCALE = 10_000;

const unitsUpTo = (list: readonly { date: IstDate; unitsE4: number }[], asOf?: IstDate) => list.filter((e) => asOf === undefined || e.date <= asOf).reduce((s, e) => s + e.unitsE4, 0);

/** Quantity held on the day (in 1/10,000 units): what was held before, plus lots and purchases, less sales. Never below nothing. */
export const unitsHeldE4 = (u: UnitsFacts, asOf?: IstDate): number => Math.max(0, u.openingUnitsE4 + unitsUpTo(u.lots, asOf) + unitsUpTo(u.buys, asOf) - unitsUpTo(u.sells, asOf));

/** The latest rate typed on or before the day, if any. */
export function latestRate(u: UnitsFacts, asOf?: IstDate): { date: IstDate; ratePaise: number } | null {
  let best: { date: IstDate; ratePaise: number } | null = null;
  for (const r of u.rates) {
    if (asOf !== undefined && r.date > asOf) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}

/** What a quantity is worth at a rate quoted for `ratePer` units, in whole paise. */
export const valueAtRate = (unitsE4: number, ratePaise: number, ratePer: number): number => Math.round((unitsE4 * ratePaise) / (UNIT_SCALE * ratePer));

/** The average price paid, quoted like the rate (per `ratePer` units): what went in over everything ever acquired. Null with no quantity. */
export function avgCostPaise(f: HoldingFacts, asOf?: IstDate): number | null {
  const u = f.units;
  if (!u) return null;
  const acquired = u.openingUnitsE4 + unitsUpTo(u.lots, asOf) + unitsUpTo(u.buys, asOf);
  return acquired > 0 ? Math.round((investedPaise(f, asOf) * UNIT_SCALE * u.ratePer) / acquired) : null;
}

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
  if (f.units) {
    const rate = latestRate(f.units, asOf);
    if (!rate) return Math.max(0, investedPaise(f, asOf) - soldPaise(f, asOf));
    return Math.max(0, Math.round((unitsHeldE4(f.units, asOf) * rate.ratePaise) / (UNIT_SCALE * f.units.ratePer)));
  }
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
  const latest = f.units ? latestRate(f.units, today) : latestValue(f, today);
  return latest ? Math.max(0, dayNumber(today) - dayNumber(latest.date)) : null;
}

/** A value is worth asking about again after this many days. */
export const STALE_AFTER_DAYS = 35;

/** Kinds that can be counted by quantity, with the unit they are held in and the quantity a rate is quoted for. */
export const UNIT_KINDS = ["gold", "fund", "stock"] as const;
export function unitInfo(kind: string): { label: string; ratePer: number } | null {
  if (kind === "gold") return { label: "g", ratePer: 10 };
  if (kind === "fund") return { label: "units", ratePer: 1 };
  if (kind === "stock") return { label: "shares", ratePer: 1 };
  return null;
}
