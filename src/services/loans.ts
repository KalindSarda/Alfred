import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getCategoryByName } from "../db/categories";
import { getLoanRow, type LoanRow } from "../db/loans";
import { accounts, loans, transactions } from "../db/schema";
import { bpFromPct, dueDateAfter, emiAfterPrepayment, emiAfterRateChange, emiClearsLoan, firstDueAfter, levelEmi, nextInstalment, pctFromBp, projectSchedule, type ScheduleRow } from "../domain/loans";
import { type IstDate, isValidIstDate } from "../domain/dates";
import type { ChangeRateData, CreateLoanData, ForecloseLoanData, PrepayLoanData, UpdateLoanData } from "../schemas/loan";
import { newId, nowIso } from "../utils/id";
import { formatRupees } from "../domain/money";
import { createCategory } from "./categories";

export const INTEREST_CATEGORY = "Loan interest";
const FEES_CATEGORY = "Fees & Charges";
/** Instalments added in one run, so a loan left alone for years cannot flood the books. */
const MAX_CATCH_UP = 36;

export interface InstalmentDto {
  loanOn: IstDate;
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
}

export interface LoanDto {
  id: string;
  name: string;
  lender: string | null;
  kind: LoanRow["kind"];
  accountId: string;
  accountName: string;
  dueDay: number;
  ratePct: number;
  emiPaise: number;
  status: "active" | "closed";
  /** What is still owed. */
  outstandingPaise: number;
  /** Principal repaid since tracking began, and the interest paid. */
  repaidPaise: number;
  interestPaidPaise: number;
  /** From the schedule still to run. */
  monthsLeft: number;
  payoffDate: IstDate | null;
  interestToGoPaise: number;
  nextDueDate: IstDate | null;
  nextInstalment: { interestPaise: number; principalPaise: number; totalPaise: number } | null;
  /** The latest instalments added, newest first (up to 12). */
  instalments: InstalmentDto[];
}

export interface LoansOverview {
  totalOutstandingPaise: number;
  monthlyEmiPaise: number;
  loans: LoanDto[];
}

interface Entry {
  id: string;
  type: "expense" | "loan_payment";
  amountPaise: number;
  date: IstDate;
  loanOn: IstDate | null;
  deleted: boolean;
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);
const live = (e: Entry) => !e.deleted;

function checkDate(path: string, date: string, today: IstDate) {
  if (!isValidIstDate(date)) throw invalid(path, "Not a real calendar date");
  if (date > today) throw invalid(path, "That date is in the future");
}

async function loadEntries(db: Db, userId: string, loanIds?: string[]): Promise<Map<string, Entry[]>> {
  const rows = await db
    .select({ id: transactions.id, type: transactions.type, amountPaise: transactions.amountPaise, date: transactions.txnDate, loanId: transactions.loanId, loanOn: transactions.loanOn, deletedAt: transactions.deletedAt })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNotNull(transactions.loanId), ...(loanIds ? [inArray(transactions.loanId, loanIds)] : [])));
  const out = new Map<string, Entry[]>();
  for (const r of rows) {
    const list = out.get(r.loanId as string) ?? [];
    list.push({ id: r.id, type: r.type as Entry["type"], amountPaise: r.amountPaise, date: r.date, loanOn: r.loanOn, deleted: r.deletedAt !== null });
    out.set(r.loanId as string, list);
  }
  return out;
}

export const outstandingOf = (row: Pick<LoanRow, "principalPaise">, entries: readonly Entry[]): number =>
  Math.max(0, row.principalPaise - entries.filter((e) => live(e) && e.type === "loan_payment").reduce((s, e) => s + e.amountPaise, 0));

/** The next due date to add: after the latest one ever made (a removed instalment is not brought back), else the first. */
function nextDueOf(row: LoanRow, entries: readonly Entry[]): IstDate {
  const made = entries.map((e) => e.loanOn).filter((d): d is IstDate => d !== null).sort();
  const last = made[made.length - 1];
  return last ? dueDateAfter(last, row.dueDay) : row.firstDueDate;
}

function instalmentsOf(entries: readonly Entry[]): InstalmentDto[] {
  const by = new Map<string, InstalmentDto>();
  for (const e of entries.filter((x) => live(x) && x.loanOn !== null)) {
    const i = by.get(e.loanOn as string) ?? { loanOn: e.loanOn as string, interestPaise: 0, principalPaise: 0, totalPaise: 0 };
    if (e.type === "expense") i.interestPaise += e.amountPaise;
    else i.principalPaise += e.amountPaise;
    i.totalPaise = i.interestPaise + i.principalPaise;
    by.set(e.loanOn as string, i);
  }
  return [...by.values()].sort((a, b) => b.loanOn.localeCompare(a.loanOn));
}

