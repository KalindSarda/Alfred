import { type CardCycleInput, statementDateFor } from "./cards";
import { type IstDate, parseIstDate, shiftMonth } from "./dates";

/**
 * Card EMI plans. A purchase is converted to equal monthly instalments; each is billed on the card's statement of
 * its month, so it lands on that statement and is due on that statement's due date. Pure date and money math.
 */

export interface EmiPlanShape {
  /** What the instalments add up to. */
  totalPaise: number;
  months: number;
  instalmentPaise: number;
  /** "YYYY-MM": the month of the first instalment's statement. */
  startMonth: string;
  /** Each instalment's exact amount, when the bank's schedule is uneven. Otherwise the split is even. */
  amountsPaise?: readonly number[] | null | undefined;
  /** A plan closed early adds no more instalments and owes nothing further here. */
  cancelled?: boolean;
}

export interface EmiInstalment {
  /** 1 to months. */
  n: number;
  /** The statement date it is billed on. */
  date: IstDate;
  amountPaise: number;
}

export const isValidStartMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** The instalment when only the total is known: whole paise, the last one carrying any remainder. */
export const defaultInstalmentPaise = (totalPaise: number, months: number): number => Math.floor(totalPaise / months);

/** Every instalment of the plan, in order. The last one makes the total exact. */
export function instalmentSchedule(plan: EmiPlanShape, card: CardCycleInput): EmiInstalment[] {
  const [year, month] = plan.startMonth.split("-").map(Number) as [number, number];
  const out: EmiInstalment[] = [];
  for (let n = 1; n <= plan.months; n++) {
    const m = shiftMonth(year, month, n - 1);
    const exact = plan.amountsPaise?.[n - 1];
    const amountPaise = exact ?? (n < plan.months ? plan.instalmentPaise : plan.totalPaise - plan.instalmentPaise * (plan.months - 1));
    out.push({ n, date: statementDateFor(card, m.year, m.month), amountPaise });
  }
  return out;
}

/** The instalments already billed by today (their statement date has come). */
export function dueInstalments(plan: EmiPlanShape, card: CardCycleInput, today: IstDate): EmiInstalment[] {
  return instalmentSchedule(plan, card).filter((i) => i.date <= today);
}

/** What is still to be billed after today: part of the debt, but not yet on any statement. Nothing once cancelled. */
export function emiToCome(plan: EmiPlanShape, card: CardCycleInput, today: IstDate): number {
  if (plan.cancelled) return 0;
  return instalmentSchedule(plan, card)
    .filter((i) => i.date > today)
    .reduce((sum, i) => sum + i.amountPaise, 0);
}

/** The next instalment still to come, or null when all are billed (or the plan was cancelled). */
export function nextInstalment(plan: EmiPlanShape, card: CardCycleInput, today: IstDate): EmiInstalment | null {
  if (plan.cancelled) return null;
  return instalmentSchedule(plan, card).find((i) => i.date > today) ?? null;
}

/** A typed schedule must have one positive whole-paise amount for every month. */
export function amountsAreValid(amounts: readonly number[], months: number): boolean {
  return amounts.length === months && amounts.every((a) => Number.isSafeInteger(a) && a > 0);
}

/** The total must be reachable: all but the last instalment together stay below it, so the last is positive. */
export function scheduleIsConsistent(plan: Pick<EmiPlanShape, "totalPaise" | "months" | "instalmentPaise">): boolean {
  return plan.months >= 1 && plan.instalmentPaise > 0 && plan.instalmentPaise * (plan.months - 1) < plan.totalPaise;
}

/** The month shown to people, "Nov 2026". */
export function startMonthLabel(startMonth: string): string {
  const { year, month } = parseIstDate(`${startMonth}-01`);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[month - 1]} ${year}`;
}
