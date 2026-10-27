import {
  addDays,
  clampDay,
  type DateRange,
  type IstDate,
  parseIstDate,
  shiftMonth,
} from "./dates";

/**
 * Card cycle rules:
 * - A statement is generated on the statement day (clamped to the month's last day).
 *   Transactions dated on or before the statement date belong to that statement.
 * - The due day falls in the same month as the statement when dueDay > statementDay,
 *   otherwise in the following month (HDFC 23 -> 12 next month, Amazon Pay 12 -> 30 same month).
 */

export interface CardCycleInput {
  statementDay: number;
  dueDay: number;
}

export interface CardCycle {
  lastStatementDate: IstDate;
  nextStatementDate: IstDate;
  /** Window of transactions not yet on a statement: lastStatementDate + 1 .. today. */
  openWindow: DateRange;
  /** Due date of the most recent statement (may already be in the past). */
  lastStatementDueDate: IstDate;
  /** Nearest due date on or after today, across recent statements. */
  nextDueDate: IstDate;
}

export function statementDateFor(card: CardCycleInput, year: number, month: number): IstDate {
  return clampDay(year, month, card.statementDay);
}

export function dueDateForStatement(card: CardCycleInput, statementYear: number, statementMonth: number): IstDate {
  const dueMonthOffset = card.dueDay > card.statementDay ? 0 : 1;
  const due = shiftMonth(statementYear, statementMonth, dueMonthOffset);
  return clampDay(due.year, due.month, card.dueDay);
}

export function cardCycle(card: CardCycleInput, today: IstDate): CardCycle {
  const { year, month } = parseIstDate(today);

  const thisMonthStatement = statementDateFor(card, year, month);
  const lastStatementMonth = thisMonthStatement <= today ? { year, month } : shiftMonth(year, month, -1);
  const nextStatementMonth = shiftMonth(lastStatementMonth.year, lastStatementMonth.month, 1);

  const lastStatementDate = statementDateFor(card, lastStatementMonth.year, lastStatementMonth.month);
  const nextStatementDate = statementDateFor(card, nextStatementMonth.year, nextStatementMonth.month);

  const lastStatementDueDate = dueDateForStatement(card, lastStatementMonth.year, lastStatementMonth.month);

  // Statements from up to two months back can still have a due date ahead of today.
  const candidates = [-1, 0, 1].map((delta) => {
    const s = shiftMonth(lastStatementMonth.year, lastStatementMonth.month, delta);
    return dueDateForStatement(card, s.year, s.month);
  });
  const nextDueDate = candidates.filter((d) => d >= today).sort()[0] as IstDate;

  return {
    lastStatementDate,
    nextStatementDate,
    openWindow: { from: addDays(lastStatementDate, 1), to: today },
    lastStatementDueDate,
    nextDueDate,
  };
}
