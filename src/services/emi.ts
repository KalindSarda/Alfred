import { and, count, eq, isNull } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getCategory } from "../db/categories";
import { type EmiPlanRow, getPlanRow, parseAmounts, toShape } from "../db/emi";
import { getTransactionRow } from "../db/transactions";
import { accounts, categories, emiPlans, transactions } from "../db/schema";
import type { IstDate } from "../domain/dates";
import { amountsAreValid, defaultInstalmentPaise, dueInstalments, emiToCome, instalmentSchedule, nextInstalment, scheduleIsConsistent } from "../domain/emi";
import type { CreateEmiPlanData, UpdateEmiPlanData } from "../schemas/emi";
import { newId, nowIso } from "../utils/id";

export interface EmiPlanDto {
  id: string;
  cardAccountId: string;
  cardName: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  /** What the instalments add up to. */
  totalPaise: number;
  months: number;
  instalmentPaise: number;
  /** Every instalment's amount in order, so an uneven bank schedule can be shown and corrected. */
  scheduleAmountsPaise: number[];
  /** True when the instalment amounts were typed in from the bank's schedule rather than split evenly. */
  uneven: boolean;
  startMonth: string;
  status: "active" | "finished" | "cancelled";
  /** Instalments already billed, and what they came to. */
  billedCount: number;
  billedPaise: number;
  /** Still to be billed: part of the debt, not yet on a statement. */
  toComePaise: number;
  nextDate: IstDate | null;
  nextAmountPaise: number | null;
  /** True once instalments have been added. Changing the amounts then rebuilds them. */
  locked: boolean;
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

/**
 * Works out the total and the instalment from what was typed. Typing every instalment (an uneven bank schedule)
 * wins: the total is their sum. Otherwise the total includes interest when one instalment is given.
 */
function resolveAmounts(input: { totalPaise?: number | undefined; months: number; instalmentPaise?: number | undefined; instalmentsPaise?: number[] | undefined }) {
  if (input.instalmentsPaise) {
    if (!amountsAreValid(input.instalmentsPaise, input.months)) throw invalid("instalmentsPaise", `Give one amount for each of the ${input.months} months`);
    const totalPaise = input.instalmentsPaise.reduce((sum, a) => sum + a, 0);
    // The usual instalment is the second one: the first is often a part-month and the last a rounding.
    const instalmentPaise = input.instalmentsPaise[Math.min(1, input.instalmentsPaise.length - 1)] as number;
    return { totalPaise, instalmentPaise, amountsPaise: input.instalmentsPaise as number[] | null };
  }
  if (input.totalPaise === undefined) throw invalid("totalPaise", "Enter the amount converted, or every instalment");
  const instalmentPaise = input.instalmentPaise ?? defaultInstalmentPaise(input.totalPaise, input.months);
  const totalPaise = input.instalmentPaise !== undefined ? input.instalmentPaise * input.months : input.totalPaise;
  if (!scheduleIsConsistent({ totalPaise, months: input.months, instalmentPaise })) {
    throw invalid("instalmentPaise", "The instalment is too large for that many months");
  }
  return { totalPaise, instalmentPaise, amountsPaise: null as number[] | null };
}

async function requireCard(db: Db, userId: string, id: string) {
  const card = await getAccount(db, userId, id);
  if (!card) throw new NotFoundError("Card not found");
  if (card.kind !== "card") throw invalid("cardAccountId", "EMI plans are for credit cards");
  if (card.archivedAt) throw invalid("cardAccountId", "That card is archived");
  return card;
}

async function requireCategory(db: Db, userId: string, id: string | null | undefined) {
  if (!id) return;
  const category = await getCategory(db, userId, id);
  if (!category) throw new NotFoundError("Category not found");
  if (category.kind !== "expense") throw invalid("categoryId", "Instalments are expenses, so use an expense category");
  if (category.archivedAt) throw invalid("categoryId", "That category is archived");
}

async function entryCounts(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: transactions.emiPlanId, n: count() })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.source, "emi")))
    .groupBy(transactions.emiPlanId);
  return new Map(rows.flatMap((r) => (r.id ? [[r.id, r.n] as const] : [])));
}

