import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount } from "../db/accounts";
import { getHoldingRow, type HoldingRow } from "../db/holdings";
import { getKindByKey, getKindRow, type HoldingKindRow, kindsByKey } from "../db/holdingKinds";
import { getRuleRow, parseSkips } from "../db/recurring";
import { accounts, holdingContributions, holdingLots, holdings, holdingValues, investmentAccounts, recurringRules, transactions } from "../db/schema";
import { type IstDate, isValidIstDate } from "../domain/dates";
import { formatRupees } from "../domain/money";
import { avgCostPaise, gainPaise, gainPct, type HoldingFacts, type UnitsFacts, investedPaise, latestRate, latestValue, soldPaise, staleDays, unitOne, unitsHeldE4, valueAtRate, valuePaise } from "../domain/holdings";
import type { AddContributionData, AddLotData, BuyHoldingData, ConvertHoldingData, CreateHoldingData, EditEntryData, EditLotData, SellHoldingData, SetHoldingRateData, SetHoldingValueData, UpdateHoldingData } from "../schemas/holding";
import { newId, nowIso } from "../utils/id";
import { checkBrokerRule, requireUsableInvestmentAccount } from "./investmentAccounts";

export interface HoldingEntryDto {
  id: string;
  kind: "buy" | "sell";
  amountPaise: number;
  date: IstDate;
  accountId: string;
  accountName: string | null;
  note: string | null;
  /** The quantity, when counted by quantity: null when it was not given, 0 when it was part of what was held at the switch. */
  unitsE4: number | null;
}

export interface HoldingLotDto {
  id: string;
  date: IstDate;
  unitsE4: number;
  costPaise: number;
  note: string | null;
}

/** Money put in with no bank entry (an EPF month). A pension share is its own entry on another investment, linked to this one. */
export interface HoldingContributionDto {
  id: string;
  date: IstDate;
  ownPaise: number;
  employerPaise: number;
  note: string | null;
  /** The entry it is linked to. This entry's own role: "primary" is the one the person made (its pension share went to the linked investment); "pension" is the one created from the other investment's entry. */
  linked: { role: "pension" | "primary"; holdingId: string; holdingName: string; paise: number } | null;
}

export interface HoldingDto {
  id: string;
  name: string;
  /** The key of its investment kind, and the kind's name. */
  kind: string;
  kindName: string;
  status: "active" | "closed";
  /** The broker or demat account it is held in, and its name; null until chosen. */
  investmentAccountId: string | null;
  accountName: string | null;
  /** Part of the emergency fund. */
  isEmergency: boolean;
  /** Counted in the FIRE corpus. */
  countsForFire: boolean;
  openingInvestedPaise: number;
  /** Held before tracking, in 1/10,000 of a unit (counted by quantity only). */
  openingUnitsE4: number;
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
  values: { date: IstDate; valuePaise: number; ratePaise: number | null }[];
  tracking: "value" | "units";
  /** Counted by quantity: the unit ("g", "units", "shares"), the quantity a rate is quoted for, and the quantity held. */
  unitLabel: string | null;
  /** The unit for one ("share"), for wording like "per share". */
  unitOne: string | null;
  ratePer: number;
  unitsHeldE4: number;
  /** The latest rate typed, and the average price paid quoted the same way. */
  ratePaise: number | null;
  avgCostPaise: number | null;
  lots: HoldingLotDto[];
  /** Money put in with no bank entry, newest first. */
  contributions: HoldingContributionDto[];
  /** Buys or sells with no quantity, which the held quantity cannot count. */
  missingUnits: number;
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
  lots: Map<string, HoldingLotDto[]>;
  contributions: Map<string, HoldingContributionDto[]>;
  kinds: Map<string, HoldingKindRow>;
  /** The person's broker accounts, by id. */
  brokers: Map<string, string>;
}

