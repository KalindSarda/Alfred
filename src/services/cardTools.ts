import { and, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { statementChecks } from "../db/schema";
import { loadLedgerTxns } from "../db/transactions";
import { cardOwed, countedTxns, type CardLedgerAccount } from "../domain/balances";
import { cardCycle, dueDateForStatement, statementDateFor } from "../domain/cards";
import { type FloatCard, type RankedCard, rankCards } from "../domain/cardFloat";
import { type IstDate, parseIstDate, shiftMonth } from "../domain/dates";
import { explainStatementGap, type GapAnalysis } from "../domain/statementGap";
import { isMovement } from "../domain/txnTypes";
import { newId, nowIso } from "../utils/id";
import { categoryFor } from "./balanceCheck";
import { createTransaction, listAccountsWithFigures, toLedgerAccount } from "./ledger";

/** The cards ranked for a purchase today: the longest interest-free time first, those that cannot take it last. */
export async function rankCardsForToday(db: Db, userId: string, today: IstDate, amountPaise: number): Promise<RankedCard[]> {
  const figures = await listAccountsWithFigures(db, userId, today);
  const cards: FloatCard[] = figures.flatMap((a) =>
    a.kind === "card" && !a.archivedAt
      ? [{ id: a.id, name: a.name, statementDay: a.statementDay ?? 1, dueDay: a.dueDay ?? 1, availableCreditPaise: (a.creditLimitPaise ?? 0) - a.summary.owedPaise - a.emiToComePaise, utilizationPct: a.summary.utilizationPct }]
      : [],
  );
  return rankCards(cards, today, amountPaise);
}

export interface StatementFacts {
  cardId: string;
  cardName: string;
  /** The last statement, which is the one asked about. */
  statementDate: IstDate;
  dueDate: IstDate;
  /** What Alfred makes that statement's total. */
  expectedPaise: number;
  /** What was left unpaid from the statement before it when its due date passed. */
  previousUnpaidPaise: number;
}

async function loadCard(db: Db, userId: string, cardId: string) {
  const row = await getAccount(db, userId, cardId);
  if (!row) throw new NotFoundError("Account not found");
  if (row.kind !== "card") throw new ValidationError("Request validation failed", [{ path: "cardId", message: "A statement check is for a credit card" }]);
  if (row.archivedAt) throw new ValidationError("Request validation failed", [{ path: "cardId", message: "That card is archived" }]);
  return row;
}

/** What Alfred expects the card's last statement to total, and what was left unpaid the month before. */
export async function statementFacts(db: Db, userId: string, cardId: string, today: IstDate): Promise<StatementFacts> {
  const row = await loadCard(db, userId, cardId);
  const card = toLedgerAccount(row) as CardLedgerAccount;
  const txns = await loadLedgerTxns(db, userId);
  const cycle = cardCycle(card, today);
  const statementDate = cycle.lastStatementDate;
  const expectedPaise = cardOwed(card, txns, statementDate);

  const { year, month } = parseIstDate(statementDate);
  const prev = shiftMonth(year, month, -1);
  const prevStatement = statementDateFor(card, prev.year, prev.month);
  const prevDue = dueDateForStatement(card, prev.year, prev.month);
  const paid = countedTxns(txns, prevDue)
    .filter((t) => t.txnDate > prevStatement && ((t.type === "income" && t.accountId === card.id) || (isMovement(t.type) && t.toAccountId === card.id)))
    .reduce((sum, t) => sum + t.amountPaise, 0);
  const previousUnpaidPaise = Math.max(0, cardOwed(card, txns, prevStatement) - paid);

  return { cardId, cardName: row.name, statementDate, dueDate: dueDateForStatement(card, year, month), expectedPaise, previousUnpaidPaise };
}

export interface StatementAnalysis extends GapAnalysis {
  facts: StatementFacts;
  billedPaise: number;
}

/** Compares what the statement says with what Alfred expected, and says what the gap might be. */
export async function analyseStatement(db: Db, userId: string, cardId: string, billedPaise: number, today: IstDate): Promise<StatementAnalysis> {
  const facts = await statementFacts(db, userId, cardId, today);
  return { ...explainStatementGap(facts.expectedPaise, billedPaise, facts.previousUnpaidPaise), facts, billedPaise };
}

/** Notes what a check found, once per card and statement; a later check on the same statement replaces it. */
export async function recordCheck(db: Db, userId: string, cardId: string, statementDate: IstDate, expectedPaise: number, billedPaise: number | null, status: "asked" | "matched" | "booked" | "left"): Promise<void> {
  await db
    .insert(statementChecks)
    .values({ id: newId(), userId, cardAccountId: cardId, statementDate, expectedPaise, billedPaise, status, createdAt: nowIso() })
    .onConflictDoUpdate({ target: [statementChecks.userId, statementChecks.cardAccountId, statementChecks.statementDate], set: { expectedPaise, billedPaise, status } });
}

export async function hasCheck(db: Db, userId: string, cardId: string, statementDate: IstDate): Promise<boolean> {
  const [row] = await db
    .select({ id: statementChecks.id })
    .from(statementChecks)
    .where(and(eq(statementChecks.userId, userId), eq(statementChecks.cardAccountId, cardId), eq(statementChecks.statementDate, statementDate)))
    .limit(1);
  return row !== undefined;
}

export interface StatementSettled {
  kind: GapAnalysis["bookAs"];
  bookedPaise: number;
  cardName: string;
}

/**
 * Makes Alfred agree with the statement: the gap, worked out again now, is booked as one entry on the card dated the
 * statement's day (a fee, unlogged spending, or a credit). Once it agrees nothing more is booked.
 */
export async function settleStatement(db: Db, userId: string, cardId: string, billedPaise: number, today: IstDate): Promise<StatementSettled> {
  const a = await analyseStatement(db, userId, cardId, billedPaise, today);
  if (a.bookAs === null) {
    await recordCheck(db, userId, cardId, a.facts.statementDate, a.facts.expectedPaise, billedPaise, "matched");
    return { kind: null, bookedPaise: 0, cardName: a.facts.cardName };
  }
  const income = a.bookAs === "credit";
  await createTransaction(
    db,
    userId,
    {
      type: income ? "income" : "expense",
      amountPaise: Math.abs(a.differencePaise),
      txnDate: a.facts.statementDate,
      accountId: cardId,
      categoryId: await categoryFor(db, userId, a.bookAs === "fee" ? "Fees & Charges" : a.bookAs === "spending" ? "Unlogged spending" : "Cashback", income ? "income" : "expense"),
      note: "Statement check",
    },
    { source: "check" },
  );
  await recordCheck(db, userId, cardId, a.facts.statementDate, a.facts.expectedPaise, billedPaise, "booked");
  return { kind: a.bookAs, bookedPaise: Math.abs(a.differencePaise), cardName: a.facts.cardName };
}
