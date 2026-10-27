import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { categories } from "./schema";

export type CategoryRow = typeof categories.$inferSelect;

export async function getCategory(db: Db, userId: string, id: string): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .limit(1);
  return row;
}

export async function listCategories(db: Db, userId: string): Promise<CategoryRow[]> {
  return db.select().from(categories).where(eq(categories.userId, userId)).orderBy(categories.kind, categories.name);
}

export async function getCategoryByName(
  db: Db,
  userId: string,
  kind: "expense" | "income",
  name: string,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.kind, kind), eq(categories.name, name)))
    .limit(1);
  return row;
}
