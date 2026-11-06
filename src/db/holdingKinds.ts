import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { holdingKinds } from "./schema";

export type HoldingKindRow = typeof holdingKinds.$inferSelect;

export async function listKindRows(db: Db, userId: string): Promise<HoldingKindRow[]> {
  return db.select().from(holdingKinds).where(eq(holdingKinds.userId, userId)).orderBy(holdingKinds.name);
}

/** A person's kinds by key (what `holdings.kind` stores). */
export async function kindsByKey(db: Db, userId: string): Promise<Map<string, HoldingKindRow>> {
  return new Map((await listKindRows(db, userId)).map((k) => [k.key, k]));
}

export async function getKindRow(db: Db, userId: string, id: string): Promise<HoldingKindRow | undefined> {
  const [row] = await db.select().from(holdingKinds).where(and(eq(holdingKinds.userId, userId), eq(holdingKinds.id, id))).limit(1);
  return row;
}

export async function getKindByKey(db: Db, userId: string, key: string): Promise<HoldingKindRow | undefined> {
  const [row] = await db.select().from(holdingKinds).where(and(eq(holdingKinds.userId, userId), eq(holdingKinds.key, key))).limit(1);
  return row;
}
