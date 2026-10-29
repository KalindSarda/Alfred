import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount, insertAccount } from "../db/accounts";
import { accounts, nudgeLog, transactions } from "../db/schema";
import type { IstDate } from "../domain/dates";
import type { CreateAccountData, UpdateAccountData } from "../schemas/account";
import { nowIso } from "../utils/id";
import { type AccountWithFigures, listAccountsWithFigures } from "./ledger";

export interface BankAccountDto {
  id: string;
  kind: "bank";
  name: string;
  last4: string | null;
  openingBalancePaise: number;
  countsTowardSafeToSpend: boolean;
  balancePaise: number;
  archived: boolean;
  /** Live entries that touch this account. */
  entryCount: number;
}

export interface CardAccountDto {
  id: string;
  kind: "card";
  name: string;
  last4: string | null;
  creditLimitPaise: number;
  statementDay: number;
  dueDay: number;
  openingOutstandingPaise: number;
  archived: boolean;
  entryCount: number;
  outstandingPaise: number;
  unbilledPaise: number;
  statementOutstandingPaise: number;
  utilizationPct: number;
  nextStatementDate: IstDate;
  nextDueDate: IstDate;
}

export type AccountDto = BankAccountDto | CardAccountDto;

export function toAccountDto(account: AccountWithFigures, entryCount = 0): AccountDto {
  if (account.kind === "bank") {
    return {
      id: account.id,
      kind: "bank",
      name: account.name,
      last4: account.last4,
      openingBalancePaise: account.openingBalancePaise,
      countsTowardSafeToSpend: account.countsTowardSafeToSpend,
      balancePaise: account.balancePaise,
      archived: account.archivedAt !== null,
      entryCount,
    };
  }
  return {
    id: account.id,
    kind: "card",
    name: account.name,
    last4: account.last4,
    creditLimitPaise: account.creditLimitPaise ?? 0,
    statementDay: account.statementDay ?? 1,
    dueDay: account.dueDay ?? 1,
    openingOutstandingPaise: account.openingOutstandingPaise,
    archived: account.archivedAt !== null,
    entryCount,
    outstandingPaise: account.summary.owedPaise,
    unbilledPaise: account.summary.unbilledPaise,
    statementOutstandingPaise: account.summary.statementOutstandingPaise,
    utilizationPct: account.summary.utilizationPct,
    nextStatementDate: account.summary.nextStatementDate,
    nextDueDate: account.summary.nextDueDate,
  };
}

export interface BalanceOverview {
  /** Everything held in active bank accounts. */
  totalInBanksPaise: number;
  /** The part of it that counts toward safe-to-spend. */
  countedPaise: number;
  /** The part set aside (accounts not counted toward safe-to-spend, such as a reserve). */
  setAsidePaise: number;
  /** What all active credit cards currently owe. */
  cardsOwedPaise: number;
  /** Banks minus cards. Investments and loans will join this once they are tracked. */
  netWorthPaise: number;
  safeToSpendPaise: number;
}

/** Totals across active accounts, computed from figures already loaded (no extra query). */
export function balanceOverview(figures: readonly AccountWithFigures[]): BalanceOverview {
  let totalInBanksPaise = 0;
  let countedPaise = 0;
  let cardsOwedPaise = 0;
  for (const a of figures) {
    if (a.archivedAt) continue;
    if (a.kind === "bank") {
      totalInBanksPaise += a.balancePaise;
      if (a.countsTowardSafeToSpend) countedPaise += a.balancePaise;
    } else {
      cardsOwedPaise += a.summary.owedPaise;
    }
  }
  return {
    totalInBanksPaise,
    countedPaise,
    setAsidePaise: totalInBanksPaise - countedPaise,
    cardsOwedPaise,
    netWorthPaise: totalInBanksPaise - cardsOwedPaise,
    safeToSpendPaise: countedPaise - cardsOwedPaise,
  };
}

/** Live entries per account, counting a transfer or bill payment for both of its ends. */
async function entryCounts(db: Db, userId: string): Promise<Map<string, number>> {
  const live = and(eq(transactions.userId, userId), isNull(transactions.deletedAt));
  const [from, to] = await Promise.all([
    db.select({ id: transactions.accountId, n: count() }).from(transactions).where(live).groupBy(transactions.accountId),
    db.select({ id: transactions.toAccountId, n: count() }).from(transactions).where(live).groupBy(transactions.toAccountId),
  ]);
  const totals = new Map<string, number>();
  for (const r of [...from, ...to]) if (r.id) totals.set(r.id, (totals.get(r.id) ?? 0) + r.n);
  return totals;
}

export async function listAccountDtos(
  db: Db,
  userId: string,
  today: IstDate,
  options: { includeArchived?: boolean } = {},
): Promise<{ items: AccountDto[]; overview: BalanceOverview }> {
  const [figures, counts] = await Promise.all([listAccountsWithFigures(db, userId, today, options), entryCounts(db, userId)]);
  return { items: figures.map((a) => toAccountDto(a, counts.get(a.id) ?? 0)), overview: balanceOverview(figures) };
}

async function accountDto(db: Db, userId: string, id: string, today: IstDate): Promise<AccountDto> {
  const all = await listAccountsWithFigures(db, userId, today, { includeArchived: true });
  const found = all.find((a) => a.id === id);
  if (!found) throw new NotFoundError("Account not found");
  return toAccountDto(found, await countAccountEntries(db, userId, id));
}

async function assertNameFree(db: Db, userId: string, name: string, exceptId?: string): Promise<void> {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.name, name)))
    .limit(1);
  if (existing && existing.id !== exceptId) throw new ConflictError("An account with that name already exists");
}