/** Everything about a person's holdings in three queries: the holdings, their typed values, and their linked entries. */
export async function loadHoldings(db: Db, userId: string): Promise<LoadedHoldings> {
  const [rows, values, txns, accountRows, lotRows, kinds, brokerRows, contributionRows] = await Promise.all([
    db.select().from(holdings).where(eq(holdings.userId, userId)),
    db.select().from(holdingValues).where(eq(holdingValues.userId, userId)),
    db
      .select({ id: transactions.id, type: transactions.type, amountPaise: transactions.amountPaise, date: transactions.txnDate, holdingId: transactions.holdingId, accountId: transactions.accountId, note: transactions.note, unitsE4: transactions.unitsE4 })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNotNull(transactions.holdingId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"), inArray(transactions.type, ["investment", "investment_sale"]))),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
    db.select().from(holdingLots).where(eq(holdingLots.userId, userId)),
    kindsByKey(db, userId),
    db.select({ id: investmentAccounts.id, name: investmentAccounts.name }).from(investmentAccounts).where(eq(investmentAccounts.userId, userId)),
    db.select().from(holdingContributions).where(eq(holdingContributions.userId, userId)),
  ]);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  type Mutable = {
    openingInvestedPaise: number;
    purchases: { date: IstDate; amountPaise: number }[];
    sales: { date: IstDate; amountPaise: number }[];
    values: { date: IstDate; valuePaise: number }[];
    units?: { ratePer: number; openingUnitsE4: number; lots: { date: IstDate; unitsE4: number }[]; buys: { date: IstDate; unitsE4: number }[]; sells: { date: IstDate; unitsE4: number }[]; rates: { date: IstDate; ratePaise: number }[] };
  };
  const facts = new Map<string, Mutable>(
    rows.map((r) => {
      const f: Mutable = { openingInvestedPaise: r.openingInvestedPaise, purchases: [], sales: [], values: [] };
      if (r.tracking === "units") f.units = { ratePer: kinds.get(r.kind)?.ratePer ?? 1, openingUnitsE4: r.openingUnitsE4, lots: [], buys: [], sells: [], rates: [] };
      return [r.id, f];
    }),
  );
  for (const v of values) {
    const f = facts.get(v.holdingId);
    if (!f) continue;
    f.values.push({ date: v.date, valuePaise: v.valuePaise });
    if (f.units && v.ratePaise !== null) f.units.rates.push({ date: v.date, ratePaise: v.ratePaise });
  }
  const entries = new Map<string, HoldingEntryDto[]>();
  for (const t of txns) {
    const f = facts.get(t.holdingId as string);
    if (!f) continue;
    const buy = t.type === "investment";
    (buy ? f.purchases : f.sales).push({ date: t.date, amountPaise: t.amountPaise });
    if (f.units) (buy ? f.units.buys : f.units.sells).push({ date: t.date, unitsE4: t.unitsE4 ?? 0 });
    const list = entries.get(t.holdingId as string) ?? [];
    list.push({ id: t.id, kind: buy ? "buy" : "sell", amountPaise: t.amountPaise, date: t.date, accountId: t.accountId, accountName: accountName.get(t.accountId) ?? null, note: t.note, unitsE4: t.unitsE4 });
    entries.set(t.holdingId as string, list);
  }
  const lots = new Map<string, HoldingLotDto[]>();
  for (const l of lotRows) {
    const f = facts.get(l.holdingId);
    if (!f?.units) continue;
    f.units.lots.push({ date: l.date, unitsE4: l.unitsE4 });
    f.purchases.push({ date: l.date, amountPaise: l.costPaise });
    const list = lots.get(l.holdingId) ?? [];
    list.push({ id: l.id, date: l.date, unitsE4: l.unitsE4, costPaise: l.costPaise, note: l.note });
    lots.set(l.holdingId, list);
  }
  // Money put in with no bank entry counts as put in from its day, like a purchase.
  const holdingName = new Map(rows.map((r) => [r.id, r.name]));
  const contributions = new Map<string, HoldingContributionDto[]>();
  for (const c of contributionRows) {
    const f = facts.get(c.holdingId);
    if (!f) continue;
    f.purchases.push({ date: c.date, amountPaise: c.ownPaise + c.employerPaise });
    const partner = c.linkId ? contributionRows.find((o) => o.linkId === c.linkId && o.id !== c.id) : undefined;
    const list = contributions.get(c.holdingId) ?? [];
    list.push({
      id: c.id,
      date: c.date,
      ownPaise: c.ownPaise,
      employerPaise: c.employerPaise,
      note: c.note,
      linked: partner && c.linkRole ? { role: c.linkRole, holdingId: partner.holdingId, holdingName: holdingName.get(partner.holdingId) ?? "", paise: partner.ownPaise + partner.employerPaise } : null,
    });
    contributions.set(c.holdingId, list);
  }
  return { rows, facts: facts as Map<string, HoldingFacts>, entries, lots, contributions, kinds, brokers: new Map(brokerRows.map((b) => [b.id, b.name])) };
}

function toDto(row: HoldingRow, f: HoldingFacts, entries: HoldingEntryDto[], lots: HoldingLotDto[], contributions: HoldingContributionDto[], today: IstDate, kind?: HoldingKindRow, brokerName: string | null = null): HoldingDto {
  const rate = f.units ? latestRate(f.units, today) : null;
  const latest = f.units ? rate : latestValue(f, today);
  const unit = f.units ? (kind?.unit ?? null) : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    kindName: kind?.name ?? row.kind,
    status: row.status,
    investmentAccountId: brokerName === null ? null : row.investmentAccountId,
    accountName: brokerName,
    isEmergency: row.isEmergency,
    countsForFire: row.countsForFire,
    openingInvestedPaise: row.openingInvestedPaise,
    openingUnitsE4: row.openingUnitsE4,
    investedPaise: investedPaise(f, today),
    soldPaise: soldPaise(f, today),
    valuePaise: valuePaise(f, today),
    valueDate: latest?.date ?? null,
    staleDays: staleDays(f, today),
    gainPaise: gainPaise(f, today),
    gainPct: gainPct(f, today),
    entries: [...entries].sort((a, b) => b.date.localeCompare(a.date)),
    values: [...f.values]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12)
      .map((v) => ({ ...v, ratePaise: f.units?.rates.find((r) => r.date === v.date)?.ratePaise ?? null })),
    tracking: row.tracking,
    unitLabel: unit,
    unitOne: unit ? unitOne(unit) : null,
    ratePer: f.units?.ratePer ?? 1,
    unitsHeldE4: f.units ? unitsHeldE4(f.units, today) : 0,
    ratePaise: rate?.ratePaise ?? null,
    avgCostPaise: avgCostPaise(f, today),
    lots: [...lots].sort((a, b) => b.date.localeCompare(a.date)),
    contributions: [...contributions].sort((a, b) => b.date.localeCompare(a.date)),
    missingUnits: f.units ? entries.filter((e) => e.unitsE4 === null).length : 0,
  };
}

