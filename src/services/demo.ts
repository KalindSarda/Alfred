import { and, eq, inArray, or } from "drizzle-orm";
import { ConflictError } from "../config/errors";
import type { Db } from "../db/client";
import { insertAccount } from "../db/accounts";
import { getCategoryByName } from "../db/categories";
import { accounts, transactions } from "../db/schema";
import { addDays, type IstDate } from "../domain/dates";
import { createTransaction } from "./ledger";

/** Demo data lets the app be used before real balances are entered; everything is tagged for one-step removal. */
export async function createDemoData(db: Db, userId: string, today: IstDate): Promise<{ created: number }> {
  const [realTxn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.source, "web")))
    .limit(1);
  const [telegramTxn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.source, "telegram")))
    .limit(1);
  const [existingDemo] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isDemo, true)))
    .limit(1);
  if (realTxn || telegramTxn) throw new ConflictError("Real transactions already exist; demo data is only for an empty app");
  if (existingDemo) throw new ConflictError("Demo data is already loaded");

  const savings = await insertAccount(db, userId, { kind: "bank", name: "Demo Savings", openingBalancePaise: 85_000_00 }, { isDemo: true });
  const salary = await insertAccount(db, userId, { kind: "bank", name: "Demo Salary Account", openingBalancePaise: 40_000_00 }, { isDemo: true });
  const card = await insertAccount(
    db,
    userId,
    { kind: "card", name: "Demo Card", creditLimitPaise: 1_50_000_00, statementDay: 20, dueDay: 7 },
    { isDemo: true },
  );

  const cat = async (kind: "expense" | "income", name: string) => (await getCategoryByName(db, userId, kind, name))?.id ?? null;
  const ctx = { source: "seed" as const };

  const plan = [
    { type: "income", amount: 90_000_00, daysAgo: 24, account: salary.id, cat: await cat("income", "Salary"), merchant: "Employer" },
    { type: "expense", amount: 22_000_00, daysAgo: 23, account: salary.id, cat: await cat("expense", "Rent"), merchant: "Landlord" },
    { type: "expense", amount: 3_450_00, daysAgo: 21, account: card.id, cat: await cat("expense", "Groceries"), merchant: "BigBasket" },
    { type: "expense", amount: 649_00, daysAgo: 19, account: card.id, cat: await cat("expense", "Subscriptions"), merchant: "Netflix" },
    { type: "expense", amount: 2_100_00, daysAgo: 17, account: salary.id, cat: await cat("expense", "Bills & Utilities"), merchant: "Electricity" },
    { type: "expense", amount: 450_00, daysAgo: 14, account: card.id, cat: await cat("expense", "Food & Dining"), merchant: "Swiggy" },
    { type: "expense", amount: 3_000_00, daysAgo: 12, account: salary.id, cat: await cat("expense", "Fuel"), merchant: "Indian Oil" },
    { type: "expense", amount: 7_999_00, daysAgo: 10, account: card.id, cat: await cat("expense", "Shopping"), merchant: "Amazon" },
    { type: "expense", amount: 1_250_00, daysAgo: 8, account: card.id, cat: await cat("expense", "Entertainment"), merchant: "BookMyShow" },
    { type: "expense", amount: 620_00, daysAgo: 5, account: savings.id, cat: await cat("expense", "Food & Dining"), merchant: "Zomato" },
    { type: "expense", amount: 1_800_00, daysAgo: 3, account: card.id, cat: null, merchant: "Misc store" },
    { type: "income", amount: 240_00, daysAgo: 2, account: card.id, cat: await cat("income", "Cashback"), merchant: "Card cashback" },
  ] as const;

  let created = 0;
  for (const p of plan) {
    await createTransaction(
      db,
      userId,
      {
        type: p.type,
        amountPaise: p.amount,
        txnDate: addDays(today, -p.daysAgo),
        accountId: p.account,
        categoryId: p.cat,
        merchant: p.merchant,
      },
      ctx,
    );
    created++;
  }
  // A card bill payment: a transfer from the salary account, never an expense.
  await createTransaction(
    db,
    userId,
    { type: "transfer", amountPaise: 3_450_00, txnDate: addDays(today, -4), accountId: salary.id, toAccountId: card.id, note: "Card bill" },
    ctx,
  );
  created++;
  return { created };
}

/** Removes every demo account and every transaction that is tagged as seed or touches a demo account. */
export async function clearDemoData(db: Db, userId: string): Promise<{ deleted: number }> {
  const demoAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isDemo, true)));
  const demoIds = demoAccounts.map((a) => a.id);

  const touchesDemo = demoIds.length
    ? or(eq(transactions.source, "seed"), inArray(transactions.accountId, demoIds), inArray(transactions.toAccountId, demoIds))
    : eq(transactions.source, "seed");

  const removed = await db
    .delete(transactions)
    .where(and(eq(transactions.userId, userId), touchesDemo))
    .returning({ id: transactions.id });
  if (demoIds.length) await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.isDemo, true)));
  return { deleted: removed.length };
}
