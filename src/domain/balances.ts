import { cardCycle } from "./cards";
import type { IstDate } from "./dates";

/**
 * Pure ledger math. Everything is derived from transactions plus opening figures.
 * Only confirmed, non-deleted transactions count; drafts and soft-deleted rows are ignored.
 */

import { isMovement, type TxnType } from "./txnTypes";

export type { TxnType };

export interface LedgerTxn {
  type: TxnType;
  amountPaise: number;
  txnDate: IstDate;
  accountId: string;
  /** Transfers only: the destination account. */
  toAccountId: string | null;
  status: "draft" | "confirmed";
  deletedAt: string | null;
}

export interface BankLedgerAccount {
  id: string;
  kind: "bank";
  openingBalancePaise: number;
  countsTowardSafeToSpend: boolean;
}

export interface CardLedgerAccount {
  id: string;
  kind: "card";
  openingOutstandingPaise: number;
  creditLimitPaise: number;
  statementDay: number;
  dueDay: number;
}

export type LedgerAccount = BankLedgerAccount | CardLedgerAccount;

export function countedTxns(txns: readonly LedgerTxn[], asOf?: IstDate): LedgerTxn[] {
  return txns.filter((t) => t.status === "confirmed" && t.deletedAt === null && (asOf === undefined || t.txnDate <= asOf));
}

/** Net change to an account from money flowing into it (+) and out of it (-), as a bank sees it. */
function netInflow(accountId: string, txns: readonly LedgerTxn[]): number {
  let total = 0;
  for (const t of txns) {
    if (t.type === "income" && t.accountId === accountId) total += t.amountPaise;
    else if (t.type === "expense" && t.accountId === accountId) total -= t.amountPaise;
    else if (isMovement(t.type)) {
      if (t.accountId === accountId) total -= t.amountPaise;
      if (t.toAccountId === accountId) total += t.amountPaise;
    }
  }
  return total;
}

export function bankBalance(account: BankLedgerAccount, txns: readonly LedgerTxn[], asOf?: IstDate): number {
  return account.openingBalancePaise + netInflow(account.id, countedTxns(txns, asOf));
}

/**
 * Amount currently owed on a card. Purchases raise it the moment they are logged; income on the card
 * (statement-credit cashback) and bill payments into it lower it. Same sign convention as a bank, flipped.
 */
export function cardOwed(account: CardLedgerAccount, txns: readonly LedgerTxn[], asOf?: IstDate): number {
  return account.openingOutstandingPaise - netInflow(account.id, countedTxns(txns, asOf));
}

export function utilizationPct(account: CardLedgerAccount, txns: readonly LedgerTxn[], asOf?: IstDate): number {
  const owed = Math.max(0, cardOwed(account, txns, asOf));
  return Math.round((owed / account.creditLimitPaise) * 10_000) / 100;
}

export interface CardSummary {
  owedPaise: number;
  unbilledPaise: number;
  statementOutstandingPaise: number;
  utilizationPct: number;
  lastStatementDate: IstDate;
  nextStatementDate: IstDate;
  nextDueDate: IstDate;
}

export function cardSummary(account: CardLedgerAccount, txns: readonly LedgerTxn[], today: IstDate): CardSummary {
  const cycle = cardCycle(account, today);
  const owedPaise = cardOwed(account, txns, today);

  const statementBalance = cardOwed(account, txns, cycle.lastStatementDate);
  const after = countedTxns(txns, today).filter((t) => t.txnDate > cycle.lastStatementDate);
  const unbilledPaise = after
    .filter((t) => t.type === "expense" && t.accountId === account.id)
    .reduce((sum, t) => sum + t.amountPaise, 0);

  // Statement outstanding: what is still unpaid from the last statement.
  // Payments and credits since the statement date reduce it; new purchases do not.
  const paidSince = after
    .filter((t) => (t.type === "income" && t.accountId === account.id) || (isMovement(t.type) && t.toAccountId === account.id))
    .reduce((sum, t) => sum + t.amountPaise, 0);
  const statementOutstandingPaise = Math.max(0, statementBalance - paidSince);

  return {
    owedPaise,
    unbilledPaise,
    statementOutstandingPaise,
    utilizationPct: utilizationPct(account, txns, today),
    lastStatementDate: cycle.lastStatementDate,
    nextStatementDate: cycle.nextStatementDate,
    nextDueDate: cycle.nextDueDate,
  };
}

/**
 * Safe-to-spend ("available now") = balance of bank accounts flagged to count, minus the total owed
 * across all cards. No dependence on salary dates, due dates or when a bill was paid.
 */
export function safeToSpend(accounts: readonly LedgerAccount[], txns: readonly LedgerTxn[], asOf?: IstDate): number {
  let total = 0;
  for (const account of accounts) {
    if (account.kind === "bank") {
      if (account.countsTowardSafeToSpend) total += bankBalance(account, txns, asOf);
    } else {
      total -= cardOwed(account, txns, asOf);
    }
  }
  return total;
}
