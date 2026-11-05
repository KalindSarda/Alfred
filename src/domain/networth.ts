import { type IstDate, monthRange, parseIstDate, shiftMonth } from "./dates";

/** Net worth through time. Pure rules for which dates to look at and what a debt owed on a given day. */

export interface MonthPoint {
  /** "YYYY-MM". */
  month: string;
  /** The day the figures are as of: the month's last day, or today for the current month. */
  asOf: IstDate;
}

/** The last `months` months ending with the one that holds `today`, oldest first. */
export function monthPoints(today: IstDate, months: number): MonthPoint[] {
  const { year, month } = parseIstDate(today);
  const points: MonthPoint[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const m = shiftMonth(year, month, -back);
    const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
    const end = monthRange(key).to;
    points.push({ month: key, asOf: end > today ? today : end });
  }
  return points;
}

export interface DebtFact {
  direction: "lent" | "borrowed";
  amountPaise: number;
  date: IstDate;
  /** The day it was written off without being paid, if it was. */
  writtenOffOn: IstDate | null;
  payments: { amountPaise: number; date: IstDate }[];
}

/** What was still outstanding on a debt at the end of `asOf`. Nothing before it began or after it was written off. */
export function debtOutstandingAsOf(d: DebtFact, asOf: IstDate): number {
  if (d.date > asOf) return 0;
  if (d.writtenOffOn !== null && d.writtenOffOn <= asOf) return 0;
  const paid = d.payments.filter((p) => p.date <= asOf).reduce((sum, p) => sum + p.amountPaise, 0);
  return Math.max(0, d.amountPaise - paid);
}

export interface NetWorthPoint extends MonthPoint {
  netWorthPaise: number;
  banksPaise: number;
  cardsOwedPaise: number;
  emiToComePaise: number;
  owedToYouPaise: number;
  youOwePaise: number;
}

/** Same formula as the headline figure: banks - cards owed - EMIs to come + owed to you - you owe. */
export function netWorthOf(f: Omit<NetWorthPoint, "netWorthPaise" | keyof MonthPoint>): number {
  return f.banksPaise - f.cardsOwedPaise - f.emiToComePaise + f.owedToYouPaise - f.youOwePaise;
}

/** Drops the quiet months before anything was recorded, always keeping the latest. */
export function trimLeading<T extends MonthPoint>(points: readonly T[], firstActivity: IstDate | null): T[] {
  if (points.length === 0) return [];
  if (firstActivity === null) return points.slice(-1);
  const start = points.findIndex((p) => p.asOf >= firstActivity);
  return start === -1 ? points.slice(-1) : points.slice(start);
}
