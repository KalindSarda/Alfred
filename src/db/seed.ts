import { newId, nowIso } from "../utils/id";
import type { Db } from "./client";
import {
  CASHBACK_CATEGORY,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "./defaultCategories";
import { categories } from "./schema";

export { CASHBACK_CATEGORY, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };

export async function seedDefaultCategories(db: Db, userId: string): Promise<void> {
  const createdAt = nowIso();
  const rows = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ name, kind: "expense" as const, isSystem: false })),
    ...DEFAULT_INCOME_CATEGORIES.map((name) => ({
      name,
      kind: "income" as const,
      isSystem: name === CASHBACK_CATEGORY,
    })),
  ].map((row) => ({ id: newId(), userId, createdAt, ...row }));

  // D1 allows at most 100 bound variables per statement (7 columns here), so insert in small chunks, atomically.
  const CHUNK = 10;
  const statements = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    statements.push(db.insert(categories).values(rows.slice(i, i + CHUNK)).onConflictDoNothing());
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}