/** Active holdings first, the most valuable first; closed ones after when asked for. */
export async function listHoldings(db: Db, userId: string, today: IstDate, status: "active" | "all"): Promise<HoldingsOverview> {
  const { rows, facts, entries, lots, contributions, kinds, brokers } = await loadHoldings(db, userId);
  const dtos = rows
    .filter((r) => status === "all" || r.status === "active")
    .map((r) => toDto(r, facts.get(r.id) as HoldingFacts, entries.get(r.id) ?? [], lots.get(r.id) ?? [], contributions.get(r.id) ?? [], today, kinds.get(r.kind), r.investmentAccountId ? (brokers.get(r.investmentAccountId) ?? null) : null))
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

/** A name is free when no other active holding in the same broker account has it: the same stock may sit in two accounts. */
async function requireFreeName(db: Db, userId: string, name: string, accountId: string | null, exceptId?: string) {
  const key = keyOf(name);
  const active = await db.select({ id: holdings.id, name: holdings.name, account: holdings.investmentAccountId }).from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.status, "active")));
  if (active.some((h) => h.id !== exceptId && h.account === accountId && keyOf(h.name) === key)) throw invalid("name", accountId === null ? "You already have a holding with that name" : "That account already holds an investment with that name");
}

/** The person's kind for a key, which must exist and not be archived. */
async function requireKind(db: Db, userId: string, key: string): Promise<HoldingKindRow> {
  const kind = await getKindByKey(db, userId, key);
  if (!kind) throw invalid("kind", "That kind of investment does not exist");
  if (kind.archivedAt) throw invalid("kind", `${kind.name} is archived. Restore it or choose another kind.`);
  return kind;
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
  const counted = input.tracking === "units";
  if (input.valuePaise !== undefined || input.ratePaise !== undefined) checkDate("valueDate", valueDate, today);
  const kind = await requireKind(db, userId, input.kind);
  if (counted && !kind.unit) throw invalid("kind", `${kind.name} has no unit, so it is valued by typing what it is worth`);
  if (!counted && (input.unitsE4 !== undefined || input.ratePaise !== undefined)) throw invalid("tracking", "A quantity and a rate need tracking by quantity");
  if (counted && input.valuePaise !== undefined) throw invalid("valuePaise", "Counted by quantity, the worth comes from the rate");
  const accountId = input.investmentAccountId ?? null;
  if (accountId !== null) await requireUsableInvestmentAccount(db, userId, accountId);
  await checkBrokerRule(db, userId, kind, tidy(input.name), accountId);
  await requireFreeName(db, userId, input.name, accountId);
  const id = newId();
  const held = counted ? (input.unitsE4 ?? 0) : 0;
  await db.insert(holdings).values({ id, userId, name: tidy(input.name), kind: input.kind, openingInvestedPaise: input.investedPaise ?? 0, tracking: counted ? "units" : "value", openingUnitsE4: held, investmentAccountId: accountId, createdAt: nowIso() });
  if (input.valuePaise !== undefined) await putValue(db, userId, id, valueDate, input.valuePaise);
  if (counted && input.ratePaise !== undefined) await putRate(db, userId, id, valueDate, input.ratePaise, held, kind.ratePer);
  return getHolding(db, userId, id, today);
}

