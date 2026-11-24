import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, budgets, checkinLog, contacts, debts, demoItems, emiPlans, firePlan, goals, holdingValues, holdings, holds, insurancePolicies, investmentAccounts, loans, periodReserves, protectionProfile, recurringRules, transactions } from "../src/db/schema";
import { insertAccount } from "../src/db/accounts";
import { clearDemoData, createDemoData, demoStatus } from "../src/services/demo";
import { getAllowance } from "../src/services/allowance";
import { getCommitments } from "../src/services/commitments";
import { listBudgets } from "../src/services/budgets";
import { listGoals } from "../src/services/goals";
import { getFire } from "../src/services/fire";
import { getProtection } from "../src/services/protection";
import { createTransaction } from "../src/services/ledger";
import { listHoldings } from "../src/services/holdings";
import { createUser, db } from "./helpers";

const TODAY = "2026-10-27";

async function count(table: any, userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table).where(eq(table.userId, userId));
  return Number(row?.n ?? 0);
}

describe("the sample life", () => {
  let userId: string;
  beforeEach(async () => {
    userId = await createUser();
  });

  it("fills every part of Alfred", async () => {
    const out = await createDemoData(db, userId, TODAY);
    expect(out.created).toBeGreaterThan(40);
    expect(await demoStatus(db, userId)).toEqual({ loaded: true });

    const accountNames = (await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.userId, userId))).map((a) => a.name).sort();
    expect(accountNames).toEqual(["Demo Card", "Demo Cash", "Demo Salary Account", "Demo Savings"]);

    expect(await count(recurringRules, userId)).toBe(6);
    expect(await count(budgets, userId)).toBe(3);
    expect(await count(goals, userId)).toBe(2);
    expect(await count(emiPlans, userId)).toBe(1);
    expect(await count(loans, userId)).toBe(1);
    expect(await count(debts, userId)).toBe(2);
    expect(await count(holds, userId)).toBe(1);
    expect(await count(investmentAccounts, userId)).toBe(1);
    expect(await count(holdings, userId)).toBe(5);
    expect(await count(periodReserves, userId)).toBe(2);
    expect(await count(insurancePolicies, userId)).toBe(1);
    expect(await count(checkinLog, userId)).toBe(3);
  });

  it("makes the screens come alive", async () => {
    await createDemoData(db, userId, TODAY);

    // The weekly allowance has a week, money to spend and a run of no-spend days.
    const allowance = await getAllowance(db, userId, TODAY);
    expect(allowance.week).not.toBeNull();
    expect(allowance.flexiblePaise).toBeGreaterThan(0);
    expect(allowance.streak.current).toBeGreaterThanOrEqual(3);
    expect(allowance.reserves.map((r) => r.moved).sort()).toEqual([false, true]);

    // Salary-based commitments with the loan, rent and SIP in them.
    const commitments = await getCommitments(db, userId, TODAY);
    expect(commitments.basis).toBe("salary");
    expect(commitments.until > TODAY).toBe(true);

    // The three budget states.
    const list = await listBudgets(db, userId, TODAY);
    const state = (name: string) => list.items.find((b) => b.categoryName === name)?.status;
    expect(state("Groceries")).toBe("ok");
    expect(state("Food & Dining")).toBe("near");
    expect(state("Entertainment")).toBe("over");

    // Goals, investments (shared share, gold, EPF), cover gap, FIRE.
    expect((await listGoals(db, userId, TODAY, "active")).goals).toHaveLength(2);
    const held = await listHoldings(db, userId, TODAY, "active");
    expect(held.holdings.some((h) => h.shared !== null)).toBe(true);
    expect(held.totalValuePaise).toBeGreaterThan(0);
    expect((await getFire(db, userId, TODAY)).corpus.holdings.length).toBeGreaterThan(0);
    const cover = await getProtection(db, userId, TODAY);
    expect(cover.policies).toHaveLength(1);
  });

  it("refuses a second load, and a load once real entries exist", async () => {
    await createDemoData(db, userId, TODAY);
    await expect(createDemoData(db, userId, TODAY)).rejects.toThrow(/already loaded/);
    await clearDemoData(db, userId);

    const real = await insertAccount(db, userId, { kind: "bank", name: "My Bank", openingBalancePaise: 1_000_00 });
    await createTransaction(db, userId, { type: "expense", amountPaise: 100, txnDate: TODAY, accountId: real.id }, { source: "web" });
    await expect(createDemoData(db, userId, TODAY)).rejects.toThrow(/Real transactions/);
  });

  it("clears the sample completely and leaves the person's own things", async () => {
    const real = await insertAccount(db, userId, { kind: "bank", name: "My Bank", openingBalancePaise: 1_000_00 });
    await createDemoData(db, userId, TODAY);
    const cleared = await clearDemoData(db, userId);
    expect(cleared.deleted).toBeGreaterThan(40);

    for (const table of [budgets, goals, emiPlans, loans, debts, holds, investmentAccounts, holdings, periodReserves, insurancePolicies, checkinLog, recurringRules, contacts, demoItems, firePlan, protectionProfile, transactions]) {
      expect(await count(table, userId)).toBe(0);
    }
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(holdingValues).where(eq(holdingValues.userId, userId))) as [{ n: number }];
    expect(Number(n)).toBe(0);
    const left = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId));
    expect(left.map((a) => a.id)).toEqual([real.id]);
    expect(await demoStatus(db, userId)).toEqual({ loaded: false });

    // And it can be loaded again.
    await createDemoData(db, userId, TODAY);
    expect(await demoStatus(db, userId)).toEqual({ loaded: true });
  });

  it("keeps a real budget, a real plan and a real profile it did not make", async () => {
    // A real FIRE plan and protection profile exist before the sample: the sample leaves them alone.
    await db.insert(firePlan).values({ userId, ageNow: 33, targetAge: 50, monthlySpendPaise: null, withdrawalRateBp: 350, inflationBp: 600, returnBp: 1000, monthlySavingPaise: null, stepupBp: 0, updatedAt: "2026-10-01T00:00:00.000Z" } as never).catch(() => undefined);
    const before = await db.select().from(firePlan).where(eq(firePlan.userId, userId));
    await createDemoData(db, userId, TODAY);
    await clearDemoData(db, userId);
    const after = await db.select().from(firePlan).where(eq(firePlan.userId, userId));
    expect(after).toEqual(before);
  });

  it("never touches another person", async () => {
    const other = await createUser();
    await createDemoData(db, other, TODAY);
    await createDemoData(db, userId, TODAY);
    await clearDemoData(db, userId);
    expect(await count(goals, other)).toBe(2);
    expect(await count(demoItems, other)).toBeGreaterThan(10);
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(accounts).where(and(eq(accounts.userId, other), eq(accounts.isDemo, true)));
    expect(Number(row?.n)).toBe(4);
  });

  it("works on the first day of a month and in a month's last days", async () => {
    for (const day of ["2026-11-01", "2026-11-30", "2026-03-02"]) {
      const who = await createUser();
      await createDemoData(db, who, day);
      const list = await listBudgets(db, who, day);
      const state = (name: string) => list.items.find((b) => b.categoryName === name)?.status;
      expect([state("Groceries"), state("Food & Dining"), state("Entertainment")]).toEqual(["ok", "near", "over"]);
      expect((await getAllowance(db, who, day)).week).not.toBeNull();
    }
  });
});