function toDto(row: EmiPlanRow, cardName: string, statement: { statementDay: number; dueDay: number }, categoryName: string | null, entries: number, today: IstDate): EmiPlanDto {
  const shape = toShape(row);
  const amounts = instalmentSchedule(shape, statement).map((i) => i.amountPaise);
  const billed = dueInstalments(shape, statement, today);
  const next = nextInstalment(shape, statement, today);
  const billedCount = row.cancelledAt ? entries : billed.length;
  return {
    id: row.id,
    cardAccountId: row.cardAccountId,
    cardName,
    title: row.title,
    categoryId: row.categoryId,
    categoryName,
    totalPaise: row.totalPaise,
    months: row.months,
    instalmentPaise: row.instalmentPaise,
    scheduleAmountsPaise: amounts,
    uneven: parseAmounts(row.amountsJson) !== null,
    startMonth: row.startMonth,
    status: row.cancelledAt ? "cancelled" : billed.length >= row.months ? "finished" : "active",
    billedCount,
    billedPaise: billed.slice(0, billedCount).reduce((sum, i) => sum + i.amountPaise, 0),
    toComePaise: emiToCome(shape, statement, today),
    nextDate: next?.date ?? null,
    nextAmountPaise: next?.amountPaise ?? null,
    locked: entries > 0,
  };
}

