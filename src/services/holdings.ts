import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getHoldingRow, type HoldingRow } from "../db/holdings";
import { accounts, holdings, holdingValues, transactions } from "../db/schema";
import { type IstDate, isValidIstDate } from "../domain/dates";
import { gainPaise, gainPct, type HoldingFacts, investedPaise, latestValue, soldPaise, staleDays, valuePaise } from "../domain/holdings";
import type { BuyHoldingData, CreateHoldingData, SellHoldingData, SetHoldingValueData, UpdateHoldingData } from "../schemas/holding";
import { newId, nowIso } from "../utils/id";

export interface HoldingEntryDto {
  id: string;
  kind: "buy" | "sell";
  amountPaise: number;
  date: IstDate;
  accountName: string | null;
  note: string | null;
}

export interface HoldingDto {
  id: string;
  name: string;
  kind: HoldingRow["kind"];
  status: "active" | "closed";
  openingInvestedPaise: number;
  /** Put in: what was invested before tracking plus every purchase. */
  investedPaise: number;
  /** Taken out: the proceeds of every sale. */
  soldPaise: number;
  valuePaise: number;
  /** The day the latest value was typed; null when none was. */
  valueDate: IstDate | null;
  staleDays: number | null;
  gainPaise: number;
  gainPct: number | null;
  entries: HoldingEntryDto[];
  /** The values typed, newest first (up to 12). */
  values: { date: IstDate; valuePaise: number }[];
}

export interface HoldingsOverview {
  totalValuePaise: number;
  totalInvestedPaise: number;
  gainPaise: number;
  holdings: HoldingDto[];
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);
const keyOf = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

function checkDate(path: string, date: string, today: IstDate) {
  if (!isValidIstDate(date)) throw invalid(path, "Not a real calendar date");
  if (date > today) throw invalid(path, "That date is in the future");
}

export interface LoadedHoldings {
  rows: HoldingRow[];
  facts: Map<string, HoldingFacts>;
  entries: Map<string, HoldingEntryDto[]>;
}

/** Everything about a person's holdings in three queries: the holdings, their typed values, and their linked entries. */
export async function loadHoldings(db: Db, userId: string): Promise<LoadedHoldings> {
  const [rows, values, txns, accountRows] = await Promise.all([
    db.select().from(holdings).where(eq(holdings.userId, userId)),
    db.select().from(holdingValues).where(eq(holdingValues.userId, userId)),
    db
      .select({ id: transactions.id, type: transactions.type, amountPaise: transactions.amountPaise, date: transactions.txnDate, holdingId: transactions.holdingId, accountId: transactions.accountId, note: transactions.note })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNotNull(transactions.holdingId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"), inArray(transactions.type, ["investment", "investment_sale"]))),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
  ]);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  const facts = new Map<string, HoldingFacts>(rows.map((r) => [r.id, { openingInvestedPaise: r.openingInvestedPaise, purchases: [], sales: [], values: [] }]));
  const entries = new Map<string, HoldingEntryDto[]>();
  const mutable = facts as Map<string, { openingInvestedPaise: number; purchases: { date: IstDate; amountPaise: number }[]; sales: { date: IstDate; amountPaise: number }[]; values: { date: IstDate; valuePaise: number }[] }>;
  for (const v of values) mutable.get(v.holdingId)?.values.push({ date: v.date, valuePaise: v.valuePaise });
  for (const t of txns) {
    const f = mutable.get(t.holdingId as string);
    if (!f) continue;
    const buy = t.type === "investment";
    (buy ? f.purchases : f.sales).push({ date: t.date, amountPaise: t.amountPaise });
    const list = entries.get(t.holdingId as string) ?? [];
    list.push({ id: t.id, kind: buy ? "buy" : "sell", amountPaise: t.amountPaise, date: t.date, accountName: accountName.get(t.accountId) ?? null, note: t.note });
    entries.set(t.holdingId as string, list);
  }
  return { rows, facts, entries };
}

function toDto(row: HoldingRow, f: HoldingFacts, entries: HoldingEntryDto[], today: IstDate): HoldingDto {
  const latest = latestValue(f, today);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    openingInvestedPaise: row.openingInvestedPaise,
    investedPaise: investedPaise(f, today),
    soldPaise: soldPaise(f, today),
    valuePaise: valuePaise(f, today),
    valueDate: latest?.date ?? null,
    staleDays: staleDays(f, today),
    gainPaise: gainPaise(f, today),
    gainPct: gainPct(f, today),
    entries: [...entries].sort((a, b) => b.date.localeCompare(a.date)),
    values: [...f.values].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12),
  };
}