function toDto(row: LoanRow, accountName: string, entries: readonly Entry[]): LoanDto {
  const outstanding = outstandingOf(row, entries);
  const active = row.status === "active";
  const nextDue = active ? nextDueOf(row, entries) : null;
  const schedule: ScheduleRow[] = active && nextDue ? projectSchedule(outstanding, row.ratePctBp, row.emiPaise, nextDue, row.dueDay) : [];
  const list = instalmentsOf(entries);
  const first = schedule[0];
  return {
    id: row.id,
    name: row.name,
    lender: row.lender,
    kind: row.kind,
    accountId: row.accountId,
    accountName,
    dueDay: row.dueDay,
    ratePct: pctFromBp(row.ratePctBp),
    emiPaise: row.emiPaise,
    status: row.status,
    outstandingPaise: outstanding,
    repaidPaise: row.principalPaise - outstanding,
    interestPaidPaise: list.reduce((s, i) => s + i.interestPaise, 0),
    monthsLeft: schedule.length,
    payoffDate: schedule.length ? (schedule[schedule.length - 1] as ScheduleRow).date : null,
    interestToGoPaise: schedule.reduce((s, r) => s + r.interestPaise, 0),
    nextDueDate: first ? first.date : null,
    nextInstalment: first ? { interestPaise: first.interestPaise, principalPaise: first.principalPaise, totalPaise: first.totalPaise } : null,
    instalments: list.slice(0, 12),
  };
}

/** Active loans first, the biggest debt first; closed ones after when asked for. */
export async function listLoans(db: Db, userId: string, status: "active" | "all"): Promise<LoansOverview> {
  const [rows, entries, accountRows] = await Promise.all([
    db.select().from(loans).where(eq(loans.userId, userId)),
    loadEntries(db, userId),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
  ]);
  const name = new Map(accountRows.map((a) => [a.id, a.name]));
  const dtos = rows
    .filter((r) => status === "all" || r.status === "active")
    .map((r) => toDto(r, name.get(r.accountId) ?? "Account", entries.get(r.id) ?? []))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || b.outstandingPaise - a.outstandingPaise || a.name.localeCompare(b.name));
  const live = dtos.filter((l) => l.status === "active");
  return { totalOutstandingPaise: live.reduce((s, l) => s + l.outstandingPaise, 0), monthlyEmiPaise: live.reduce((s, l) => s + l.emiPaise, 0), loans: dtos };
}

export async function getLoan(db: Db, userId: string, id: string): Promise<LoanDto> {
  const found = (await listLoans(db, userId, "all")).loans.find((l) => l.id === id);
  if (!found) throw new NotFoundError("Loan not found");
  return found;
}

/** The rest of the schedule, instalment by instalment, from what is outstanding now. */
export async function loanSchedule(db: Db, userId: string, id: string): Promise<ScheduleRow[]> {
  const row = await getLoanRow(db, userId, id);
  if (!row) throw new NotFoundError("Loan not found");
  if (row.status !== "active") return [];
  const entries = (await loadEntries(db, userId, [id])).get(id) ?? [];
  return projectSchedule(outstandingOf(row, entries), row.ratePctBp, row.emiPaise, nextDueOf(row, entries), row.dueDay);
}

/** What leaves your books for loans: net worth subtracts what is still owed on the active ones. */
export async function loansOutstanding(db: Db, userId: string): Promise<number> {
  const [rows, entries] = await Promise.all([db.select().from(loans).where(and(eq(loans.userId, userId), eq(loans.status, "active"))), loadEntries(db, userId)]);
  return rows.reduce((s, r) => s + outstandingOf(r, entries.get(r.id) ?? []), 0);
}

/** For the net worth trend: each loan's starting principal and the principal paid on each date. */
export async function loanFacts(db: Db, userId: string): Promise<{ principalPaise: number; payments: { date: IstDate; amountPaise: number }[] }[]> {
  const [rows, entries] = await Promise.all([db.select().from(loans).where(eq(loans.userId, userId)), loadEntries(db, userId)]);
  return rows.map((r) => ({
    principalPaise: r.principalPaise,
    payments: (entries.get(r.id) ?? []).filter((e) => live(e) && e.type === "loan_payment").map((e) => ({ date: e.date, amountPaise: e.amountPaise })),
  }));
}

