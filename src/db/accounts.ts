import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { cachedRead } from "./readCache";
import { accounts } from "./schema";
import { newId, nowIso } from "../utils/id";

export type AccountRow = typeof accounts.$inferSelect;

export type NewAccount =
  | {
      kind: "bank";
      name: string;
      last4?: string | null;
      openingBalancePaise: number;
      countsTowardSafeToSpend?: boolean;
      isEmergency?: boolean;
    }
  | {
      kind: "card";
      name: string;
      last4?: string | null;
      creditLimitPaise: number;
      statementDay: number;
      dueDay: number;
      openingOutstandingPaise?: number;
    };

export async function insertAccount(
  db: Db,
  userId: string,
  input: NewAccount,
  options: { isDemo?: boolean } = {},
): Promise<AccountRow> {
  const row = {
    id: newId(),
    userId,
    createdAt: nowIso(),
    isDemo: options.isDemo ?? false,
    kind: input.kind,
    name: input.name,
    last4: input.last4 ?? null,
    ...(input.kind === "bank"
      ? {
          openingBalancePaise: input.openingBalancePaise,
          countsTowardSafeToSpend: input.countsTowardSafeToSpend ?? true,
          isEmergency: input.isEmergency ?? false,
        }
      : {
          creditLimitPaise: input.creditLimitPaise,
          statementDay: input.statementDay,
          dueDay: input.dueDay,
          openingOutstandingPaise: input.openingOutstandingPaise ?? 0,
        }),
  };
  const [created] = await db.insert(accounts).values(row).returning();
  if (!created) throw new Error("Account insert returned no row");
  return created;
}

export async function getAccount(db: Db, userId: string, id: string): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id)))
    .limit(1);
  return row;
}

/** The query behind `listAccounts`, for callers that send several reads in one `db.batch()`. */
export function accountsQuery(db: Db, userId: string, options: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(accounts)
    .where(options.includeArchived ? eq(accounts.userId, userId) : and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(accounts.createdAt, accounts.id);
}

export async function listAccounts(
  db: Db,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<AccountRow[]> {
  return cachedRead(db, `accounts:${userId}:${options.includeArchived ? "all" : "live"}`, async () => accountsQuery(db, userId, options));
}

/** Every account's id and name, archived ones too: the lookup the loan, debt and holding views use to name an account. */
export function accountNames(db: Db, userId: string): Promise<{ id: string; name: string }[]> {
  return cachedRead(db, `accountNames:${userId}`, async () => db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)));
}
