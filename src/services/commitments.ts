import type { Db } from "../db/client";
import { addDays, type IstDate } from "../domain/dates";
import { type Commitment, freeToSpend, horizonDate, shortfalls, type Shortfall, sortCommitments, uncountedPaise, within } from "../domain/commitments";
import { dueDatesUpTo } from "../domain/loans";
import { listDebts } from "./debts";
import { listPlans } from "./emi";
import { getSafeToSpend, listAccountsWithFigures } from "./ledger";
import { listLoans } from "./loans";
import { listRules, outflowOccurrences } from "./recurring";
import { getSettings } from "./settings";

export interface CommitmentsView {
  from: IstDate;
  /** The window ends just before this day. */
  until: IstDate;
  /** "salary": the next recurring salary. "month": the person's next month start. */
  basis: "salary" | "month";
  safeToSpendPaise: number;
  /** Safe-to-spend less what is still to leave before `until`. Can be negative. */
  freeToSpendPaise: number;
  /** What is still to leave before `until` and is not yet held back by safe-to-spend. */
  commitmentsPaise: number;
  items: Commitment[];
  /** Bank debits the account cannot cover. */
  shortfalls: Shortfall[];
}

/** Every dated outflow from `from` up to, not including, `to`, from what Alfred already tracks. */
export async function collectCommitments(db: Db, userId: string, from: IstDate, to: IstDate, today: IstDate): Promise<Commitment[]> {
  const [figures, plans, loanOverview, debtOverview, outflows] = await Promise.all([
    listAccountsWithFigures(db, userId, today),
    listPlans(db, userId, today),
    listLoans(db, userId, "active"),
    listDebts(db, userId, today, "open"),
    outflowOccurrences(db, userId, from, to),
  ]);
  const kindOf = new Map(figures.map((a) => [a.id, a.kind] as const));
  const items: Commitment[] = [];

  // Card bills: already held back by safe-to-spend through what the cards owe, so listed but not taken off again.
  for (const a of figures) {
    if (a.kind !== "card" || a.archivedAt || a.summary.statementOutstandingPaise <= 0) continue;
    items.push({ key: `card:${a.id}`, date: a.summary.nextDueDate, title: `${a.name} bill`, amountPaise: a.summary.statementOutstandingPaise, source: "card", accountId: null, accountName: null, accountKind: null, counted: true });
  }

  // Card EMIs: the next instalment lands on the card as a purchase.
  for (const p of plans) {
    if (p.status !== "active" || p.nextDate === null || p.nextAmountPaise === null) continue;
    items.push({ key: `emi:${p.id}`, date: p.nextDate, title: `${p.title} EMI`, amountPaise: p.nextAmountPaise, source: "emi", accountId: p.cardAccountId, accountName: p.cardName, accountKind: "card", counted: false });
  }

  // Loan EMIs leave a bank on the due day; later months use the same amount.
  for (const l of loanOverview.loans) {
    if (l.nextDueDate === null || l.nextInstalment === null) continue;
    for (const date of dueDatesUpTo(l.nextDueDate, l.dueDay, addDays(to, -1))) {
      items.push({ key: `loan:${l.id}`, date, title: `${l.name} EMI`, amountPaise: l.nextInstalment.totalPaise, source: "loan", accountId: l.accountId, accountName: l.accountName, accountKind: "bank", counted: false });
    }
  }

  // Recurring spending and SIPs.
  for (const r of outflows) {
    for (const date of r.dates) {
      items.push({ key: `recurring:${r.id}`, date, title: r.title, amountPaise: r.amountPaise, source: "recurring", accountId: r.accountId, accountName: r.accountName, accountKind: kindOf.get(r.accountId) ?? null, counted: false });
    }
  }

  // Borrowed money that has a due date.
  for (const person of debtOverview.people) {
    for (const d of person.debts) {
      if (d.direction !== "borrowed" || d.dueDate === null || d.outstandingPaise <= 0) continue;
      items.push({ key: `debt:${d.id}`, date: d.dueDate, title: `Repay ${person.name}`, amountPaise: d.outstandingPaise, source: "debt", accountId: null, accountName: null, accountKind: null, counted: false });
    }
  }

  return sortCommitments(within(items, from, to));
}

/**
 * What is coming up before the next salary, and what is free to spend after it. The window ends at `until` when given
 * (a number of days from today), otherwise at the next recurring salary, otherwise at the next month start.
 */
export async function getCommitments(db: Db, userId: string, today: IstDate, options: { days?: number | undefined } = {}): Promise<CommitmentsView> {
  const [rules, settings] = await Promise.all([listRules(db, userId, today), getSettings(db, userId)]);
  const salary = rules
    .filter((r) => r.type === "income" && r.status === "active")
    .sort((a, b) => b.amountPaise - a.amountPaise)[0];
  const nextSalary = salary ? (salary.upcoming.find((d) => d > today) ?? null) : null;
  const horizon = options.days !== undefined ? { until: addDays(today, options.days), basis: "month" as const } : horizonDate(today, nextSalary, settings.periodStartDay);

  const [items, safe, figures] = await Promise.all([collectCommitments(db, userId, today, horizon.until, today), getSafeToSpend(db, userId, today), listAccountsWithFigures(db, userId, today)]);
  const available = new Map(figures.flatMap((a) => (a.kind === "bank" ? [[a.id, a.balancePaise - a.blockedPaise] as const] : [])));
  return {
    from: today,
    until: horizon.until,
    basis: horizon.basis,
    safeToSpendPaise: safe,
    freeToSpendPaise: freeToSpend(safe, items, today, horizon.until),
    commitmentsPaise: uncountedPaise(items, today, horizon.until),
    items,
    shortfalls: shortfalls(items, available),
  };
}