async function categoryId(db: Db, userId: string, name: string, create: boolean): Promise<string | null> {
  const found = await getCategoryByName(db, userId, "expense", name);
  if (found && !found.archivedAt) return found.id;
  if (!create) return null;
  if (found) return found.id;
  return (await createCategory(db, userId, { name, kind: "expense" })).id;
}

async function requireBank(db: Db, userId: string, accountId: string) {
  const account = await getAccount(db, userId, accountId);
  if (!account) throw new NotFoundError("Account not found");
  if (account.kind !== "bank") throw invalid("accountId", "A loan is paid from a bank account");
  if (account.archivedAt) throw invalid("accountId", "That account is archived");
  return account;
}

export interface NewInstalment {
  loanId: string;
  loanOn: IstDate;
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
  /** The entry ids: interest and principal. */
  entryIds: string[];
}

function entryValues(row: LoanRow, type: "expense" | "loan_payment", amountPaise: number, date: IstDate, loanOn: IstDate | null, note: string, category: string | null) {
  const now = nowIso();
  return {
    id: newId(),
    userId: row.userId,
    type,
    amountPaise,
    txnDate: date,
    accountId: row.accountId,
    toAccountId: null,
    categoryId: type === "expense" ? category : null,
    merchant: row.name,
    note,
    status: "confirmed" as const,
    source: "loan" as const,
    loanId: row.id,
    loanOn,
    createdAt: now,
    updatedAt: now,
  };
}

async function closeIfClear(db: Db, userId: string, row: LoanRow) {
  const entries = (await loadEntries(db, userId, [row.id])).get(row.id) ?? [];
  const clear = outstandingOf(row, entries) <= 0;
  if (clear && row.status === "active") await db.update(loans).set({ status: "closed", closedAt: nowIso() }).where(and(eq(loans.id, row.id), eq(loans.userId, userId)));
  if (!clear && row.status === "closed") await db.update(loans).set({ status: "active", closedAt: null }).where(and(eq(loans.id, row.id), eq(loans.userId, userId)));
}

/**
 * Adds every instalment whose due date has come and that has none yet, in order: interest as an expense under "Loan
 * interest", principal as a loan payment, both from the paying bank. Safe to run as often as you like: a due date gets
 * one pair, and a removed one is not brought back. Returns what was added.
 */
export async function materializeLoan(db: Db, row: LoanRow, today: IstDate): Promise<NewInstalment[]> {
  if (row.status !== "active") return [];
  const entries = (await loadEntries(db, row.userId, [row.id])).get(row.id) ?? [];
  let outstanding = outstandingOf(row, entries);
  let due = nextDueOf(row, entries);
  const interestCategory = await categoryId(db, row.userId, INTEREST_CATEGORY, true);
  const added: NewInstalment[] = [];
  for (let i = 0; i < MAX_CATCH_UP && due <= today && outstanding > 0; i++) {
    const split = nextInstalment(outstanding, row.ratePctBp, row.emiPaise);
    if (!split) break;
    const values = [
      ...(split.interestPaise > 0 ? [entryValues(row, "expense", split.interestPaise, due, due, "Loan interest", interestCategory)] : []),
      ...(split.principalPaise > 0 ? [entryValues(row, "loan_payment", split.principalPaise, due, due, "Loan principal", null)] : []),
    ];
    if (values.length === 0) break;
    const made = await db.insert(transactions).values(values).onConflictDoNothing().returning({ id: transactions.id });
    if (made.length > 0) added.push({ loanId: row.id, loanOn: due, interestPaise: split.interestPaise, principalPaise: split.principalPaise, totalPaise: split.totalPaise, entryIds: made.map((m) => m.id) });
    outstanding -= split.principalPaise;
    due = dueDateAfter(due, row.dueDay);
  }
  if (outstanding <= 0 || added.length) await closeIfClear(db, row.userId, row);
  return added;
}

/** One person's instalments that have come due (for the daily job and for creating a loan). */
export async function materializeLoansFor(db: Db, userId: string, today: IstDate): Promise<NewInstalment[]> {
  const rows = await db.select().from(loans).where(and(eq(loans.userId, userId), eq(loans.status, "active")));
  const added: NewInstalment[] = [];
  for (const row of rows) added.push(...(await materializeLoan(db, row, today)));
  return added;
}

