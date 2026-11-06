import { clampDay, type IstDate, parseIstDate, shiftMonth } from "./dates";

/**
 * Commitments: money that is going to leave before something else happens (the next salary). Pure rules.
 *
 * Safe-to-spend already holds back what the cards owe, so a card bill is listed here as `counted`: shown, but never
 * taken off a second time. Everything else (an EMI instalment about to land on a card, a loan EMI, rent, a SIP, borrowed
 * money to repay) is not in safe-to-spend yet, so it is taken off to give "free to spend".
 */

export type CommitmentSource = "card" | "emi" | "loan" | "recurring" | "debt";

export interface Commitment {
  /** Identifies what is due, stable between runs: "loan:<id>", "recurring:<id>". */
  key: string;
  date: IstDate;
  title: string;
  amountPaise: number;
  source: CommitmentSource;
  /** The account it leaves from, when known (a rule or a loan names one; a card bill can be paid from any bank). */
  accountId: string | null;
  accountName: string | null;
  accountKind: "bank" | "card" | null;
  /** Already inside safe-to-spend. */
  counted: boolean;
}

export const byDate = (a: Commitment, b: Commitment): number => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);

export const sortCommitments = (items: readonly Commitment[]): Commitment[] => [...items].sort(byDate);

/** The commitments on or after `from` and before `until`. */
export const within = (items: readonly Commitment[], from: IstDate, until: IstDate): Commitment[] => items.filter((c) => c.date >= from && c.date < until);

/** What still has to come off safe-to-spend: everything in the window that it does not already hold back. */
export function uncountedPaise(items: readonly Commitment[], from: IstDate, until: IstDate): number {
  return within(items, from, until).reduce((sum, c) => sum + (c.counted ? 0 : c.amountPaise), 0);
}

/** Safe-to-spend less the commitments before `until`. May be negative: the commitments are more than what is free. */
export const freeToSpend = (safeToSpendPaise: number, items: readonly Commitment[], from: IstDate, until: IstDate): number => safeToSpendPaise - uncountedPaise(items, from, until);

/** The next day of the month that is `day` (clamped to short months) strictly after `today`. */
export function nextMonthDay(today: IstDate, day: number): IstDate {
  const { year, month } = parseIstDate(today);
  const here = clampDay(year, month, day);
  if (here > today) return here;
  const next = shiftMonth(year, month, 1);
  return clampDay(next.year, next.month, day);
}

/**
 * Where the window ends: the next salary when a recurring income says when it lands, otherwise the start of the next
 * month in the person's own sense (their month-start day). Always after today.
 */
export function horizonDate(today: IstDate, nextSalary: IstDate | null, periodStartDay: number): { until: IstDate; basis: "salary" | "month" } {
  if (nextSalary && nextSalary > today) return { until: nextSalary, basis: "salary" };
  return { until: nextMonthDay(today, periodStartDay), basis: "month" };
}

export interface Shortfall {
  commitment: Commitment;
  /** What the account was expected to hold just before this debit, counting the earlier ones. */
  balancePaise: number;
  /** How much more it needs for this debit to go through. */
  shortByPaise: number;
}

/**
 * Walks the bank debits in date order against what each account holds and reports the ones it cannot cover. Card bills
 * and anything with no bank named are left out: the person chooses what pays a card.
 */
export function shortfalls(items: readonly Commitment[], availableByAccount: ReadonlyMap<string, number>): Shortfall[] {
  const left = new Map(availableByAccount);
  const out: Shortfall[] = [];
  for (const c of sortCommitments(items)) {
    if (c.accountId === null || c.accountKind !== "bank" || c.counted || !left.has(c.accountId)) continue;
    const before = left.get(c.accountId) as number;
    left.set(c.accountId, before - c.amountPaise);
    if (before < c.amountPaise) out.push({ commitment: c, balancePaise: before, shortByPaise: c.amountPaise - Math.max(0, before) });
  }
  return out;
}