export async function updateHolding(db: Db, userId: string, id: string, patch: UpdateHoldingData, today: IstDate): Promise<HoldingDto> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  const accountId = patch.investmentAccountId === undefined ? row.investmentAccountId : patch.investmentAccountId;
  if (patch.investmentAccountId !== undefined && accountId !== null && accountId !== row.investmentAccountId) await requireUsableInvestmentAccount(db, userId, accountId);
  if (row.status === "active" && (patch.name !== undefined || accountId !== row.investmentAccountId)) await requireFreeName(db, userId, patch.name ?? row.name, accountId, id);
  // The kind's broker rule is checked when the kind or the account changes; an edit that touches neither is never held up by it.
  if ((patch.kind !== undefined && patch.kind !== row.kind) || accountId !== row.investmentAccountId) {
    const nextKind = await requireKind(db, userId, patch.kind ?? row.kind);
    await checkBrokerRule(db, userId, nextKind, patch.name === undefined ? row.name : tidy(patch.name), accountId);
  }
  if (patch.kind !== undefined && patch.kind !== row.kind) {
    const next = await requireKind(db, userId, patch.kind);
    if (row.tracking === "units") {
      const current = await getKindByKey(db, userId, row.kind);
      if ((current?.unit ?? null) !== next.unit || (current?.ratePer ?? 1) !== next.ratePer) throw invalid("kind", "Counted by quantity, it can only move to a kind with the same unit and rate");
    }
  }
  // The total put in: what bank purchases already show stays, and the rest is what was put in before (such as EPF contributions with no bank entry).
  let openingInvested = row.openingInvestedPaise;
  let openingUnits = row.openingUnitsE4;
  if (patch.investedPaise !== undefined && patch.openingInvestedPaise !== undefined) throw invalid("investedPaise", "Send the total put in or the opening amount, not both");
  if (patch.openingInvestedPaise !== undefined) openingInvested = patch.openingInvestedPaise;
  if (patch.openingUnitsE4 !== undefined) {
    if (row.tracking !== "units") throw invalid("openingUnitsE4", "This investment is valued by typing what it is worth, so it has no quantity");
    const { facts } = await loadHoldings(db, userId);
    const u = (facts.get(id) as HoldingFacts).units as UnitsFacts;
    if (rawUnits(u) - u.openingUnitsE4 + patch.openingUnitsE4 < 0) throw invalid("openingUnitsE4", "That would leave less than nothing held. Change the sales first.");
    openingUnits = patch.openingUnitsE4;
  }
  if (patch.investedPaise !== undefined) {
    if (row.tracking !== "value") throw invalid("investedPaise", "Counted by quantity, what was put in comes from its purchases");
    const { facts } = await loadHoldings(db, userId);
    const bought = (facts.get(id)?.purchases ?? []).reduce((sum, p) => sum + p.amountPaise, 0);
    if (patch.investedPaise < bought) throw invalid("investedPaise", `That is less than the ${formatRupees(bought)} your entries already show`);
    openingInvested = patch.investedPaise - bought;
  }
  await db
    .update(holdings)
    .set({ name: patch.name === undefined ? row.name : tidy(patch.name), kind: patch.kind ?? row.kind, isEmergency: patch.isEmergency ?? row.isEmergency, countsForFire: patch.countsForFire ?? row.countsForFire, investmentAccountId: accountId, openingInvestedPaise: openingInvested, openingUnitsE4: openingUnits })
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

/** A rate typed for a day; the total it makes (at the quantity held then) is kept beside it so every reader of values keeps working. */
function putRate(db: Db, userId: string, holdingId: string, date: IstDate, ratePaise: number, unitsE4: number, ratePer: number) {
  const value = valueAtRate(unitsE4, ratePaise, ratePer);
  return db
    .insert(holdingValues)
    .values({ id: newId(), userId, holdingId, date, valuePaise: value, ratePaise, createdAt: nowIso() })
    .onConflictDoUpdate({ target: [holdingValues.holdingId, holdingValues.date], set: { valuePaise: value, ratePaise, createdAt: nowIso() } });
}

async function requireCounted(db: Db, userId: string, id: string): Promise<HoldingRow> {
  const row = await requireActive(db, userId, id);
  if (row.tracking !== "units") throw invalid("tracking", "This investment is valued by typing what it is worth. Switch it to quantity first.");
  return row;
}