/** Active holdings first, the most valuable first; closed ones after when asked for. */
export async function listHoldings(db: Db, userId: string, today: IstDate, status: "active" | "all"): Promise<HoldingsOverview> {
  const { rows, facts, entries } = await loadHoldings(db, userId);
  const dtos = rows
    .filter((r) => status === "all" || r.status === "active")
    .map((r) => toDto(r, facts.get(r.id) as HoldingFacts, entries.get(r.id) ?? [], today))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || b.valuePaise - a.valuePaise || a.name.localeCompare(b.name));
  const live = dtos.filter((h) => h.status === "active");
  return {
    totalValuePaise: live.reduce((s, h) => s + h.valuePaise, 0),
    totalInvestedPaise: live.reduce((s, h) => s + h.investedPaise, 0),
    gainPaise: live.reduce((s, h) => s + h.gainPaise, 0),
    holdings: dtos,
  };
}

/** What the active holdings are worth now, for net worth. */
export async function holdingsValue(db: Db, userId: string, today: IstDate): Promise<number> {
  const { rows, facts } = await loadHoldings(db, userId);
  return rows.filter((r) => r.status === "active").reduce((s, r) => s + valuePaise(facts.get(r.id) as HoldingFacts, today), 0);
}

export async function getHolding(db: Db, userId: string, id: string, today: IstDate): Promise<HoldingDto> {
  const found = (await listHoldings(db, userId, today, "all")).holdings.find((h) => h.id === id);
  if (!found) throw new NotFoundError("Holding not found");
  return found;
}

async function requireActive(db: Db, userId: string, id: string): Promise<HoldingRow> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  if (row.status !== "active") throw new ConflictError("That holding is closed. Reopen it first.");
  return row;
}

async function requireFreeName(db: Db, userId: string, name: string, exceptId?: string) {
  const key = keyOf(name);
  const active = await db.select({ id: holdings.id, name: holdings.name }).from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.status, "active")));
  if (active.some((h) => h.id !== exceptId && keyOf(h.name) === key)) throw invalid("name", "You already have a holding with that name");
}

async function requireBank(db: Db, userId: string, accountId: string) {
  const account = await getAccount(db, userId, accountId);
  if (!account) throw new NotFoundError("Account not found");
  if (account.kind !== "bank") throw invalid("accountId", "Buying and selling go through a bank account");
  if (account.archivedAt) throw invalid("accountId", "That account is archived");
  return account;
}

function putValue(db: Db, userId: string, holdingId: string, date: IstDate, value: number) {
  return db
    .insert(holdingValues)
    .values({ id: newId(), userId, holdingId, date, valuePaise: value, createdAt: nowIso() })
    .onConflictDoUpdate({ target: [holdingValues.holdingId, holdingValues.date], set: { valuePaise: value, createdAt: nowIso() } });
}

export async function createHolding(db: Db, userId: string, input: CreateHoldingData, today: IstDate): Promise<HoldingDto> {
  const valueDate = input.valueDate ?? today;
  if (input.valuePaise !== undefined) checkDate("valueDate", valueDate, today);
  await requireFreeName(db, userId, input.name);
  const id = newId();
  await db.insert(holdings).values({ id, userId, name: tidy(input.name), kind: input.kind, openingInvestedPaise: input.investedPaise ?? 0, createdAt: nowIso() });
  if (input.valuePaise !== undefined) await putValue(db, userId, id, valueDate, input.valuePaise);
  return getHolding(db, userId, id, today);
}

