import { and, desc, eq } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getHold, type HoldRow } from "../db/holds";
import { accounts, holds } from "../db/schema";
import { type IstDate, isValidIstDate } from "../domain/dates";
import type { AllotHoldData, CreateHoldData, UpdateHoldData } from "../schemas/hold";
import type { TransactionDto } from "../schemas/transaction";
import { newId, nowIso } from "../utils/id";
import { createTransaction } from "./ledger";

export interface HoldDto {
  id: string;
  accountId: string;
  accountName: string;
  title: string;
  amountPaise: number;
  appliedDate: IstDate;
  expectedDate: IstDate | null;
  status: "active" | "allotted" | "released";
  resolvedAt: string | null;
  resolvedTxnId: string | null;
  /** Still active although the outcome was due before today. */
  overdue: boolean;
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

function toDto(row: HoldRow, accountName: string, today: IstDate): HoldDto {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName,
    title: row.title,
    amountPaise: row.amountPaise,
    appliedDate: row.appliedDate,
    expectedDate: row.expectedDate,
    status: row.status,
    resolvedAt: row.resolvedAt,
    resolvedTxnId: row.resolvedTxnId,
    overdue: row.status === "active" && row.expectedDate !== null && row.expectedDate < today,
  };
}

async function dtoFor(db: Db, userId: string, id: string, today: IstDate): Promise<HoldDto> {
  const row = await getHold(db, userId, id);
  if (!row) throw new NotFoundError("Blocked amount not found");
  const account = await getAccount(db, userId, row.accountId);
  return toDto(row, account?.name ?? "Account", today);
}

/** Active ones first (soonest outcome first), then the history, newest first. */
export async function listHolds(db: Db, userId: string, today: IstDate, status: "active" | "all"): Promise<HoldDto[]> {
  const rows = await db
    .select({ hold: holds, accountName: accounts.name })
    .from(holds)
    .innerJoin(accounts, eq(accounts.id, holds.accountId))
    .where(status === "active" ? and(eq(holds.userId, userId), eq(holds.status, "active")) : eq(holds.userId, userId))
    .orderBy(desc(holds.createdAt));
  const dtos = rows.map((r) => toDto(r.hold, r.accountName, today));
  const active = dtos.filter((h) => h.status === "active").sort((a, b) => (a.expectedDate ?? "9999").localeCompare(b.expectedDate ?? "9999"));
  return [...active, ...dtos.filter((h) => h.status !== "active")];
}

async function requireBank(db: Db, userId: string, accountId: string) {
  const account = await getAccount(db, userId, accountId);
  if (!account) throw new NotFoundError("Account not found");
  if (account.kind !== "bank") throw invalid("accountId", "Money is blocked in a bank account");
  if (account.archivedAt) throw invalid("accountId", "That account is archived");
  return account;
}

function checkDates(applied: string, expected: string | null) {
  if (!isValidIstDate(applied)) throw invalid("appliedDate", "Not a real calendar date");
  if (expected !== null && !isValidIstDate(expected)) throw invalid("expectedDate", "Not a real calendar date");
  if (expected !== null && expected < applied) throw invalid("expectedDate", "The outcome cannot be due before you applied");
}

export async function createHold(db: Db, userId: string, input: CreateHoldData, today: IstDate): Promise<HoldDto> {
  await requireBank(db, userId, input.accountId);
  const appliedDate = input.appliedDate ?? today;
  const expectedDate = input.expectedDate ?? null;
  checkDates(appliedDate, expectedDate);
  const id = newId();
  await db.insert(holds).values({
    id,
    userId,
    accountId: input.accountId,
    title: input.title,
    amountPaise: input.amountPaise,
    appliedDate,
    expectedDate,
    createdAt: nowIso(),
  });
  return dtoFor(db, userId, id, today);
}

export async function updateHold(db: Db, userId: string, id: string, patch: UpdateHoldData, today: IstDate): Promise<HoldDto> {
  const row = await getHold(db, userId, id);
  if (!row) throw new NotFoundError("Blocked amount not found");
  if (row.status !== "active") throw new ConflictError("That one is already settled");
  if (patch.accountId !== undefined) await requireBank(db, userId, patch.accountId);
  const appliedDate = patch.appliedDate ?? row.appliedDate;
  const expectedDate = patch.expectedDate === undefined ? row.expectedDate : patch.expectedDate;
  checkDates(appliedDate, expectedDate);
  await db
    .update(holds)
    .set({
      ...(patch.accountId !== undefined && { accountId: patch.accountId }),
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.amountPaise !== undefined && { amountPaise: patch.amountPaise }),
      appliedDate,
      expectedDate,
      // A changed outcome date is worth asking about again.
      ...(patch.expectedDate !== undefined && patch.expectedDate !== row.expectedDate && { remindedOn: null }),
    })
    .where(and(eq(holds.userId, userId), eq(holds.id, id), eq(holds.status, "active")));
  return dtoFor(db, userId, id, today);
}

/** Moves an active hold to a final state in one conditional update; only one caller can win. */
async function claim(db: Db, userId: string, id: string, status: "allotted" | "released"): Promise<HoldRow> {
  const [row] = await db
    .update(holds)
    .set({ status, resolvedAt: nowIso() })
    .where(and(eq(holds.userId, userId), eq(holds.id, id), eq(holds.status, "active")))
    .returning();
  if (row) return row;
  if (!(await getHold(db, userId, id))) throw new NotFoundError("Blocked amount not found");
  throw new ConflictError("That one is already settled");
}

/** Not allotted: the block is lifted and nothing is debited. */
export async function releaseHold(db: Db, userId: string, id: string, today: IstDate): Promise<HoldDto> {
  await claim(db, userId, id, "released");
  return dtoFor(db, userId, id, today);
}

/**
 * Allotted: the money is really debited. Records an investment on the account (the full blocked amount unless a
 * lower one is given; the rest is simply released) and settles the hold. If the entry cannot be made the hold
 * goes back to active, so nothing is half done.
 */
export async function allotHold(
  db: Db,
  userId: string,
  id: string,
  input: AllotHoldData,
  source: "web" | "telegram",
  today: IstDate,
): Promise<{ hold: HoldDto; transaction: TransactionDto }> {
  const existing = await getHold(db, userId, id);
  if (!existing) throw new NotFoundError("Blocked amount not found");
  const amountPaise = input.amountPaise ?? existing.amountPaise;
  if (amountPaise > existing.amountPaise) throw invalid("amountPaise", "That is more than was blocked");

  const claimed = await claim(db, userId, id, "allotted");
  try {
    const transaction = await createTransaction(
      db,
      userId,
      { type: "investment", amountPaise, txnDate: input.date ?? today, accountId: claimed.accountId, merchant: claimed.title, note: "Allotted" },
      { source },
    );
    await db.update(holds).set({ resolvedTxnId: transaction.id }).where(eq(holds.id, id));
    return { hold: await dtoFor(db, userId, id, today), transaction };
  } catch (error) {
    await db.update(holds).set({ status: "active", resolvedAt: null }).where(eq(holds.id, id));
    throw error;
  }
}

/** Removes an entry made by mistake. An allotted one has a real debit; delete that entry instead. */
export async function deleteHold(db: Db, userId: string, id: string): Promise<void> {
  const row = await getHold(db, userId, id);
  if (!row) throw new NotFoundError("Blocked amount not found");
  if (row.status === "allotted") throw new ConflictError("This one was allotted. Delete the investment entry instead.");
  await db.delete(holds).where(and(eq(holds.userId, userId), eq(holds.id, id)));
}
