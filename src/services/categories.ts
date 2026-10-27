import { and, eq } from "drizzle-orm";
import { ConflictError, NotFoundError } from "../config/errors";
import type { Db } from "../db/client";
import { type CategoryRow, getCategory, getCategoryByName, listCategories } from "../db/categories";
import { categories } from "../db/schema";
import type { CategoryDto } from "../schemas/category";
import { newId, nowIso } from "../utils/id";

const toDto = (row: CategoryRow): CategoryDto => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  archived: row.archivedAt !== null,
  isSystem: row.isSystem,
});

export async function listCategoryDtos(db: Db, userId: string): Promise<CategoryDto[]> {
  return (await listCategories(db, userId)).map(toDto);
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

  if (Object.keys(set).length === 0) return toDto(existing);
  const [row] = await db
    .update(categories)
    .set(set)
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .returning();
  if (!row) throw new NotFoundError("Category not found");
  return toDto(row);
}
