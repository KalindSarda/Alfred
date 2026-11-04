import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getDebtRow, paidByDebt } from "../db/debts";
import { accounts, contacts, debtPayments, debts, transactions } from "../db/schema";
import { type IstDate, isValidIstDate } from "../domain/dates";
import { isOverdue, nextFollowUpDate, outstandingPaise } from "../domain/debts";
import type { AddPaymentData, CreateDebtData, SettleDebtData, UpdateDebtData } from "../schemas/debt";
import { newId, nowIso } from "../utils/id";

export interface PaymentDto {
  id: string;
  amountPaise: number;
  date: IstDate;
  accountName: string | null;
  note: string | null;
}

export interface DebtDto {
  id: string;
  direction: "lent" | "borrowed";
  amountPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  date: IstDate;
  dueDate: IstDate | null;
  note: string | null;
  status: "open" | "settled";
  forgiven: boolean;
  accountName: string | null;
  overdue: boolean;
  followUpStopped: boolean;
  /** The day Alfred will next ask, for money lent to someone not trusted; null when he will not. */
  nextFollowUp: IstDate | null;
  payments: PaymentDto[];
}

export interface PersonDto {
  contactId: string;
  name: string;
  trusted: boolean;
  owedToYouPaise: number;
  youOwePaise: number;
  debts: DebtDto[];
}

export interface DebtsOverview {
  owedToYouPaise: number;
  youOwePaise: number;
  people: PersonDto[];
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

const keyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

/** People first by what they owe or are owed, then by name; each person's loans newest first. */
export async function listDebts(db: Db, userId: string, today: IstDate, status: "open" | "all"): Promise<DebtsOverview> {
  const [contactRows, debtRows, paymentRows, accountRows, paid] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.userId, userId)),
    db.select().from(debts).where(status === "open" ? and(eq(debts.userId, userId), eq(debts.status, "open")) : eq(debts.userId, userId)),
    db.select().from(debtPayments).where(eq(debtPayments.userId, userId)),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
    paidByDebt(db, userId),
  ]);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  const byDebt = new Map<string, PaymentDto[]>();
  for (const p of [...paymentRows].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))) {
    const list = byDebt.get(p.debtId) ?? [];
    list.push({ id: p.id, amountPaise: p.amountPaise, date: p.date, accountName: p.accountId ? (accountName.get(p.accountId) ?? null) : null, note: p.note });
    byDebt.set(p.debtId, list);
  }

  const people = new Map<string, PersonDto>();
  for (const c of contactRows) {
    people.set(c.id, { contactId: c.id, name: c.name, trusted: c.trusted, owedToYouPaise: 0, youOwePaise: 0, debts: [] });
  }
  let owedToYouPaise = 0;
  let youOwePaise = 0;
  for (const d of debtRows) {
    const person = people.get(d.contactId);
    if (!person) continue;
    const paidPaise = paid.get(d.id) ?? 0;
    const left = d.status === "open" ? outstandingPaise(d.amountPaise, paidPaise) : 0;
    const tracksFollowUp = d.direction === "lent" && d.status === "open" && !d.followUpStopped && !person.trusted;
    person.debts.push({
      id: d.id,
      direction: d.direction,
      amountPaise: d.amountPaise,
      paidPaise,
      outstandingPaise: left,
      date: d.date,
      dueDate: d.dueDate,
      note: d.note,
      status: d.status,
      forgiven: d.forgiven,
      accountName: d.accountId ? (accountName.get(d.accountId) ?? null) : null,
      overdue: d.status === "open" && isOverdue(d.dueDate, today),
      followUpStopped: d.followUpStopped,
      nextFollowUp: tracksFollowUp ? nextFollowUpDate(d) : null,
      payments: byDebt.get(d.id) ?? [],
    });
    if (d.direction === "lent") {
      person.owedToYouPaise += left;
      owedToYouPaise += left;
    } else {
      person.youOwePaise += left;
      youOwePaise += left;
    }
  }
  const list = [...people.values()].filter((p) => p.debts.length > 0);
  for (const p of list) p.debts.sort((a, b) => b.date.localeCompare(a.date));
  list.sort((a, b) => b.owedToYouPaise + b.youOwePaise - (a.owedToYouPaise + a.youOwePaise) || a.name.localeCompare(b.name));
  return { owedToYouPaise, youOwePaise, people: list };
}

async function personFor(db: Db, userId: string, debtId: string, today: IstDate): Promise<{ person: PersonDto; debt: DebtDto }> {
  const overview = await listDebts(db, userId, today, "all");
  for (const person of overview.people) {
    const debt = person.debts.find((d) => d.id === debtId);
    if (debt) return { person, debt };
  }
  throw new NotFoundError("Debt not found");
}