/** Types today's rate (or an earlier day's). The worth follows from the quantity held. */
export async function setRate(db: Db, userId: string, id: string, input: SetHoldingRateData, today: IstDate): Promise<HoldingDto> {
  const row = await requireCounted(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  const { facts } = await loadHoldings(db, userId);
  const f = facts.get(id) as HoldingFacts;
  await putRate(db, userId, id, date, input.ratePaise, f.units ? unitsHeldE4(f.units, date) : 0, (await getKindByKey(db, userId, row.kind))?.ratePer ?? 1);
  return getHolding(db, userId, id, today);
}

/**
 * One rate for a kind: gold or silver quoted once. It is put on every active holding of the kind that is counted by quantity and
 * is not in a broker account, so a gold ETF in a demat account keeps its own price.
 */
export async function setKindRate(db: Db, userId: string, kindId: string, input: SetHoldingRateData, today: IstDate): Promise<{ updated: number }> {
  const kind = await getKindRow(db, userId, kindId);
  if (!kind) throw new NotFoundError("Investment kind not found");
  if (!kind.unit) throw invalid("kind", `${kind.name} is valued by typing what it is worth, so it has no rate`);
  const date = input.date ?? today;
  checkDate("date", date, today);
  const { rows, facts } = await loadHoldings(db, userId);
  const targets = rows.filter((h) => h.kind === kind.key && h.status === "active" && h.tracking === "units" && h.investmentAccountId === null);
  if (targets.length === 0) throw invalid("kind", `You have no ${kind.name} counted by quantity outside a broker account`);
  for (const h of targets) {
    const f = facts.get(h.id) as HoldingFacts;
    await putRate(db, userId, h.id, date, input.ratePaise, f.units ? unitsHeldE4(f.units, date) : 0, kind.ratePer);
  }
  return { updated: targets.length };
}

/**
 * Money put into an investment valued by typing with no bank entry, such as a month's EPF contribution: the person's share, the
 * employer's, and a pension share that becomes a linked entry on another such investment. It counts as put in from its day, and
 * raises the worth when it is dated after the latest value typed.
 */
export async function addContribution(db: Db, userId: string, id: string, input: AddContributionData, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  if (row.tracking !== "value") throw invalid("tracking", "Counted by quantity, what was put in comes from its purchases");
  checkDate("date", input.date, today);
  const own = input.ownPaise ?? 0;
  const employer = input.employerPaise ?? 0;
  const pension = input.pensionPaise ?? 0;
  if (own + employer <= 0) throw invalid("ownPaise", "Enter your share or the employer's");
  let target: HoldingRow | null = null;
  if (pension > 0) {
    if (!input.pensionHoldingId) throw invalid("pensionHoldingId", "Choose the investment the pension share goes to");
    if (input.pensionHoldingId === id) throw invalid("pensionHoldingId", "The pension share goes to a different investment");
    target = await requireActive(db, userId, input.pensionHoldingId);
    if (target.tracking !== "value") throw invalid("pensionHoldingId", `${target.name} is counted by quantity, so it cannot take a contribution`);
  }
  await db.insert(holdingContributions).values(contributionRows(userId, id, input.date, own, employer, target ? { holdingId: target.id, pensionPaise: pension } : null, input.note?.trim() || null));
  return getHolding(db, userId, id, today);
}

/**
 * The rows of one contribution: the entry on the investment, and the pension entry on another when there is a pension share
 * (the two share a link). `recurring` marks the entry a rule made for a due day, on the entry itself and never on the pension one.
 */
export function contributionRows(
  userId: string,
  holdingId: string,
  date: IstDate,
  ownPaise: number,
  employerPaise: number,
  pension: { holdingId: string; pensionPaise: number } | null,
  note: string | null,
  recurring?: { ruleId: string; on: IstDate },
) {
  const linkId = pension ? newId() : null;
  const make = (h: string, own: number, employer: number, linkRole: "primary" | "pension" | null) =>
    ({ id: newId(), userId, holdingId: h, date, ownPaise: own, employerPaise: employer, linkId, linkRole, note, createdAt: nowIso() }) satisfies typeof holdingContributions.$inferInsert;
  const primary = { ...make(holdingId, ownPaise, employerPaise, pension ? "primary" : null), recurringRuleId: recurring?.ruleId ?? null, recurringOn: recurring?.on ?? null };
  return pension ? [primary, make(pension.holdingId, 0, pension.pensionPaise, "pension")] : [primary];
}

/** Removes a contribution, and the pension entry it created (or the entry a pension share came from). */
export async function removeContribution(db: Db, userId: string, id: string, contributionId: string, today: IstDate): Promise<HoldingDto> {
  const [found] = await db.select().from(holdingContributions).where(and(eq(holdingContributions.userId, userId), eq(holdingContributions.holdingId, id), eq(holdingContributions.id, contributionId))).limit(1);
  if (!found) throw new NotFoundError("Contribution not found");
  const pair = found.linkId ? await db.select().from(holdingContributions).where(and(eq(holdingContributions.userId, userId), eq(holdingContributions.linkId, found.linkId))) : [found];
  await db.delete(holdingContributions).where(and(eq(holdingContributions.userId, userId), found.linkId ? eq(holdingContributions.linkId, found.linkId) : eq(holdingContributions.id, found.id)));
  // A month a rule made and the person removed is skipped by that rule, so the next daily run does not make it again.
  for (const made of pair.filter((c) => c.recurringRuleId && c.recurringOn)) {
    const rule = await getRuleRow(db, userId, made.recurringRuleId as string);
    if (!rule) continue;
    const skips = [...new Set([...parseSkips(rule.skipsJson), made.recurringOn as string])].sort();
    await db.update(recurringRules).set({ skipsJson: JSON.stringify(skips) }).where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, rule.id)));
  }
  return getHolding(db, userId, id, today);
}

/** The quantity after every purchase and sale, not held at nothing: below zero means more was sold than bought. */
function rawUnits(u: UnitsFacts): number {
  const total = (list: readonly { unitsE4: number }[]) => list.reduce((s, e) => s + e.unitsE4, 0);
  return u.openingUnitsE4 + total(u.lots) + total(u.buys) - total(u.sells);
}

async function findEntry(db: Db, userId: string, id: string, txnId: string) {
  const [t] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, txnId), eq(transactions.userId, userId), eq(transactions.holdingId, id), isNull(transactions.deletedAt), inArray(transactions.type, ["investment", "investment_sale"])))
    .limit(1);
  if (!t) throw new NotFoundError("Entry not found");
  return t;
}

