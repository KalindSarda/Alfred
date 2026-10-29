import { and, count, eq, isNull, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { type CategoryRow, getCategory, getCategoryByName, listCategories } from "../db/categories";
import { budgets, categories, merchantAliases, transactions } from "../db/schema";
import type { CategoryDto } from "../schemas/category";
import { newId, nowIso } from "../utils/id";

const toDto = (row: CategoryRow, entryCount = 0): CategoryDto => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  archived: row.archivedAt !== null,
  isSystem: row.isSystem,
  entryCount,
});

/** Every category with how many live entries use it. */
export async function listCategoryDtos(db: Db, userId: string): Promise<CategoryDto[]> {
  const [rows, counts] = await Promise.all([
    listCategories(db, userId),
    db
      .select({ categoryId: transactions.categoryId, n: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
      .groupBy(transactions.categoryId),
  ]);
  const used = new Map(counts.flatMap((r) => (r.categoryId ? [[r.categoryId, r.n] as const] : [])));
  return rows.map((row) => toDto(row, used.get(row.id) ?? 0));
}

export async function createCategory(
  db: Db,
  userId: string,
  input: { name: string; kind: "expense" | "income" },
): Promise<CategoryDto> {
  if (await getCategoryByName(db, userId, input.kind, input.name)) {
    throw new ConflictError("A category with that name already exists");
  }
  const [row] = await db
    .insert(categories)
    .values({ id: newId(), userId, name: input.name, kind: input.kind, isSystem: false, createdAt: nowIso() })
    .returning();
  if (!row) throw new Error("Category insert returned no row");
  return toDto(row);
}

/** Entries (not deleted) filed under a category; the figure shown before a merge or delete. */
export async function countEntries(db: Db, userId: string, categoryId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, categoryId), isNull(transactions.deletedAt)));
  return row?.n ?? 0;
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

/**
 * Removes a category that nothing live uses. Its budget goes with it, merchant shortcuts lose their default,
 * and entries that were already deleted are detached. Categories with real entries must be merged or archived.
 */
export async function deleteCategory(db: Db, userId: string, id: string): Promise<void> {
  const existing = await getCategory(db, userId, id);
  if (!existing) throw new NotFoundError("Category not found");
  if (existing.isSystem) throw new ConflictError("System categories cannot be deleted");
  const entries = await countEntries(db, userId, id);
  if (entries > 0) {
    throw new ConflictError(
      `${entries} ${entries === 1 ? "entry uses" : "entries use"} this category. Merge it into another category, or archive it.`,
    );
  }
  await db.batch([
    db.update(transactions).set({ categoryId: null }).where(and(eq(transactions.userId, userId), eq(transactions.categoryId, id))),
    db.update(merchantAliases).set({ defaultCategoryId: null }).where(and(eq(merchantAliases.userId, userId), eq(merchantAliases.defaultCategoryId, id))),
    db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.categoryId, id))),
    db.delete(categories).where(and(eq(categories.userId, userId), eq(categories.id, id))),
  ]);
}

/**
 * Moves everything filed under one category into another of the same kind, then removes the first.
 * The target keeps its own budget; the source's budget moves across only when the target has none.
 */
export async function mergeCategory(db: Db, userId: string, fromId: string, intoId: string): Promise<{ movedEntries: number }> {
  if (fromId === intoId) throw invalid("intoId", "Choose a different category to merge into");
  const [from, into] = await Promise.all([getCategory(db, userId, fromId), getCategory(db, userId, intoId)]);
  if (!from || !into) throw new NotFoundError("Category not found");
  if (from.isSystem) throw new ConflictError("System categories cannot be merged away");
  if (from.kind !== into.kind) throw invalid("intoId", "Categories can only be merged with the same kind (expense or income)");
  if (into.archivedAt) throw invalid("intoId", "That category is archived");

  const movedEntries = await countEntries(db, userId, fromId);
  const now = nowIso();
  await db.batch([
    db.update(transactions).set({ categoryId: intoId }).where(and(eq(transactions.userId, userId), eq(transactions.categoryId, fromId))),
    db.update(merchantAliases).set({ defaultCategoryId: intoId }).where(and(eq(merchantAliases.userId, userId), eq(merchantAliases.defaultCategoryId, fromId))),
    db
      .update(budgets)
      .set({ categoryId: intoId, updatedAt: now })
      .where(
        and(
          eq(budgets.userId, userId),
          eq(budgets.categoryId, fromId),
          sql`NOT EXISTS (SELECT 1 FROM budgets b2 WHERE b2.user_id = ${userId} AND b2.category_id = ${intoId})`,
        ),
      ),
    db.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.categoryId, fromId))),
    db.delete(categories).where(and(eq(categories.userId, userId), eq(categories.id, fromId))),
  ]);
  return { movedEntries };
}

/** The seeded system category (Cashback) can be archived but not renamed. */
export async function updateCategory(
  db: Db,
  userId: string,
  id: string,
  patch: { name?: string | undefined; archived?: boolean | undefined },
): Promise<CategoryDto> {
  const existing = await getCategory(db, userId, id);
  if (!existing) throw new NotFoundError("Category not found");

  const set: Partial<typeof categories.$inferInsert> = {};
  if (patch.name !== undefined && patch.name !== existing.name) {
    if (existing.isSystem) throw new ConflictError("System categories cannot be renamed");
    if (await getCategoryByName(db, userId, existing.kind, patch.name)) {
      throw new ConflictError("A category with that name already exists");
    }
    set.name = patch.name;
  }
  if (patch.archived !== undefined) set.archivedAt = patch.archived ? (existing.archivedAt ?? nowIso()) : null;

  if (Object.keys(set).length === 0) return toDto(existing, await countEntries(db, userId, id));
  const [row] = await db
    .update(categories)
    .set(set)
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .returning();
  if (!row) throw new NotFoundError("Category not found");
  return toDto(row, await countEntries(db, userId, id));
}