async function requireBank(db: Db, userId: string, accountId: string | null | undefined) {
  if (!accountId) return null;
  const account = await getAccount(db, userId, accountId);
  if (!account) throw new NotFoundError("Account not found");
  if (account.kind !== "bank") throw invalid("accountId", "Lent and borrowed money moves through a bank account, not a card");
  if (account.archivedAt) throw invalid("accountId", "That account is archived");
  return account;
}

function checkDate(path: string, date: string, today: IstDate) {
  if (!isValidIstDate(date)) throw invalid(path, "Not a real calendar date");
  if (date > today) throw invalid(path, "That date is in the future");
}

async function contactIdFor(db: Db, userId: string, name: string): Promise<string> {
  const key = keyOf(name);
  const [found] = await db.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.nameKey, key))).limit(1);
  if (found) return found.id;
  await db.insert(contacts).values({ id: newId(), userId, name: tidy(name), nameKey: key, createdAt: nowIso() }).onConflictDoNothing();
  const [created] = await db.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.nameKey, key))).limit(1);
  if (!created) throw new Error("Contact insert returned no row");
  return created.id;
}

/** The bank entry for money going out (you lent, or you repaid) or in (you borrowed, or were repaid). */
function movement(userId: string, type: "debt_out" | "debt_in", amountPaise: number, date: IstDate, accountId: string, who: string, note: string, source: "web" | "telegram") {
  const now = nowIso();
  return { id: newId(), userId, type, amountPaise, txnDate: date, accountId, toAccountId: null, categoryId: null, merchant: who, note, status: "confirmed" as const, source, createdAt: now, updatedAt: now };
}

/**
 * Records money lent or borrowed. With a bank account the balance moves like real life, in one step with the debt;
 * for cash or an untracked loan only the debt is recorded. Never spending or income.
 */
export async function createDebt(db: Db, userId: string, input: CreateDebtData, source: "web" | "telegram", today: IstDate): Promise<{ person: PersonDto; debtId: string }> {
  const date = input.date ?? today;
  checkDate("date", date, today);
  const dueDate = input.dueDate ?? null;
  if (dueDate !== null) {
    if (!isValidIstDate(dueDate)) throw invalid("dueDate", "Not a real calendar date");
    if (dueDate < date) throw invalid("dueDate", "The due date cannot be before the loan");
  }
  const account = await requireBank(db, userId, input.accountId);

  const contactId = await contactIdFor(db, userId, input.name);
  const who = tidy(input.name);
  const id = newId();
  const txn = account
    ? movement(userId, input.direction === "lent" ? "debt_out" : "debt_in", input.amountPaise, date, account.id, who, input.direction === "lent" ? "Lent" : "Borrowed", source)
    : null;
  const debt = db.insert(debts).values({
    id,
    userId,
    contactId,
    direction: input.direction,
    amountPaise: input.amountPaise,
    date,
    dueDate,
    note: input.note ?? null,
    accountId: account?.id ?? null,
    txnId: txn?.id ?? null,
    createdAt: nowIso(),
  });
  if (txn) await db.batch([debt, db.insert(transactions).values(txn)]);
  else await debt;
  return { person: (await personFor(db, userId, id, today)).person, debtId: id };
}

/**
 * A repayment. With a bank account it also moves that balance (money in when you lent, out when you borrowed). The
 * debt is settled by the same step once nothing is left.
 */
export async function addPayment(db: Db, userId: string, debtId: string, input: AddPaymentData, source: "web" | "telegram", today: IstDate): Promise<PersonDto> {
  const row = await getDebtRow(db, userId, debtId);
  if (!row) throw new NotFoundError("Debt not found");
  if (row.status !== "open") throw new ConflictError("That one is already settled");
  const left = outstandingPaise(row.amountPaise, (await paidByDebt(db, userId)).get(debtId) ?? 0);
  if (input.amountPaise > left) throw invalid("amountPaise", "That is more than is still owed");
  const date = input.date ?? today;
  checkDate("date", date, today);
  const account = await requireBank(db, userId, input.accountId);
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, row.contactId)).limit(1);

  const txn = account ? movement(userId, row.direction === "lent" ? "debt_in" : "debt_out", input.amountPaise, date, account.id, contact?.name ?? "Loan", row.direction === "lent" ? "Repaid" : "Repayment", source) : null;
  const paymentId = newId();
  const settle = db
    .update(debts)
    .set({ status: "settled", settledAt: nowIso() })
    .where(
      and(
        eq(debts.id, debtId),
        eq(debts.userId, userId),
        sql`${debts.amountPaise} <= (SELECT COALESCE(SUM(${debtPayments.amountPaise}), 0) FROM ${debtPayments} WHERE ${debtPayments.debtId} = ${debtId})`,
      ),
    );
  const payment = db.insert(debtPayments).values({ id: paymentId, userId, debtId, amountPaise: input.amountPaise, date, accountId: account?.id ?? null, txnId: txn?.id ?? null, note: input.note ?? null, createdAt: nowIso() });
  await db.batch(txn ? [payment, db.insert(transactions).values(txn), settle] : [payment, settle]);
  return (await personFor(db, userId, debtId, today)).person;
}

