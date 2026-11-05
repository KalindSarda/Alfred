import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { loans } from "./schema";

export type LoanRow = typeof loans.$inferSelect;

export async function getLoanRow(db: Db, userId: string, id: string): Promise<LoanRow | undefined> {
  const [row] = await db.select().from(loans).where(and(eq(loans.userId, userId), eq(loans.id, id))).limit(1);
  return row;
}