/** Corrects a buy or a sale made through a bank account. Only what is sent changes; the quantity must stay at or above nothing. */
export async function editEntry(db: Db, userId: string, id: string, txnId: string, patch: EditEntryData, today: IstDate): Promise<HoldingDto> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  const t = await findEntry(db, userId, id, txnId);
  if (patch.date !== undefined) checkDate("date", patch.date, today);
  if (patch.accountId !== undefined) await requireBank(db, userId, patch.accountId);
  const counted = row.tracking === "units";
  if (patch.unitsE4 !== undefined && !counted) throw invalid("unitsE4", "This investment is valued by typing what it is worth");
  if (counted && patch.unitsE4 !== undefined) {
    const { facts } = await loadHoldings(db, userId);
    const sign = t.type === "investment" ? 1 : -1;
    if (rawUnits((facts.get(id) as HoldingFacts).units as UnitsFacts) + sign * (patch.unitsE4 - (t.unitsE4 ?? 0)) < 0) throw invalid("unitsE4", "That would leave less than nothing held. Change the other entries first.");
  }
  const set: Partial<typeof transactions.$inferInsert> = { updatedAt: nowIso() };
  if (patch.amountPaise !== undefined) set.amountPaise = patch.amountPaise;
  if (patch.date !== undefined) set.txnDate = patch.date;
  if (patch.accountId !== undefined) set.accountId = patch.accountId;
  if (patch.unitsE4 !== undefined) set.unitsE4 = patch.unitsE4;
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  await db.update(transactions).set(set).where(and(eq(transactions.id, txnId), eq(transactions.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** Removes a buy or a sale. Removing a purchase that later sales came out of is refused until those sales are changed. */
export async function removeEntry(db: Db, userId: string, id: string, txnId: string, today: IstDate): Promise<HoldingDto> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  const t = await findEntry(db, userId, id, txnId);
  if (row.tracking === "units" && t.type === "investment") {
    const { facts } = await loadHoldings(db, userId);
    if (rawUnits((facts.get(id) as HoldingFacts).units as UnitsFacts) - (t.unitsE4 ?? 0) < 0) throw invalid("txnId", "Sales came out of this purchase. Change or remove those first.");
  }
  const now = nowIso();
  await db.update(transactions).set({ deletedAt: now, updatedAt: now }).where(and(eq(transactions.id, txnId), eq(transactions.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** Corrects a purchase from before tracking. Only what is sent changes. */
export async function editLot(db: Db, userId: string, id: string, lotId: string, patch: EditLotData, today: IstDate): Promise<HoldingDto> {
  await requireCounted(db, userId, id);
  const [lot] = await db.select().from(holdingLots).where(and(eq(holdingLots.id, lotId), eq(holdingLots.holdingId, id), eq(holdingLots.userId, userId))).limit(1);
  if (!lot) throw new NotFoundError("Purchase not found");
  if (patch.date !== undefined) checkDate("date", patch.date, today);
  if (patch.unitsE4 !== undefined) {
    const { facts } = await loadHoldings(db, userId);
    if (rawUnits((facts.get(id) as HoldingFacts).units as UnitsFacts) - lot.unitsE4 + patch.unitsE4 < 0) throw invalid("unitsE4", "That would leave less than nothing held. Change the sales first.");
  }
  const set: Partial<typeof holdingLots.$inferInsert> = {};
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.unitsE4 !== undefined) set.unitsE4 = patch.unitsE4;
  if (patch.costPaise !== undefined) set.costPaise = patch.costPaise;
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  if (Object.keys(set).length > 0) await db.update(holdingLots).set(set).where(and(eq(holdingLots.id, lotId), eq(holdingLots.userId, userId)));
  return getHolding(db, userId, id, today);
}

/**
 * Corrects a month of contributions: the same fields as adding one, replacing what was there. The pension share updates its linked
 * entry, creates one when it is new, or removes it when it is dropped. The pension side of a pair is changed from the entry it
 * came from.
 */
export async function editContribution(db: Db, userId: string, id: string, contributionId: string, input: AddContributionData, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  if (row.tracking !== "value") throw invalid("tracking", "Counted by quantity, what was put in comes from its purchases");
  const [c] = await db.select().from(holdingContributions).where(and(eq(holdingContributions.id, contributionId), eq(holdingContributions.holdingId, id), eq(holdingContributions.userId, userId))).limit(1);
  if (!c) throw new NotFoundError("Contribution not found");
  const partner = c.linkId ? (await db.select().from(holdingContributions).where(and(eq(holdingContributions.linkId, c.linkId), eq(holdingContributions.userId, userId)))).find((o) => o.id !== c.id) : undefined;
  if (c.linkRole === "pension") {
    const other = partner ? ((await getHoldingRow(db, userId, partner.holdingId))?.name ?? "the other investment") : "the other investment";
    throw new ConflictError(`This is the pension share of an entry on ${other}. Change it there.`);
  }
  checkDate("date", input.date, today);
  const own = input.ownPaise ?? 0;
  const employer = input.employerPaise ?? 0;
  const pension = input.pensionPaise ?? 0;
  if (own + employer <= 0) throw invalid("ownPaise", "Enter your share or the employer's");
  let target: HoldingRow | null = null;
  if (pension > 0) {
    if (!input.pensionHoldingId) throw invalid("pensionHoldingId", "Choose the investment the pension share goes to");
    if (input.pensionHoldingId === id) throw invalid("pensionHoldingId", "The pension share goes to a different investment");
    target = await requireActive(db, userId, input.pensionHoldingId);
    if (target.tracking !== "value") throw invalid("pensionHoldingId", `${target.name} is counted by quantity, so it cannot take a contribution`);
  }
  const note = input.note?.trim() || null;
  let linkId = c.linkId;
  if (target) {
    if (partner) {
      await db.update(holdingContributions).set({ holdingId: target.id, date: input.date, ownPaise: 0, employerPaise: pension, note }).where(and(eq(holdingContributions.id, partner.id), eq(holdingContributions.userId, userId)));
    } else {
      linkId = newId();
      await db.insert(holdingContributions).values({ id: newId(), userId, holdingId: target.id, date: input.date, ownPaise: 0, employerPaise: pension, linkId, linkRole: "pension", note, createdAt: nowIso() });
    }
  } else {
    if (partner) await db.delete(holdingContributions).where(and(eq(holdingContributions.id, partner.id), eq(holdingContributions.userId, userId)));
    linkId = null;
  }
  await db.update(holdingContributions).set({ date: input.date, ownPaise: own, employerPaise: employer, note, linkId, linkRole: target ? "primary" : null }).where(and(eq(holdingContributions.id, c.id), eq(holdingContributions.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** Deletes the value (or rate) typed on one day. A closed holding keeps its closing value. */
export async function removeValue(db: Db, userId: string, id: string, date: IstDate, today: IstDate): Promise<HoldingDto> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  if (row.status !== "active") throw new ConflictError("That holding is closed. Reopen it first.");
  const [found] = await db.select({ id: holdingValues.id }).from(holdingValues).where(and(eq(holdingValues.holdingId, id), eq(holdingValues.userId, userId), eq(holdingValues.date, date))).limit(1);
  if (!found) throw new NotFoundError("Nothing was typed on that day");
  await db.delete(holdingValues).where(and(eq(holdingValues.id, found.id), eq(holdingValues.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** A purchase from before tracking, with no bank entry: its quantity, cost and day. */
export async function addLot(db: Db, userId: string, id: string, input: AddLotData, today: IstDate): Promise<HoldingDto> {
  await requireCounted(db, userId, id);
  checkDate("date", input.date, today);
  await db.insert(holdingLots).values({ id: newId(), userId, holdingId: id, date: input.date, unitsE4: input.unitsE4, costPaise: input.costPaise, note: input.note ?? null, createdAt: nowIso() });
  return getHolding(db, userId, id, today);
}

export async function removeLot(db: Db, userId: string, id: string, lotId: string, today: IstDate): Promise<HoldingDto> {
  await requireCounted(db, userId, id);
  const [lot] = await db.select({ id: holdingLots.id }).from(holdingLots).where(and(eq(holdingLots.id, lotId), eq(holdingLots.holdingId, id), eq(holdingLots.userId, userId))).limit(1);
  if (!lot) throw new NotFoundError("Purchase not found");
  await db.delete(holdingLots).where(and(eq(holdingLots.id, lotId), eq(holdingLots.userId, userId)));
  return getHolding(db, userId, id, today);
}

/**
 * Switches a holding valued by hand to quantity times rate. The quantity entered is what is held now; what was put in
 * stays as it is. Entries already linked count as part of that quantity (marked 0), and the first rate is typed now.
 */
export async function convertToUnits(db: Db, userId: string, id: string, input: ConvertHoldingData, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  const kind = await getKindByKey(db, userId, row.kind);
  if (!kind?.unit) throw invalid("kind", "This kind has no unit, so it cannot be counted by quantity. Change its kind first.");
  if (row.tracking === "units") throw new ConflictError("That investment is already counted by quantity");
  const date = input.date ?? today;
  checkDate("date", date, today);
  await db.batch([
    db.update(holdings).set({ tracking: "units", openingUnitsE4: input.unitsE4 }).where(and(eq(holdings.id, id), eq(holdings.userId, userId))),
    db.update(transactions).set({ unitsE4: 0 }).where(and(eq(transactions.userId, userId), eq(transactions.holdingId, id), isNull(transactions.unitsE4))),
  ] as unknown as Parameters<Db["batch"]>[0]);
  await putRate(db, userId, id, date, input.ratePaise, input.unitsE4, kind.ratePer);
  return getHolding(db, userId, id, today);
}

/** Gives the quantity to an entry linked to a holding counted by quantity (a SIP, an allotment, or a purchase that was typed without one). */
export async function setEntryUnits(db: Db, userId: string, id: string, txnId: string, unitsE4: number, today: IstDate): Promise<HoldingDto> {
  await requireCounted(db, userId, id);
  if (!Number.isInteger(unitsE4) || unitsE4 <= 0) throw invalid("unitsE4", "Enter a quantity above zero");
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, txnId), eq(transactions.userId, userId), eq(transactions.holdingId, id), isNull(transactions.deletedAt), inArray(transactions.type, ["investment", "investment_sale"])))
    .limit(1);
  if (!row) throw new NotFoundError("Entry not found");
  await db.update(transactions).set({ unitsE4 }).where(and(eq(transactions.id, txnId), eq(transactions.userId, userId)));
  return getHolding(db, userId, id, today);
}

function entryRow(userId: string, holdingId: string, type: "investment" | "investment_sale", input: { amountPaise: number; accountId: string; date: IstDate; note: string | null; unitsE4?: number | null }, name: string) {
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
    unitsE4: input.unitsE4 ?? null,
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
  const counted = row.tracking === "units";
  if (counted && !input.unitsE4) throw invalid("unitsE4", "Enter how much you bought");
  if (!counted && input.unitsE4 !== undefined) throw invalid("unitsE4", "This investment is valued by typing what it is worth");
  const before = await getHolding(db, userId, id, today);
  await db.insert(transactions).values(entryRow(userId, id, "investment", { amountPaise: input.amountPaise, accountId: input.accountId, date, note: input.note ?? null, unitsE4: input.unitsE4 }, row.name));
  // A value typed on the same day cannot tell which came first, so the purchase moves it. Counted by quantity, the rate decides.
  if (!counted && before.valueDate === date) await putValue(db, userId, id, date, before.valuePaise + input.amountPaise);
  return getHolding(db, userId, id, today);
}

/** Selling: the proceeds come into the chosen bank. Selling everything can close the holding in the same step. */
export async function sell(db: Db, userId: string, id: string, input: SellHoldingData, today: IstDate): Promise<HoldingDto> {
  const row = await requireActive(db, userId, id);
  const date = input.date ?? today;
  checkDate("date", date, today);
  await requireBank(db, userId, input.accountId);
  const before = await getHolding(db, userId, id, today);
  const counted = row.tracking === "units";
  if (counted) {
    if (!input.unitsE4) throw invalid("unitsE4", "Enter how much you sold");
    if (input.unitsE4 > before.unitsHeldE4) throw invalid("unitsE4", "That is more than you hold");
  } else {
    if (input.unitsE4 !== undefined) throw invalid("unitsE4", "This investment is valued by typing what it is worth");
    if (before.valuePaise <= 0) throw invalid("amountPaise", "There is nothing left in this holding to sell");
  }
  await db.insert(transactions).values(entryRow(userId, id, "investment_sale", { amountPaise: input.amountPaise, accountId: input.accountId, date, note: input.note ?? null, unitsE4: input.unitsE4 }, row.name));
  // As with buying, a value typed on the same day is moved by the sale.
  if (!counted && before.valueDate === date) await putValue(db, userId, id, date, Math.max(0, before.valuePaise - input.amountPaise));
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
  await requireFreeName(db, userId, row.name, row.investmentAccountId, id);
  await db.update(holdings).set({ status: "active", closedAt: null }).where(and(eq(holdings.id, id), eq(holdings.userId, userId)));
  return getHolding(db, userId, id, today);
}

/** Only a holding with no entries linked to it can be removed; otherwise close it. */
export async function deleteHolding(db: Db, userId: string, id: string): Promise<void> {
  const row = await getHoldingRow(db, userId, id);
  if (!row) throw new NotFoundError("Holding not found");
  const linked = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.holdingId, id), isNull(transactions.deletedAt))).limit(1);
  if (linked.length > 0) throw new ConflictError("Entries are linked to this holding. Close it instead.");
  await db.batch([db.delete(recurringRules).where(and(eq(recurringRules.userId, userId), eq(recurringRules.type, "contribution"), eq(recurringRules.holdingId, id))), db.delete(holdingContributions).where(and(eq(holdingContributions.holdingId, id), eq(holdingContributions.userId, userId))), db.delete(holdingLots).where(and(eq(holdingLots.holdingId, id), eq(holdingLots.userId, userId))), db.delete(holdingValues).where(and(eq(holdingValues.holdingId, id), eq(holdingValues.userId, userId))), db.delete(holdings).where(and(eq(holdings.id, id), eq(holdings.userId, userId)))]);
}

/**
 * An allotted IPO becomes a holding: added to an active one of the same name, or a new Stock holding valued at what
 * was paid. The investment entry is linked to it.
 */
export async function attachAllotment(db: Db, userId: string, input: { name: string; txnId: string; amountPaise: number; date: IstDate; investmentAccountId?: string | null }): Promise<string> {
  const accountId = input.investmentAccountId ?? null;
  if (accountId !== null) await requireUsableInvestmentAccount(db, userId, accountId);
  const active = await db.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.status, "active")));
  // Added to the same stock in the same account when there is one, else (with no account chosen) to any active one of that name.
  const found = active.find((h) => keyOf(h.name) === keyOf(input.name) && h.investmentAccountId === accountId) ?? (accountId === null ? active.find((h) => keyOf(h.name) === keyOf(input.name)) : undefined);
  let holdingId = found?.id;
  if (!holdingId) {
    holdingId = newId();
    await db.insert(holdings).values({ id: holdingId, userId, name: tidy(input.name).slice(0, 40), kind: "stock", openingInvestedPaise: 0, investmentAccountId: accountId, createdAt: nowIso() });
    await putValue(db, userId, holdingId, input.date, input.amountPaise);
  }
  await db.update(transactions).set({ holdingId }).where(and(eq(transactions.userId, userId), eq(transactions.id, input.txnId)));
  return holdingId;
}
