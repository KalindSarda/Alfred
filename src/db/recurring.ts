import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { recurringRules } from "./schema";
import type { RuleShape } from "../domain/recurring";

export type RuleRow = typeof recurringRules.$inferSelect;

export async function getRuleRow(db: Db, userId: string, id: string): Promise<RuleRow | undefined> {
  const [row] = await db.select().from(recurringRules).where(and(eq(recurringRules.userId, userId), eq(recurringRules.id, id))).limit(1);
  return row;
}

export function parseSkips(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export const toRuleShape = (row: RuleRow): RuleShape => ({
  frequency: row.frequency,
  day: row.day,
  month: row.month,
  startDate: row.startDate,
  endDate: row.endDate,
  skips: parseSkips(row.skipsJson),
});