export async function updateHolding(db: Db, userId: string, id: string, patch: UpdateHoldingData, today: IstDate): Promise<HoldingDto> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  if (patch.name !== undefined && row.status === "active") await requireFreeName(db, userId, patch.name, id);
  await db
    .update(holdings)
    .set({ name: patch.name === undefined ? row.name : tidy(patch.name), kind: patch.kind ?? row.kind })
    .where(and(eq(holdings.id, id), eq(holdings.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** Types a new value for today (or an earlier day); a second value for the same day replaces the first. */
export async function setValue(db: Db, userId: string, id: string, input: SetHoldingValueData, today: IstDate): Promise<HoldingDto> {
  await requireActive(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  await putValue(db, userId, id, date, input.valuePaise);
  return getHolding(db, userId, id, today);
}

function entryRow(userId: string, holdingId: string, type: "investment" | "investment_sale", input: { amountPaise: number; accountId: string; date: IstDate; note: string | null }, name: string) {
  const now = nowIso();
  return {
    id: newId(),
    userId,
    type,
    amountPaise: input.amountPaise,
    txnDate: input.date,
    accountId: input.accountId,
    toAccountId: null,
    categoryId: null,
    merchant: name,
    note: input.note,
    holdingId,
    status: "confirmed" as const,
    source: "web" as const,
    createdAt: now,
    updatedAt: now,
  };
}

/** Buying more: an Investment entry out of the chosen bank, linked to the holding. */
export async function buy(db: Db, userId: string, id: string, input: BuyHoldingData, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  await requireBank(db, userId, input.accountId);
  const before = await getHolding(db, userId, id, today);
  await db.insert(transactions).values(entryRow(userId, id, "investment", { amountPaise: input.amountPaise, accountId: input.accountId, date, note: input.note ?? null }, row.name));
  // A value typed on the same day cannot tell which came first, so the purchase moves it.
  if (before.valueDate === date) await putValue(db, userId, id, date, before.valuePaise + input.amountPaise);
  return getHolding(db, userId, id, today);
}

/** Selling: the proceeds come into the chosen bank. Selling everything can close the holding in the same step. */
export async function sell(db: Db, userId: string, id: string, input: SellHoldingData, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  await requireBank(db, userId, input.accountId);
  const before = await getHolding(db, userId, id, today);
  if (before.valuePaise <= 0) throw invalid("amountPaise", "There is nothing left in this holding to sell");
  await db.insert(transactions).values(entryRow(userId, id, "investment_sale", { amountPaise: input.amountPaise, accountId: input.accountId, date, note: input.note ?? null }, row.name));
  // As with buying, a value typed on the same day is moved by the sale.
  if (before.valueDate === date) await putValue(db, userId, id, date, Math.max(0, before.valuePaise - input.amountPaise));
  if (input.closeOut) await closeRow(db, userId, row, date);
  return getHolding(db, userId, id, today);
}

async function closeRow(db: Db, userId: string, row: HoldingRow, date: IstDate) {
  await putValue(db, userId, row.id, date, 0);
  await db.update(holdings).set({ status: "closed", closedAt: nowIso() }).where(and(eq(holdings.id, row.id), eq(holdings.userId, userId)));
}

/** Stops counting it without a sale: its value goes to nothing from today. */
export async function closeHolding(db: Db, userId: string, id: string, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  await closeRow(db, userId, row, today);
  return getHolding(db, userId, id, today);
}

export async function reopenHolding(db: Db, userId: string, id: string, today: IstDate): Promise<HoldingDto> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  if (row.status === "active") throw new ConflictError("That holding is not closed");
  await requireFreeName(db, userId, row.name, id);
  await db.update(holdings).set({ status: "active", closedAt: null }).where(and(eq(holdings.id, id), eq(holdings.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** Only a holding with no entries linked to it can be removed; otherwise close it. */
export async function deleteHolding(db: Db, userId: string, id: string): Promise<void> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  const linked = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.holdingId, id), isNull(transactions.deletedAt))).limit(1);
  if (linked.length > 0) throw new ConflictError("Entries are linked to this holding. Close it instead.");
  await db.batch([db.delete(holdingValues).where(and(eq(holdingValues.holdingId, id), eq(holdingValues.userId, userId))), db.delete(holdings).where(and(eq(holdings.id, id), eq(holdings.userId, userId)))]);
}

/**
 * An allotted IPO becomes a holding: added to an active one of the same name, or a new Stock holding valued at what
 * was paid. The investment entry is linked to it.
 */
export async function attachAllotment(db: Db, userId: string, input: { name: string; txnId: string; amountPaise: number; date: IstDate }): Promise<string> {
  const active = await db.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.status, "active")));
  const found = active.find((h) => keyOf(h.name) === keyOf(input.name));
  let holdingId = found?.id;
  if (!holdingId) {
    holdingId = newId();
    await db.insert(holdings).values({ id: holdingId, userId, name: tidy(input.name).slice(0, 40), kind: "stock", openingInvestedPaise: 0, createdAt: nowIso() });
    await putValue(db, userId, holdingId, input.date, input.amountPaise);
  }
  await db.update(transactions).set({ holdingId }).where(and(eq(transactions.userId, userId), eq(transactions.id, input.txnId)));
  return holdingId;
}
