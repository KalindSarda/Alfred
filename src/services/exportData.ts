import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, budgets, categories, contacts, debtPayments, debts, emiPlans, goalContributions, goals, holds, recurringRules, transactions } from "../db/schema";
import { formatRupees } from "../domain/money";
import { getSettings } from "./settings";

export const EXPORT_VERSION = 1;

/** Everything the user owns, as plain JSON. Secrets, sessions and login codes are never included. */
export async function exportJson(db: Db, userId: string, exportedAt: string) {
  const [accountRows, categoryRows, txnRows, budgetRows, holdRows, emiRows, ruleRows, contactRows, debtRows, paymentRows, goalRows, goalEntryRows, settings] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.createdAt), asc(accounts.id)),
    db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.kind), asc(categories.name)),
    db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.txnDate), asc(transactions.id)),
    db.select().from(budgets).where(eq(budgets.userId, userId)).orderBy(asc(budgets.categoryId)),
    db.select().from(holds).where(eq(holds.userId, userId)).orderBy(asc(holds.createdAt), asc(holds.id)),
    db.select().from(emiPlans).where(eq(emiPlans.userId, userId)).orderBy(asc(emiPlans.createdAt), asc(emiPlans.id)),
    db.select().from(recurringRules).where(eq(recurringRules.userId, userId)).orderBy(asc(recurringRules.createdAt), asc(recurringRules.id)),
    db.select().from(contacts).where(eq(contacts.userId, userId)).orderBy(asc(contacts.name)),
    db.select().from(debts).where(eq(debts.userId, userId)).orderBy(asc(debts.date), asc(debts.id)),
    db.select().from(debtPayments).where(eq(debtPayments.userId, userId)).orderBy(asc(debtPayments.date), asc(debtPayments.id)),
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.createdAt), asc(goals.id)),
    db.select().from(goalContributions).where(eq(goalContributions.userId, userId)).orderBy(asc(goalContributions.date), asc(goalContributions.id)),
    getSettings(db, userId),
  ]);
  const strip = <T extends { userId: string }>({ userId: _omit, ...rest }: T) => rest;
  return {
    exportedAt,
    version: EXPORT_VERSION,
    accounts: accountRows.map(strip),
    categories: categoryRows.map(strip),
    transactions: txnRows.map(strip),
    budgets: budgetRows.map(strip),
    holds: holdRows.map(strip),
    emiPlans: emiRows.map(strip),
    recurringRules: ruleRows.map(strip),
    contacts: contactRows.map(strip),
    debts: debtRows.map(strip),
    debtPayments: paymentRows.map(strip),
    goals: goalRows.map(strip),
    goalContributions: goalEntryRows.map(strip),
    settings,
  };
}

/** A cell that starts with = + - @ (or a tab or return) would run as a formula in a spreadsheet; a quote defuses it. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_HEADER = ["date", "type", "amount_rupees", "account", "to_account", "category", "merchant", "note", "status"];

const plainRupees = (paise: number) => formatRupees(paise, { symbol: false }).replace(/,/g, "");

/** One row per entry that has not been deleted, oldest first. Amounts are positive rupees; the type says the direction. */
export async function exportCsv(db: Db, userId: string): Promise<string> {
  const [accountRows, categoryRows, txnRows] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, userId)),
    db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.txnDate), asc(transactions.id)),
  ]);
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]));
  const lines = [CSV_HEADER.join(",")];
  for (const t of txnRows) {
    if (t.deletedAt) continue;
    lines.push(
      [
        t.txnDate,
        t.type,
        plainRupees(t.amountPaise),
        accountName.get(t.accountId),
        t.toAccountId ? accountName.get(t.toAccountId) : null,
        t.categoryId ? categoryName.get(t.categoryId) : null,
        t.merchant,
        t.note,
        t.status,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
