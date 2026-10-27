import { and, eq } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount, insertAccount } from "../db/accounts";
import { accounts } from "../db/schema";
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
  outstandingPaise: number;
  unbilledPaise: number;
  statementOutstandingPaise: number;
  utilizationPct: number;
  nextStatementDate: IstDate;
  nextDueDate: IstDate;
}

export type AccountDto = BankAccountDto | CardAccountDto;

export function toAccountDto(account: AccountWithFigures): AccountDto {
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
    outstandingPaise: account.summary.owedPaise,
    unbilledPaise: account.summary.unbilledPaise,
    statementOutstandingPaise: account.summary.statementOutstandingPaise,
    utilizationPct: account.summary.utilizationPct,
    nextStatementDate: account.summary.nextStatementDate,
    nextDueDate: account.summary.nextDueDate,
  };
}

export async function listAccountDtos(
  db: Db,
  userId: string,
  today: IstDate,
  options: { includeArchived?: boolean } = {},
): Promise<AccountDto[]> {
  return (await listAccountsWithFigures(db, userId, today, options)).map(toAccountDto);
}

async function accountDto(db: Db, userId: string, id: string, today: IstDate): Promise<AccountDto> {
  const all = await listAccountsWithFigures(db, userId, today, { includeArchived: true });
  const found = all.find((a) => a.id === id);
  if (!found) throw new NotFoundError("Account not found");
  return toAccountDto(found);
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