/** Everything still owed, paid in one go. */
export async function settleDebt(db: Db, userId: string, debtId: string, input: SettleDebtData, source: "web" | "telegram", today: IstDate): Promise<PersonDto> {
  const row = await getDebtRow(db, userId, debtId);
  if (!row) throw new NotFoundError("Debt not found");
  if (row.status !== "open") throw new ConflictError("That one is already settled");
  const left = outstandingPaise(row.amountPaise, (await paidByDebt(db, userId)).get(debtId) ?? 0);
  return addPayment(db, userId, debtId, { amountPaise: left, ...(input.date && { date: input.date }), accountId: input.accountId ?? null }, source, today);
}

/** Writes off what is left: the debt closes and stops counting, and no money moves. */
export async function forgiveDebt(db: Db, userId: string, debtId: string, today: IstDate): Promise<PersonDto> {
  const row = await getDebtRow(db, userId, debtId);
  if (!row) throw new NotFoundError("Debt not found");
  if (row.status !== "open") throw new ConflictError("That one is already settled");
  await db.update(debts).set({ status: "settled", settledAt: nowIso(), forgiven: true }).where(and(eq(debts.id, debtId), eq(debts.userId, userId)));
  return (await personFor(db, userId, debtId, today)).person;
}

/** Takes back a repayment recorded by mistake, with its bank entry; the debt opens again. */
export async function removePayment(db: Db, userId: string, debtId: string, paymentId: string, today: IstDate): Promise<PersonDto> {
  const [payment] = await db.select().from(debtPayments).where(and(eq(debtPayments.id, paymentId), eq(debtPayments.debtId, debtId), eq(debtPayments.userId, userId))).limit(1);
  if (!payment) throw new NotFoundError("Payment not found");
  const ops: BatchItem<"sqlite">[] = [];
  if (payment.txnId) ops.push(db.delete(transactions).where(and(eq(transactions.id, payment.txnId), eq(transactions.userId, userId))));
  ops.push(db.delete(debtPayments).where(eq(debtPayments.id, paymentId)));
  ops.push(db.update(debts).set({ status: "open", settledAt: null, forgiven: false }).where(and(eq(debts.id, debtId), eq(debts.userId, userId))));
  await db.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return (await personFor(db, userId, debtId, today)).person;
}

export async function updateDebt(db: Db, userId: string, debtId: string, patch: UpdateDebtData, today: IstDate): Promise<PersonDto> {
  const row = await getDebtRow(db, userId, debtId);
  if (!row) throw new NotFoundError("Debt not found");
  const dueDate = patch.dueDate === undefined ? row.dueDate : patch.dueDate;
  if (dueDate !== null && (!isValidIstDate(dueDate) || dueDate < row.date)) throw invalid("dueDate", "The due date cannot be before the loan");
  const dueChanged = patch.dueDate !== undefined && patch.dueDate !== row.dueDate;
  await db
    .update(debts)
    .set({
      dueDate,
      note: patch.note === undefined ? row.note : patch.note,
      followUpStopped: patch.followUpStopped ?? row.followUpStopped,
      // A new due date starts the follow-ups and reminders over from that date.
      ...(dueChanged && { lastFollowupOn: null, remindStage: 0 }),
    })
    .where(and(eq(debts.id, debtId), eq(debts.userId, userId)));
  return (await personFor(db, userId, debtId, today)).person;
}

/** Removes a loan recorded by mistake, with the bank entries it made. */
export async function deleteDebt(db: Db, userId: string, debtId: string): Promise<void> {
  const row = await getDebtRow(db, userId, debtId);
  if (!row) throw new NotFoundError("Debt not found");
  const payments = await db.select({ txnId: debtPayments.txnId }).from(debtPayments).where(and(eq(debtPayments.debtId, debtId), eq(debtPayments.userId, userId)));
  const txnIds = [row.txnId, ...payments.map((p) => p.txnId)].filter((id): id is string => id !== null);
  const ops: BatchItem<"sqlite">[] = [];
  if (txnIds.length) ops.push(db.delete(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, txnIds))));
  ops.push(db.delete(debtPayments).where(and(eq(debtPayments.debtId, debtId), eq(debtPayments.userId, userId))));
  ops.push(db.delete(debts).where(and(eq(debts.id, debtId), eq(debts.userId, userId))));
  await db.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

/** Marks someone trusted (never followed up about what they owe) or not. */
export async function setTrusted(db: Db, userId: string, contactId: string, trusted: boolean): Promise<void> {
  const updated = await db.update(contacts).set({ trusted }).where(and(eq(contacts.id, contactId), eq(contacts.userId, userId))).returning({ id: contacts.id });
  if (updated.length === 0) throw new NotFoundError("Person not found");
}

