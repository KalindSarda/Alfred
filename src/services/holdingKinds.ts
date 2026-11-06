import { and, eq } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getKindRow, type HoldingKindRow, listKindRows } from "../db/holdingKinds";
import { holdingKinds, holdings } from "../db/schema";
import { unitOne } from "../domain/holdings";
import type { CreateHoldingKindData, HoldingKindDto, UpdateHoldingKindData } from "../schemas/holdingKind";
import { newId, nowIso } from "../utils/id";

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Usage {
  count: number;
  counted: number;
}

async function usageByKey(db: Db, userId: string): Promise<Map<string, Usage>> {
  const rows = await db.select({ kind: holdings.kind, tracking: holdings.tracking }).from(holdings).where(eq(holdings.userId, userId));
  const usage = new Map<string, Usage>();
  for (const r of rows) {
    const u = usage.get(r.kind) ?? { count: 0, counted: 0 };
    u.count += 1;
    if (r.tracking === "units") u.counted += 1;
    usage.set(r.kind, u);
  }
  return usage;
}

const toDto = (row: HoldingKindRow, usage?: Usage): HoldingKindDto => ({
  id: row.id,
  key: row.key,
  name: row.name,
  unit: row.unit,
  unitOne: row.unit ? unitOne(row.unit) : null,
  ratePer: row.ratePer,
  archived: row.archivedAt !== null,
  isSystem: row.isSystem,
  holdingCount: usage?.count ?? 0,
  locked: (usage?.counted ?? 0) > 0,
});

export async function listKinds(db: Db, userId: string): Promise<HoldingKindDto[]> {
  const [rows, usage] = await Promise.all([listKindRows(db, userId), usageByKey(db, userId)]);
  return rows.map((r) => toDto(r, usage.get(r.key)));
}

async function requireFreeName(db: Db, userId: string, name: string, exceptId?: string) {
  const rows = await listKindRows(db, userId);
  if (rows.some((r) => r.id !== exceptId && same(r.name, name))) throw new ConflictError("An investment kind with that name already exists");
}

export async function createKind(db: Db, userId: string, input: CreateHoldingKindData): Promise<HoldingKindDto> {
  const unit = input.unit?.trim() || null;
  if (!unit && input.ratePer !== undefined && input.ratePer !== 1) throw invalid("ratePer", "A rate needs a unit to be quoted in");
  await requireFreeName(db, userId, input.name);
  const [row] = await db
    .insert(holdingKinds)
    .values({ id: newId(), userId, key: newId(), name: input.name.trim().replace(/\s+/g, " "), unit, ratePer: unit ? (input.ratePer ?? 1) : 1, isSystem: false, createdAt: nowIso() })
    .returning();
  if (!row) throw new Error("Holding kind insert returned no row");
  return toDto(row);
}

export async function updateKind(db: Db, userId: string, id: string, patch: UpdateHoldingKindData): Promise<HoldingKindDto> {
  const row = await getKindRow(db, userId, id);
  if (!row) throw new NotFoundError("Investment kind not found");
  const usage = (await usageByKey(db, userId)).get(row.key);
  const set: Partial<typeof holdingKinds.$inferInsert> = {};

  if (patch.name !== undefined && !same(patch.name, row.name)) {
    await requireFreeName(db, userId, patch.name, id);
    set.name = patch.name.trim().replace(/\s+/g, " ");
  } else if (patch.name !== undefined && patch.name.trim() !== row.name) {
    set.name = patch.name.trim().replace(/\s+/g, " ");
  }

  const nextUnit = patch.unit === undefined ? row.unit : patch.unit?.trim() || null;
  const nextRatePer = nextUnit ? (patch.ratePer ?? row.ratePer) : 1;
  if (!nextUnit && patch.ratePer !== undefined && patch.ratePer !== 1) throw invalid("ratePer", "A rate needs a unit to be quoted in");
  if (nextUnit !== row.unit || nextRatePer !== row.ratePer) {
    if ((usage?.counted ?? 0) > 0) {
      throw new ConflictError(`${row.name} is counted by quantity in ${usage?.counted} ${usage?.counted === 1 ? "holding" : "holdings"}, so its unit and rate cannot change. Create a new kind instead.`);
    }
    set.unit = nextUnit;
    set.ratePer = nextRatePer;
  }

  if (patch.archived !== undefined) {
    if (patch.archived && row.isSystem) throw new ConflictError("Built-in kinds cannot be archived");
    set.archivedAt = patch.archived ? (row.archivedAt ?? nowIso()) : null;
  }

  if (Object.keys(set).length === 0) return toDto(row, usage);
  const [updated] = await db.update(holdingKinds).set(set).where(and(eq(holdingKinds.userId, userId), eq(holdingKinds.id, id))).returning();
  if (!updated) throw new NotFoundError("Investment kind not found");
  return toDto(updated, usage);
}

export async function deleteKind(db: Db, userId: string, id: string): Promise<void> {
  const row = await getKindRow(db, userId, id);
  if (!row) throw new NotFoundError("Investment kind not found");
  if (row.isSystem) throw new ConflictError("Built-in kinds cannot be deleted");
  const usage = (await usageByKey(db, userId)).get(row.key);
  if (usage && usage.count > 0) {
    throw new ConflictError(`${usage.count} ${usage.count === 1 ? "investment uses" : "investments use"} this kind. Merge it into another kind, or archive it.`);
  }
  await db.delete(holdingKinds).where(and(eq(holdingKinds.userId, userId), eq(holdingKinds.id, id)));
}

/** Moves every holding of one kind to another counted the same way (same unit and rate), then removes the first. */
export async function mergeKind(db: Db, userId: string, fromId: string, intoId: string): Promise<{ movedHoldings: number }> {
  if (fromId === intoId) throw invalid("intoId", "Choose a different kind to merge into");
  const [from, into] = await Promise.all([getKindRow(db, userId, fromId), getKindRow(db, userId, intoId)]);
  if (!from || !into) throw new NotFoundError("Investment kind not found");
  if (from.isSystem) throw new ConflictError("Built-in kinds cannot be merged away");
  if (into.archivedAt) throw invalid("intoId", "That kind is archived");
  if ((from.unit ?? null) !== (into.unit ?? null) || from.ratePer !== into.ratePer) {
    throw invalid("intoId", "Kinds can only be merged when they are counted the same way (same unit and rate)");
  }
  const movedHoldings = (await usageByKey(db, userId)).get(from.key)?.count ?? 0;
  await db.batch([
    db.update(holdings).set({ kind: into.key }).where(and(eq(holdings.userId, userId), eq(holdings.kind, from.key))),
    db.delete(holdingKinds).where(and(eq(holdingKinds.userId, userId), eq(holdingKinds.id, fromId))),
  ] as unknown as Parameters<Db["batch"]>[0]);
  return { movedHoldings };
}
