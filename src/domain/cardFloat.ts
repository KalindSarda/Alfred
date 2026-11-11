import { type CardCycleInput, cardCycle, dueDateForStatement } from "./cards";
import { addDays, type IstDate, parseIstDate } from "./dates";

/**
 * The interest-free float: how many days pass between buying something today and the bill falling due. A purchase
 * made on or before a statement date goes on that statement, so the day after a statement gives the longest float.
 */

const between = (from: IstDate, to: IstDate): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface Float {
  /** The statement a purchase made on `day` will appear on. */
  statementDate: IstDate;
  dueDate: IstDate;
  /** Days from `day` until that bill is due. */
  days: number;
}

export function floatOn(card: CardCycleInput, day: IstDate): Float {
  const cycle = cardCycle(card, day);
  const statementDate = cycle.lastStatementDate === day ? day : cycle.nextStatementDate;
  const { year, month } = parseIstDate(statementDate);
  const dueDate = dueDateForStatement(card, year, month);
  return { statementDate, dueDate, days: between(day, dueDate) };
}

export interface FloatCard extends CardCycleInput {
  id: string;
  name: string;
  /** What the card can still take: the limit less what is owed and what EMIs hold back. */
  availableCreditPaise: number;
  utilizationPct: number;
}

export interface RankedCard extends Float {
  id: string;
  name: string;
  availableCreditPaise: number;
  utilizationPct: number;
  /** The amount fits within the available credit. */
  fits: boolean;
  /** What waiting until the day after the statement would give instead, when that is worth saying. */
  waitDate: IstDate | null;
  waitDays: number | null;
}

/** Cards that can take the amount first, then the longest float; ties go to the one with more credit left. */
export function rankCards(cards: readonly FloatCard[], today: IstDate, amountPaise: number): RankedCard[] {
  return cards
    .map((c): RankedCard => {
      const f = floatOn(c, today);
      const after = addDays(f.statementDate, 1);
      const later = floatOn(c, after);
      const worthWaiting = between(today, f.statementDate) <= 7 && f.statementDate !== today && later.days - f.days >= 15;
      return {
        ...f,
        id: c.id,
        name: c.name,
        availableCreditPaise: c.availableCreditPaise,
        utilizationPct: c.utilizationPct,
        fits: c.availableCreditPaise >= amountPaise,
        waitDate: worthWaiting ? after : null,
        waitDays: worthWaiting ? later.days : null,
      };
    })
    .sort((a, b) => Number(b.fits) - Number(a.fits) || b.days - a.days || b.availableCreditPaise - a.availableCreditPaise || a.name.localeCompare(b.name));
}