/** Running plans first (soonest next instalment), then finished and cancelled ones. */
export async function listPlans(db: Db, userId: string, today: IstDate): Promise<EmiPlanDto[]> {
  const [rows, entries] = await Promise.all([
    db
      .select({ plan: emiPlans, cardName: accounts.name, statementDay: accounts.statementDay, dueDay: accounts.dueDay, categoryName: categories.name })
      .from(emiPlans)
      .innerJoin(accounts, eq(accounts.id, emiPlans.cardAccountId))
      .leftJoin(categories, eq(categories.id, emiPlans.categoryId))
      .where(eq(emiPlans.userId, userId)),
    entryCounts(db, userId),
  ]);
  const dtos = rows.map((r) =>
    toDto(r.plan, r.cardName, { statementDay: r.statementDay ?? 1, dueDay: r.dueDay ?? 1 }, r.categoryName, entries.get(r.plan.id) ?? 0, today),
  );
  const rank = { active: 0, finished: 1, cancelled: 2 } as const;
  return dtos.sort((a, b) => rank[a.status] - rank[b.status] || (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.title.localeCompare(b.title));
}

async function dtoFor(db: Db, userId: string, id: string, today: IstDate): Promise<EmiPlanDto> {
  const found = (await listPlans(db, userId, today)).find((p) => p.id === id);
  if (!found) throw new NotFoundError("EMI plan not found");
  return found;
}

/**
 * Adds, as ordinary expenses on the card, every instalment whose statement date has come and that does not exist
 * yet. Safe to run as often as you like: an instalment is created once, and one the user deleted is not brought back.
 */
async function materializePlan(db: Db, row: EmiPlanRow, card: { statementDay: number; dueDay: number }, today: IstDate): Promise<number> {
  if (row.cancelledAt) return 0;
  const due = dueInstalments(toShape(row), card, today);
  if (due.length === 0) return 0;
  const now = nowIso();
  const rows = due.map((i) => ({
    id: newId(),
    userId: row.userId,
    type: "expense" as const,
    amountPaise: i.amountPaise,
    txnDate: i.date,
    accountId: row.cardAccountId,
    toAccountId: null,
    categoryId: row.categoryId,
    merchant: row.title,
    note: `EMI ${i.n} of ${row.months}`,
    status: "confirmed" as const,
    source: "emi" as const,
    emiPlanId: row.id,
    emiInstalment: i.n,
    createdAt: now,
    updatedAt: now,
  }));
  let added = 0;
  // D1 allows 100 bound variables a statement, so insert a few rows at a time.
  for (let i = 0; i < rows.length; i += 4) {
    const made = await db.insert(transactions).values(rows.slice(i, i + 4)).onConflictDoNothing().returning({ id: transactions.id });
    added += made.length;
  }
  return added;
}

async function materializeById(db: Db, userId: string, id: string, today: IstDate): Promise<number> {
  const row = await getPlanRow(db, userId, id);
  if (!row) return 0;
  const card = await getAccount(db, userId, row.cardAccountId);
  return materializePlan(db, row, { statementDay: card?.statementDay ?? 1, dueDay: card?.dueDay ?? 1 }, today);
}

/** One person's instalments that have come due. */
export async function materializeEmi(db: Db, userId: string, today: IstDate): Promise<number> {
  const rows = await db.select({ id: emiPlans.id }).from(emiPlans).where(and(eq(emiPlans.userId, userId), isNull(emiPlans.cancelledAt)));
  let added = 0;
  for (const { id } of rows) added += await materializeById(db, userId, id, today);
  return added;
}

/** The daily job: everyone's instalments that have come due. One person failing does not stop the rest. */
export async function materializeAllEmi(db: Db, today: IstDate, onError: (error: unknown) => void = () => undefined): Promise<number> {
  const owners = await db.selectDistinct({ userId: emiPlans.userId }).from(emiPlans).where(isNull(emiPlans.cancelledAt));
  let added = 0;
  for (const { userId } of owners) {
    try {
      added += await materializeEmi(db, userId, today);
    } catch (error) {
      onError(error);
    }
  }
  return added;
}

export async function createPlan(db: Db, userId: string, input: CreateEmiPlanData, today: IstDate): Promise<EmiPlanDto> {
  const card = await requireCard(db, userId, input.cardAccountId);
  await requireCategory(db, userId, input.categoryId);
  const { totalPaise, instalmentPaise, amountsPaise } = resolveAmounts(input);

  let replaced: string | null = null;
  if (input.replacesTransactionId) {
    const txn = await getTransactionRow(db, userId, input.replacesTransactionId);
    if (!txn) throw new NotFoundError("Transaction not found");
    if (txn.type !== "expense" || txn.accountId !== card.id) throw invalid("replacesTransactionId", "That is not an expense on this card");
    replaced = txn.id;
  }

  const id = newId();
  const plan = db.insert(emiPlans).values({
    id,
    userId,
    cardAccountId: card.id,
    title: input.title,
    categoryId: input.categoryId ?? null,
    totalPaise,
    months: input.months,
    instalmentPaise,
    startMonth: input.startMonth,
    amountsJson: amountsPaise ? JSON.stringify(amountsPaise) : null,
    createdAt: nowIso(),
  });
  if (replaced) {
    await db.batch([plan, db.update(transactions).set({ deletedAt: nowIso() }).where(and(eq(transactions.userId, userId), eq(transactions.id, replaced)))]);
  } else {
    await plan;
  }
  await materializeById(db, userId, id, today);
  return dtoFor(db, userId, id, today);
}

export async function updatePlan(db: Db, userId: string, id: string, patch: UpdateEmiPlanData, today: IstDate): Promise<EmiPlanDto> {
  const row = await getPlanRow(db, userId, id);
  if (!row) throw new NotFoundError("EMI plan not found");
  const structural =
    patch.totalPaise !== undefined || patch.months !== undefined || patch.instalmentPaise !== undefined || patch.instalmentsPaise !== undefined || patch.startMonth !== undefined;
  if (structural && row.cancelledAt) throw new ConflictError("This plan is closed. Reopen it to change the amounts.");
  if (patch.categoryId !== undefined) await requireCategory(db, userId, patch.categoryId);

  const months = patch.months ?? row.months;
  // A new total, instalment or month count means a new even split, unless every instalment was typed; a changed
  // start month alone keeps whatever schedule the plan has.
  const reshaped = patch.totalPaise !== undefined || patch.months !== undefined || patch.instalmentPaise !== undefined;
  const existing = parseAmounts(row.amountsJson);
  const amounts = structural
    ? patch.instalmentsPaise || reshaped || !existing
      ? resolveAmounts({
          totalPaise: patch.totalPaise ?? row.totalPaise,
          months,
          instalmentPaise: patch.instalmentPaise ?? (patch.totalPaise !== undefined || patch.months !== undefined ? undefined : row.instalmentPaise),
          instalmentsPaise: patch.instalmentsPaise,
        })
      : { totalPaise: row.totalPaise, instalmentPaise: row.instalmentPaise, amountsPaise: existing }
    : { totalPaise: row.totalPaise, instalmentPaise: row.instalmentPaise, amountsPaise: existing };

  const title = patch.title ?? row.title;
  const categoryId = patch.categoryId === undefined ? row.categoryId : patch.categoryId;
  await db.batch([
    db
      .update(emiPlans)
      .set({
        title,
        categoryId,
        months,
        totalPaise: amounts.totalPaise,
        instalmentPaise: amounts.instalmentPaise,
        startMonth: patch.startMonth ?? row.startMonth,
        amountsJson: amounts.amountsPaise ? JSON.stringify(amounts.amountsPaise) : null,
      })
      .where(and(eq(emiPlans.userId, userId), eq(emiPlans.id, id))),
    // New amounts or dates rebuild the instalments from scratch (they are re-added just below); otherwise the
    // instalments already added simply take the new name and category.
    structural
      ? db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.emiPlanId, id)))
      : db.update(transactions).set({ merchant: title, categoryId }).where(and(eq(transactions.userId, userId), eq(transactions.emiPlanId, id), isNull(transactions.deletedAt))),
  ]);
  await materializeById(db, userId, id, today);
  return dtoFor(db, userId, id, today);
}