export async function createLoan(db: Db, userId: string, input: CreateLoanData, today: IstDate): Promise<LoanDto> {
  await requireBank(db, userId, input.accountId);
  const asOf = input.asOf ?? today;
  checkDate("asOf", asOf, today);
  if (input.firstDueDate !== undefined && !isValidIstDate(input.firstDueDate)) throw invalid("firstDueDate", "Not a real calendar date");
  const ratePctBp = bpFromPct(input.ratePct);
  let emiPaise = input.emiPaise;
  if (emiPaise === undefined) {
    if (input.months === undefined) throw invalid("months", "Give the months left, or the EMI");
    emiPaise = levelEmi(input.principalPaise, ratePctBp, input.months);
  }
  if (emiPaise <= 0 || !emiClearsLoan(input.principalPaise, ratePctBp, emiPaise)) throw invalid("emiPaise", "That EMI is too small to ever clear the loan at this rate");
  await categoryId(db, userId, INTEREST_CATEGORY, true);

  const id = newId();
  await db.insert(loans).values({
    id,
    userId,
    name: input.name.trim(),
    lender: input.lender?.trim() || null,
    kind: input.kind,
    accountId: input.accountId,
    dueDay: input.dueDay,
    principalPaise: input.principalPaise,
    anchorDate: asOf,
    ratePctBp,
    emiPaise,
    firstDueDate: input.firstDueDate ?? firstDueAfter(asOf, input.dueDay),
    createdAt: nowIso(),
  });
  const row = (await getLoanRow(db, userId, id)) as LoanRow;
  await materializeLoan(db, row, today);
  return getLoan(db, userId, id);
}

async function requireActive(db: Db, userId: string, id: string): Promise<LoanRow> {
  const row = await getLoanRow(db, userId, id);
  if (!row) throw new NotFoundError("Loan not found");
  if (row.status !== "active") throw new ConflictError("That loan is closed");
  return row;
}

async function outstandingNow(db: Db, userId: string, row: LoanRow): Promise<number> {
  return outstandingOf(row, (await loadEntries(db, userId, [row.id])).get(row.id) ?? []);
}

export async function updateLoan(db: Db, userId: string, id: string, patch: UpdateLoanData): Promise<LoanDto> {
  const row = await getLoanRow(db, userId, id);
  if (!row) throw new NotFoundError("Loan not found");
  if (patch.accountId !== undefined) await requireBank(db, userId, patch.accountId);
  if (patch.emiPaise !== undefined && !emiClearsLoan(await outstandingNow(db, userId, row), row.ratePctBp, patch.emiPaise)) throw invalid("emiPaise", "That EMI is too small to ever clear the loan at this rate");
  await db
    .update(loans)
    .set({
      name: patch.name?.trim() ?? row.name,
      lender: patch.lender === undefined ? row.lender : patch.lender?.trim() || null,
      kind: patch.kind ?? row.kind,
      accountId: patch.accountId ?? row.accountId,
      dueDay: patch.dueDay ?? row.dueDay,
      emiPaise: patch.emiPaise ?? row.emiPaise,
    })
    .where(and(eq(loans.id, id), eq(loans.userId, userId)));
  return getLoan(db, userId, id);
}

