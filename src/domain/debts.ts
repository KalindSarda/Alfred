import { addDays, type IstDate } from "./dates";

/**
 * Lent and borrowed money. Pure date and money rules.
 *
 * Following up (money lent to someone who is not trusted): the first time is on the due date, or 30 days after it
 * was lent when there is no due date; after that every 14 days, until it is paid, written off, or the person says stop.
 * Reminding about money you borrowed: the day before the due date and on the day.
 */

export const FIRST_FOLLOW_UP_DAYS = 30;
export const REPEAT_FOLLOW_UP_DAYS = 14;

export const outstandingPaise = (amountPaise: number, paidPaise: number): number => Math.max(0, amountPaise - paidPaise);

export interface FollowUpFacts {
  date: IstDate;
  dueDate: IstDate | null;
  lastFollowupOn: IstDate | null;
}

/** The day Alfred next asks about a loan that is still out. */
export function nextFollowUpDate(d: FollowUpFacts): IstDate {
  if (d.lastFollowupOn) return addDays(d.lastFollowupOn, REPEAT_FOLLOW_UP_DAYS);
  return d.dueDate ?? addDays(d.date, FIRST_FOLLOW_UP_DAYS);
}

export interface FollowUpState extends FollowUpFacts {
  direction: "lent" | "borrowed";
  status: "open" | "settled";
  followUpStopped: boolean;
  trusted: boolean;
}

/** Whether Alfred should ask about this loan today: only open, lent, untrusted, not stopped, and the day has come. */
export function followUpDue(d: FollowUpState, today: IstDate): boolean {
  if (d.direction !== "lent" || d.status !== "open" || d.followUpStopped || d.trusted) return false;
  return today >= nextFollowUpDate(d);
}

/**
 * Which reminder, if any, to send about money borrowed, given what was already sent (0, 1 or 2). If both days were
 * missed, only the later message is sent.
 */
export function repayReminderStage(dueDate: IstDate | null, sentStage: number, today: IstDate): 1 | 2 | null {
  if (!dueDate) return null;
  if (sentStage < 2 && today >= dueDate) return 2;
  if (sentStage < 1 && today >= addDays(dueDate, -1)) return 1;
  return null;
}

export const isOverdue = (dueDate: IstDate | null, today: IstDate): boolean => dueDate !== null && dueDate < today;