/** Closes a plan early (foreclosure): no more instalments are added; the ones already there stay. */
export async function cancelPlan(db: Db, userId: string, id: string, today: IstDate): Promise<EmiPlanDto> {
  const row = await getPlanRow(db, userId, id);
  if (!row) throw new NotFoundError("EMI plan not found");
  if (row.cancelledAt) throw new ConflictError("That plan is already closed");
  await materializeById(db, userId, id, today);
  await db.update(emiPlans).set({ cancelledAt: nowIso() }).where(and(eq(emiPlans.userId, userId), eq(emiPlans.id, id)));
  return dtoFor(db, userId, id, today);
}

/** Opens a closed plan again; instalments that have come due since are added. */
export async function reopenPlan(db: Db, userId: string, id: string, today: IstDate): Promise<EmiPlanDto> {
  const row = await getPlanRow(db, userId, id);
  if (!row) throw new NotFoundError("EMI plan not found");
  if (!row.cancelledAt) throw new ConflictError("That plan is not closed");
  await db.update(emiPlans).set({ cancelledAt: null }).where(and(eq(emiPlans.userId, userId), eq(emiPlans.id, id)));
  await materializeById(db, userId, id, today);
  return dtoFor(db, userId, id, today);
}

/**
 * Removes a plan made by mistake. If instalments were already added, they go with it only when asked to
 * (`removeInstalments`); the instalments are the entries Alfred made, so the card's balance falls back accordingly.
 */
export async function deletePlan(db: Db, userId: string, id: string, removeInstalments = false): Promise<void> {
  const row = await getPlanRow(db, userId, id);
  if (!row) throw new NotFoundError("EMI plan not found");
  const made = (await entryCounts(db, userId)).get(id) ?? 0;
  if (made > 0 && !removeInstalments) {
    throw new ConflictError(`${made} instalment ${made === 1 ? "entry was" : "entries were"} already added. Delete the plan together with them, or close it instead.`);
  }
  await db.batch([
    db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.emiPlanId, id))),
    db.delete(emiPlans).where(and(eq(emiPlans.userId, userId), eq(emiPlans.id, id))),
  ]);
}