export async function createAccount(db: Db, userId: string, input: CreateAccountData, today: IstDate): Promise<AccountDto> {
  await assertNameFree(db, userId, input.name);
  const row = await insertAccount(db, userId, input);
  return accountDto(db, userId, row.id, today);
}

const BANK_ONLY = ["openingBalancePaise", "countsTowardSafeToSpend"] as const;
const CARD_ONLY = ["creditLimitPaise", "statementDay", "dueDay", "openingOutstandingPaise"] as const;

export async function updateAccount(
  db: Db,
  userId: string,
  id: string,
  patch: UpdateAccountData,
  today: IstDate,
): Promise<AccountDto> {
  const row = await getAccount(db, userId, id);
  if (!row) throw new NotFoundError("Account not found");

  const notApplicable = (row.kind === "bank" ? CARD_ONLY : BANK_ONLY).filter((field) => patch[field] !== undefined);
  if (notApplicable.length) {
    throw new ValidationError(
      "Request validation failed",
      notApplicable.map((path) => ({ path, message: `Not applicable to a ${row.kind} account` })),
    );
  }
  if (patch.name !== undefined) await assertNameFree(db, userId, patch.name, id);

  if (Object.keys(patch).length > 0) {
    await db
      .update(accounts)
      .set(patch)
      .where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
  }
  return accountDto(db, userId, id, today);
}

const uses = (userId: string, id: string) =>
  and(eq(transactions.userId, userId), or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)));

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

/** Entries (not deleted) that touch an account, on either side. */
export async function countAccountEntries(db: Db, userId: string, id: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(uses(userId, id), isNull(transactions.deletedAt)));
  return row?.n ?? 0;
}

/**
 * Removes an account nothing live uses. Entries that were already deleted go with it. An account with real
 * history must be merged into another, or archived.
 */
export async function deleteAccount(db: Db, userId: string, id: string): Promise<void> {
  if (!(await getAccount(db, userId, id))) throw new NotFoundError("Account not found");
  const entries = await countAccountEntries(db, userId, id);
  if (entries > 0) {
    throw new ConflictError(
      `${entries} ${entries === 1 ? "entry uses" : "entries use"} this account. Merge it into another account, or archive it.`,
    );
  }
  await db.batch([
    db.delete(transactions).where(uses(userId, id)),
    db.delete(nudgeLog).where(and(eq(nudgeLog.userId, userId), eq(nudgeLog.cardAccountId, id))),
    db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, id))),
  ]);
}

export interface MergeResult {
  /** Entries that now belong to the target account. */
  movedEntries: number;
  /** Transfers between the two accounts, removed because they would have become transfers to itself. */
  removedTransfers: number;
}

/**
 * Moves every entry of one account into another of the same kind, adds its opening figure to the target's,
 * and removes it. Transfers between the two cancel out and are removed, so balances stay exactly as they were.
 * The target keeps its own name, limit and statement days, so card statements follow the target's cycle.
 */
export async function mergeAccount(db: Db, userId: string, fromId: string, intoId: string): Promise<MergeResult> {
  if (fromId === intoId) throw invalid("intoId", "Choose a different account to merge into");
  const [from, into] = await Promise.all([getAccount(db, userId, fromId), getAccount(db, userId, intoId)]);
  if (!from || !into) throw new NotFoundError("Account not found");
  if (from.kind !== into.kind) throw invalid("intoId", "A bank account can only be merged into a bank account, and a card into a card");
  if (into.archivedAt) throw invalid("intoId", "That account is archived");

  const between = and(
    eq(transactions.userId, userId),
    or(
      and(eq(transactions.accountId, fromId), eq(transactions.toAccountId, intoId)),
      and(eq(transactions.accountId, intoId), eq(transactions.toAccountId, fromId)),
    ),
  );
  const [live] = await db.select({ n: count() }).from(transactions).where(and(between, isNull(transactions.deletedAt)));
  const removedTransfers = live?.n ?? 0;
  const movedEntries = (await countAccountEntries(db, userId, fromId)) - removedTransfers;

  const addOpening =
    from.kind === "bank"
      ? { openingBalancePaise: sql`${accounts.openingBalancePaise} + ${from.openingBalancePaise}` }
      : { openingOutstandingPaise: sql`${accounts.openingOutstandingPaise} + ${from.openingOutstandingPaise}` };

  await db.batch([
    db.delete(transactions).where(between),
    db.update(transactions).set({ accountId: intoId }).where(and(eq(transactions.userId, userId), eq(transactions.accountId, fromId))),
    db.update(transactions).set({ toAccountId: intoId }).where(and(eq(transactions.userId, userId), eq(transactions.toAccountId, fromId))),
    db.update(accounts).set(addOpening).where(and(eq(accounts.userId, userId), eq(accounts.id, intoId))),
    db.delete(nudgeLog).where(and(eq(nudgeLog.userId, userId), eq(nudgeLog.cardAccountId, fromId))),
    db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, fromId))),
  ]);
  return { movedEntries, removedTransfers };
}

/**
 * Archiving hides an account from lists and from new transactions; history stays.
 * A card that still owes money cannot be archived, since archived accounts drop out of safe-to-spend.
 */
export async function setArchived(
  db: Db,
  userId: string,
  id: string,
  archived: boolean,
  today: IstDate,
): Promise<AccountDto> {
  const current = await accountDto(db, userId, id, today);
  if (archived && current.kind === "card" && current.outstandingPaise !== 0) {
    throw new ConflictError("This card still has an outstanding balance; pay it off before archiving");
  }
  await db
    .update(accounts)
    .set({ archivedAt: archived ? nowIso() : null })
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
  return accountDto(db, userId, id, today);
}

