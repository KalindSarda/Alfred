import { and, eq } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getHoldingRow } from "../db/holdings";
import { contacts, holdingPartnerEntries, transactions } from "../db/schema";
import { type IstDate, isValidIstDate } from "../domain/dates";
import type { AddPartnerStakeData, EditPartnerEntryData } from "../schemas/holding";
import { newId, nowIso } from "../utils/id";
import { contactIdFor } from "./debts";
import { getHolding, type HoldingDto } from "./holdings";

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

function checkDate(date: string, today: IstDate) {
  if (!isValidIstDate(date)) throw invalid("date", "Not a real calendar date");
  if (date > today) throw invalid("date", "That date is in the future");
}

async function requireBank(db: Db, userId: string, accountId: string) {
  const account = await getAccount(db, userId, accountId);
  if (!account) throw new NotFoundError("Account not found");
  if (account.kind !== "bank") throw invalid("accountId", "Money for a shared investment moves through a bank account, not a card");
  if (account.archivedAt) throw invalid("accountId", "That account is archived");
  return account;
}

/** The bank entry for a partner's money coming in, or a payout going back: not income or spending, never in cash flow. */
export function partnerTxn(userId: string, type: "partner_in" | "partner_out", amountPaise: number, date: IstDate, accountId: string, holdingId: string, who: string, holdingName: string) {
  const now = nowIso();
  return { id: newId(), userId, type, amountPaise, txnDate: date, accountId, toAccountId: null, categoryId: null, holdingId, merchant: who, note: type === "partner_in" ? `For ${holdingName}` : `Payout from ${holdingName}`, status: "confirmed" as const, source: "web" as const, createdAt: now, updatedAt: now };
}

async function requireOpen(db: Db, userId: string, holdingId: string) {
  const holding = await getHoldingRow(db, userId, holdingId);
  if (!holding) throw new NotFoundError("Holding not found");
  if (holding.status !== "active") throw new ConflictError("That holding is closed. Reopen it first.");
  return holding;
}

/**
 * Another person puts money into a holding. With a bank account it arrives there (a partner_in entry, linked to the holding) in one
 * step with their stake; without one it is an earlier stake. Their share follows the money put in.
 */
export async function addPartnerStake(db: Db, userId: string, holdingId: string, input: AddPartnerStakeData, today: IstDate): Promise<HoldingDto> {
  const holding = await requireOpen(db, userId, holdingId);
  const date = input.date ?? today;
  checkDate(date, today);
  let contactId: string;
  if (input.contactId) {
    const [found] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.userId, userId))).limit(1);
    if (!found) throw new NotFoundError("Person not found");
    contactId = found.id;
  } else {
    contactId = await contactIdFor(db, userId, input.name as string);
  }
  const [contact] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  const account = input.accountId ? await requireBank(db, userId, input.accountId) : null;
  const txn = account ? partnerTxn(userId, "partner_in", input.amountPaise, date, account.id, holdingId, contact?.name ?? "", holding.name) : null;
  const entry = db.insert(holdingPartnerEntries).values({ id: newId(), userId, holdingId, contactId, kind: "in", date, amountPaise: input.amountPaise, txnId: txn?.id ?? null, note: input.note?.trim() || null, createdAt: nowIso() });
  if (txn) await db.batch([entry, db.insert(transactions).values(txn)]);
  else await entry;
  return getHolding(db, userId, holdingId, today);
}

async function findEntry(db: Db, userId: string, holdingId: string, entryId: string) {
  const [row] = await db.select().from(holdingPartnerEntries).where(and(eq(holdingPartnerEntries.id, entryId), eq(holdingPartnerEntries.holdingId, holdingId), eq(holdingPartnerEntries.userId, userId))).limit(1);
  if (!row) throw new NotFoundError("Entry not found");
  return row;
}

/** Corrects one entry of a partner; its bank entry follows the amount, the day and the account. */
export async function editPartnerEntry(db: Db, userId: string, holdingId: string, entryId: string, patch: EditPartnerEntryData, today: IstDate): Promise<HoldingDto> {
  await requireOpen(db, userId, holdingId);
  const row = await findEntry(db, userId, holdingId, entryId);
  const date = patch.date ?? row.date;
  checkDate(date, today);
  if (patch.accountId !== undefined) {
    if (!row.txnId) throw invalid("accountId", "This entry has no bank entry. Remove it and add it again with a bank account");
    await requireBank(db, userId, patch.accountId);
  }
  const amount = patch.amountPaise ?? row.amountPaise;
  const ops = [
    db.update(holdingPartnerEntries).set({ amountPaise: amount, date, note: patch.note === undefined ? row.note : patch.note?.trim() || null }).where(and(eq(holdingPartnerEntries.id, row.id), eq(holdingPartnerEntries.userId, userId))),
  ];
  if (row.txnId) {
    ops.push(db.update(transactions).set({ amountPaise: amount, txnDate: date, ...(patch.accountId !== undefined && { accountId: patch.accountId }), updatedAt: nowIso() }).where(and(eq(transactions.id, row.txnId), eq(transactions.userId, userId))) as never);
  }
  await db.batch(ops as [(typeof ops)[0], ...(typeof ops)[0][]]);
  return getHolding(db, userId, holdingId, today);
}

/** Removes an entry and the bank entry it made. */
export async function removePartnerEntry(db: Db, userId: string, holdingId: string, entryId: string, today: IstDate): Promise<HoldingDto> {
  const row = await findEntry(db, userId, holdingId, entryId);
  const ops = [db.delete(holdingPartnerEntries).where(and(eq(holdingPartnerEntries.id, row.id), eq(holdingPartnerEntries.userId, userId)))];
  if (row.txnId) ops.push(db.delete(transactions).where(and(eq(transactions.id, row.txnId), eq(transactions.userId, userId))) as never);
  await db.batch(ops as [(typeof ops)[0], ...(typeof ops)[0][]]);
  return getHolding(db, userId, holdingId, today);
}