/** A lump-sum part-payment of the principal: the loan ends sooner, or the EMI comes down. */
export async function prepayLoan(db: Db, userId: string, id: string, input: PrepayLoanData, today: IstDate): Promise<LoanDto> {
  const row = await requireActive(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  const outstanding = await outstandingNow(db, userId, row);
  if (input.amountPaise > outstanding) throw invalid("amountPaise", `That is more than the ${formatRupees(outstanding)} still owed. Foreclose the loan to pay it all.`);
  const emiPaise = emiAfterPrepayment(input.effect, outstanding, input.amountPaise, row.ratePctBp, row.emiPaise);
  await db.batch([
    db.insert(transactions).values(entryValues(row, "loan_payment", input.amountPaise, date, null, "Prepayment", null)),
    db.update(loans).set({ emiPaise }).where(and(eq(loans.id, id), eq(loans.userId, userId))),
  ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  await closeIfClear(db, userId, row);
  return getLoan(db, userId, id);
}

/** A new rate from now on: keep the EMI (the end date moves) or keep the end date (the EMI changes). */
export async function changeRate(db: Db, userId: string, id: string, input: ChangeRateData): Promise<LoanDto> {
  const row = await requireActive(db, userId, id);
  const newBp = bpFromPct(input.ratePct);
  const outstanding = await outstandingNow(db, userId, row);
  const emiPaise = emiAfterRateChange(input.keep, outstanding, row.ratePctBp, newBp, row.emiPaise);
  if (outstanding > 0 && !emiClearsLoan(outstanding, newBp, emiPaise)) throw invalid("ratePct", "At that rate the EMI no longer covers the interest. Raise the EMI instead.");
  await db.update(loans).set({ ratePctBp: newBp, emiPaise }).where(and(eq(loans.id, id), eq(loans.userId, userId)));
  return getLoan(db, userId, id);
}

/** Pays off what is owed in one go, with any charges as an expense, and closes the loan. */
export async function forecloseLoan(db: Db, userId: string, id: string, input: ForecloseLoanData, today: IstDate): Promise<LoanDto> {
  const row = await requireActive(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  const outstanding = await outstandingNow(db, userId, row);
  const fees = input.chargesPaise ? await categoryId(db, userId, FEES_CATEGORY, false) : null;
  const ops: BatchItem<"sqlite">[] = [];
  if (outstanding > 0) ops.push(db.insert(transactions).values(entryValues(row, "loan_payment", outstanding, date, null, "Foreclosure", null)));
  if (input.chargesPaise) ops.push(db.insert(transactions).values(entryValues(row, "expense", input.chargesPaise, date, null, "Foreclosure charges", fees)));
  ops.push(db.update(loans).set({ status: "closed", closedAt: nowIso() }).where(and(eq(loans.id, id), eq(loans.userId, userId))));
  await db.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return getLoan(db, userId, id);
}

/** Sets what the bank actually took for one instalment: interest stays as worked out, principal takes the rest. */
export async function setInstalmentTotal(db: Db, userId: string, id: string, on: IstDate, totalPaise: number): Promise<LoanDto> {
  const row = await getLoanRow(db, userId, id);
  if (!row) throw new NotFoundError("Loan not found");
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.loanId, id), eq(transactions.loanOn, on), isNull(transactions.deletedAt)));
  if (rows.length === 0) throw new NotFoundError("Instalment not found");
  const interestRow = rows.find((r) => r.type === "expense");
  const principalRow = rows.find((r) => r.type === "loan_payment");
  const interest = Math.min(interestRow?.amountPaise ?? 0, totalPaise);
  const principal = totalPaise - interest;
  const now = nowIso();
  const ops: BatchItem<"sqlite">[] = [];
  if (interestRow) ops.push(interest > 0 ? db.update(transactions).set({ amountPaise: interest, updatedAt: now }).where(eq(transactions.id, interestRow.id)) : db.update(transactions).set({ deletedAt: now, updatedAt: now }).where(eq(transactions.id, interestRow.id)));
  if (principalRow) ops.push(principal > 0 ? db.update(transactions).set({ amountPaise: principal, updatedAt: now }).where(eq(transactions.id, principalRow.id)) : db.update(transactions).set({ deletedAt: now, updatedAt: now }).where(eq(transactions.id, principalRow.id)));
  else if (principal > 0) ops.push(db.insert(transactions).values(entryValues(row, "loan_payment", principal, on, on, "Loan principal", null)));
  await db.batch(ops as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  await closeIfClear(db, userId, row);
  return getLoan(db, userId, id);
}

/** An instalment that did not happen: both entries are removed (and not made again). */
export async function removeInstalment(db: Db, userId: string, id: string, on: IstDate): Promise<LoanDto> {
  const row = await getLoanRow(db, userId, id);
  if (!row) throw new NotFoundError("Loan not found");
  const now = nowIso();
  const gone = await db
    .update(transactions)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(transactions.userId, userId), eq(transactions.loanId, id), eq(transactions.loanOn, on), isNull(transactions.deletedAt)))
    .returning({ id: transactions.id });
  if (gone.length === 0) throw new NotFoundError("Instalment not found");
  await closeIfClear(db, userId, row);
  return getLoan(db, userId, id);
}

/** A loan with nothing recorded against it can be removed; otherwise foreclose or leave it. */
export async function deleteLoan(db: Db, userId: string, id: string): Promise<void> {
  const row = await getLoanRow(db, userId, id);
  if (!row) throw new NotFoundError("Loan not found");
  const any = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.loanId, id))).limit(1);
  if (any.length > 0) throw new ConflictError("Entries were recorded for this loan. Foreclose it instead.");
  await db.delete(loans).where(and(eq(loans.id, id), eq(loans.userId, userId)));
}
