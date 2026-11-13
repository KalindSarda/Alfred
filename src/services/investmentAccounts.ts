import { and, eq, inArray } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { holdings, investmentAccounts } from "../db/schema";
import type { IstDate } from "../domain/dates";
import type { CreateInvestmentAccountData, MoveHoldingsData, UpdateInvestmentAccountData } from "../schemas/investmentAccount";
import { newId, nowIso } from "../utils/id";
import { listHoldings } from "./holdings";

type Row = typeof investmentAccounts.$inferSelect;

export interface InvestmentAccountDto {
  id: string;
  name: string;
  purpose: string | null;
  archived: boolean;
  /** Active holdings in it, what they are worth, what was put in and the gain. */
  holdingCount: number;
  valuePaise: number;
  investedPaise: number;
  gainPaise: number;
  gainPct: number | null;
  /** Its share of everything invested, to one decimal; null when nothing is worth anything yet. */
  sharePct: number | null;
}

export interface InvestmentAccountsOverview {
  accounts: InvestmentAccountDto[];
  /** Active holdings not yet in any account. */
  unassigned: { holdingCount: number; valuePaise: number; investedPaise: number; gainPaise: number };
  totalValuePaise: number;
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");
const keyOf = (name: string) => tidy(name).toLowerCase();

async function requireRow(db: Db, userId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(investmentAccounts).where(and(eq(investmentAccounts.userId, userId), eq(investmentAccounts.id, id))).limit(1);
  if (!row) throw new NotFoundError("Investment account not found");
  return row;
}

/** The account for a holding: it must be the person's own and not archived. Used when a holding is created, edited or moved. */
export async function requireUsableInvestmentAccount(db: Db, userId: string, id: string): Promise<Row> {
  const row = await requireRow(db, userId, id);
  if (row.archivedAt) throw invalid("investmentAccountId", `${row.name} is archived. Restore it or choose another account.`);
  return row;
}

async function requireFreeName(db: Db, userId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await db.select({ id: investmentAccounts.id, name: investmentAccounts.name }).from(investmentAccounts).where(eq(investmentAccounts.userId, userId));
  if (rows.some((r) => r.id !== exceptId && keyOf(r.name) === keyOf(name))) throw invalid("name", "You already have an account with that name");
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Every account with what it holds, and what is not in any account yet. Archived accounts are left out unless asked for. */
export async function listInvestmentAccounts(db: Db, userId: string, today: IstDate, options: { includeArchived?: boolean } = {}): Promise<InvestmentAccountsOverview> {
  const [rows, overview] = await Promise.all([db.select().from(investmentAccounts).where(eq(investmentAccounts.userId, userId)), listHoldings(db, userId, today, "active")]);
  const total = overview.totalValuePaise;
  const sum = (items: typeof overview.holdings) => ({
    holdingCount: items.length,
    valuePaise: items.reduce((s, h) => s + h.valuePaise, 0),
    investedPaise: items.reduce((s, h) => s + h.investedPaise, 0),
    gainPaise: items.reduce((s, h) => s + h.gainPaise, 0),
  });
  const accounts = rows
    .filter((r) => options.includeArchived || !r.archivedAt)
    .map((r): InvestmentAccountDto => {
      const mine = sum(overview.holdings.filter((h) => h.investmentAccountId === r.id));
      return { id: r.id, name: r.name, purpose: r.purpose, archived: r.archivedAt !== null, ...mine, gainPct: pct(mine.gainPaise, mine.investedPaise), sharePct: pct(mine.valuePaise, total) };
    })
    .sort((a, b) => b.valuePaise - a.valuePaise || a.name.localeCompare(b.name));
  const known = new Set(rows.map((r) => r.id));
  return { accounts, unassigned: sum(overview.holdings.filter((h) => h.investmentAccountId === null || !known.has(h.investmentAccountId))), totalValuePaise: total };
}

export async function createInvestmentAccount(db: Db, userId: string, input: CreateInvestmentAccountData): Promise<Row> {
  const name = tidy(input.name);
  await requireFreeName(db, userId, name);
  const row = { id: newId(), userId, name, purpose: input.purpose ? input.purpose : null, archivedAt: null, createdAt: nowIso() };
  await db.insert(investmentAccounts).values(row);
  return row;
}

export async function updateInvestmentAccount(db: Db, userId: string, id: string, patch: UpdateInvestmentAccountData): Promise<Row> {
  const row = await requireRow(db, userId, id);
  if (patch.name !== undefined) await requireFreeName(db, userId, patch.name, id);
  const next = { name: patch.name === undefined ? row.name : tidy(patch.name), purpose: patch.purpose === undefined ? row.purpose : patch.purpose || null };
  await db.update(investmentAccounts).set(next).where(and(eq(investmentAccounts.id, id), eq(investmentAccounts.userId, userId)));
  return { ...row, ...next };
}

/** Hides an account that holds nothing active; move its holdings out first. */
export async function setInvestmentAccountArchived(db: Db, userId: string, id: string, archived: boolean): Promise<Row> {
  const row = await requireRow(db, userId, id);
  if (archived) {
    const inside = await db.select({ id: holdings.id }).from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.investmentAccountId, id), eq(holdings.status, "active"))).limit(1);
    if (inside.length > 0) throw new ConflictError("This account still has investments in it. Move them to another account first.");
  }
  const archivedAt = archived ? nowIso() : null;
  await db.update(investmentAccounts).set({ archivedAt }).where(and(eq(investmentAccounts.id, id), eq(investmentAccounts.userId, userId)));
  return { ...row, archivedAt };
}

/** Moves holdings into an account (or out of all of them with null). An active holding cannot take the name of another active one already there. */
export async function moveHoldings(db: Db, userId: string, input: MoveHoldingsData): Promise<{ moved: number }> {
  if (input.investmentAccountId !== null) await requireUsableInvestmentAccount(db, userId, input.investmentAccountId);
  const ids = [...new Set(input.ids)];
  const rows = await db.select().from(holdings).where(and(eq(holdings.userId, userId), inArray(holdings.id, ids)));
  if (rows.length !== ids.length) throw new NotFoundError("Holding not found");

  // The names that would meet in the target account: those already there, and those moving in.
  const active = await db.select({ id: holdings.id, name: holdings.name, account: holdings.investmentAccountId }).from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.status, "active")));
  const there = new Map<string, string>();
  for (const h of active) if (!ids.includes(h.id) && h.account === input.investmentAccountId) there.set(keyOf(h.name), h.name);
  const clashes: string[] = [];
  for (const r of rows.filter((x) => x.status === "active")) {
    const k = keyOf(r.name);
    if (there.has(k)) clashes.push(r.name);
    there.set(k, r.name);
  }
  if (clashes.length > 0) throw invalid("ids", `${[...new Set(clashes)].slice(0, 3).join(", ")} ${clashes.length === 1 ? "is" : "are"} already in that account`);

  await db.update(holdings).set({ investmentAccountId: input.investmentAccountId }).where(and(eq(holdings.userId, userId), inArray(holdings.id, ids)));
  return { moved: ids.length };
}
