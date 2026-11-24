import { and, eq, inArray, or, sql } from "drizzle-orm";
import { ConflictError } from "../config/errors";
import type { Db } from "../db/client";
import { insertAccount } from "../db/accounts";
import { getCategoryByName } from "../db/categories";
import { seedDefaultHoldingKinds } from "../db/seed";
import {
  accounts,
  budgets,
  checkinLog,
  contacts,
  debtPayments,
  debts,
  demoItems,
  emiPlans,
  firePlan,
  goalContributions,
  goals,
  holdingContributions,
  holdingLots,
  holdingPartnerEntries,
  holdingValues,
  holdings,
  holds,
  insurancePolicies,
  insuranceReminders,
  investmentAccounts,
  loans,
  mandateAlerts,
  nudgeLog,
  periodReserves,
  protectionProfile,
  recurringRules,
  statementChecks,
  transactions,
} from "../db/schema";
import { addDays, cycleRange, type IstDate } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { setBudget } from "./budgets";
import { createPlan } from "./emi";
import { updateFirePlan } from "./fire";
import { addContribution as addGoalContribution, createGoal } from "./goals";
import { addLot, createHolding } from "./holdings";
import { addPartnerStake } from "./holdingPartners";
import { createHold } from "./holds";
import { createInvestmentAccount } from "./investmentAccounts";
import { createLoan } from "./loans";
import { createDebt, addPayment } from "./debts";
import { createTransaction } from "./ledger";
import { createPolicy, updateProfile } from "./protection";
import { createRule } from "./recurring";
import { createReserve, setMoved } from "./reserves";
import { getSettings } from "./settings";

/**
 * What the sample ("demo") data is: one small, easy life with round numbers. Everything is named "Demo ...", dated relative to today
 * so the weekly card, pace line, budgets and streak look right whenever it is loaded, and made through the same services as real data.
 */

const R = 100; // rupees to paise

/** Tables with no demo marker of their own: the sample records what it made in `demo_items`, so clearing removes exactly that. */
type Kind =
  | "budgets"
  | "goals"
  | "contacts"
  | "debts"
  | "emi_plans"
  | "recurring_rules"
  | "loans"
  | "holdings"
  | "investment_accounts"
  | "period_reserves"
  | "insurance_policies"
  | "fire_plan"
  | "protection_profile"
  | "checkin_log";

const BATCH = 20;

/** Whether the sample is on screen: its accounts are marked on the account itself. */
export async function demoStatus(db: Db, userId: string): Promise<{ loaded: boolean }> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isDemo, true)))
    .limit(1);
  return { loaded: !!row };
}

export async function createDemoData(db: Db, userId: string, today: IstDate): Promise<{ created: number }> {
  const [realTxn] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), or(eq(transactions.source, "web"), eq(transactions.source, "telegram"))))
    .limit(1);
  if (realTxn) throw new ConflictError("Real transactions already exist; the sample is only for an empty app");
  if ((await demoStatus(db, userId)).loaded) throw new ConflictError("The sample is already loaded");

  const tracked: { kind: Kind; refId: string }[] = [];
  const track = (kind: Kind, refId: string) => void tracked.push({ kind, refId });
  try {
    await seed(db, userId, today, track);
  } catch (error) {
    // A half-made sample is worse than none: take back what was made, then say what went wrong.
    await saveRegistry(db, userId, tracked);
    await clearDemoData(db, userId);
    throw error;
  }
  await saveRegistry(db, userId, tracked);

  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.userId, userId), eq(accounts.isDemo, true)))) as [{ n: number }];
  return { created: Number(n) };
}

async function saveRegistry(db: Db, userId: string, tracked: { kind: Kind; refId: string }[]): Promise<void> {
  for (let i = 0; i < tracked.length; i += BATCH) {
    const chunk = tracked.slice(i, i + BATCH);
    await db.insert(demoItems).values(chunk.map((t) => ({ userId, kind: t.kind, refId: t.refId }))).onConflictDoNothing();
  }
}

const dom = (date: IstDate) => Number(date.slice(8, 10));

/** One day's everyday spending: what, where, how much, and the account it leaves from. */
interface Spend {
  cat: string;
  merchant: string;
  rupees: number;
  via: "salary" | "card" | "cash";
}

/** Everyday spending that fills the past two months (never the categories the budgets are measured on, within this month). */
const EVERYDAY: Spend[] = [
  { cat: "Groceries", merchant: "BigBasket", rupees: 1200, via: "card" },
  { cat: "Food & Dining", merchant: "Zomato", rupees: 380, via: "card" },
  { cat: "Transport", merchant: "Metro", rupees: 120, via: "cash" },
  { cat: "Fuel", merchant: "Petrol pump", rupees: 1500, via: "salary" },
  { cat: "Shopping", merchant: "Amazon", rupees: 1499, via: "card" },
  { cat: "Health", merchant: "Pharmacy", rupees: 340, via: "cash" },
  { cat: "Personal Care", merchant: "Salon", rupees: 450, via: "cash" },
  { cat: "Food & Dining", merchant: "Cafe", rupees: 260, via: "cash" },
  { cat: "Groceries", merchant: "Vegetables", rupees: 450, via: "cash" },
  { cat: "Entertainment", merchant: "Movie", rupees: 600, via: "card" },
  { cat: "Transport", merchant: "Auto", rupees: 90, via: "cash" },
  { cat: "Education", merchant: "Book", rupees: 550, via: "card" },
];
const BUDGETED = new Set(["Groceries", "Food & Dining", "Entertainment"]);

/** This month's spending on the three budgeted categories: fixed amounts, so each budget shows the same state on any day. */
const THIS_MONTH: Spend[] = [
  { cat: "Groceries", merchant: "BigBasket", rupees: 800, via: "card" },
  { cat: "Groceries", merchant: "Vegetables", rupees: 650, via: "card" },
  { cat: "Groceries", merchant: "BigBasket", rupees: 950, via: "card" },
  { cat: "Food & Dining", merchant: "Zomato", rupees: 350, via: "salary" },
  { cat: "Food & Dining", merchant: "Cafe", rupees: 420, via: "salary" },
  { cat: "Food & Dining", merchant: "Zomato", rupees: 280, via: "salary" },
  { cat: "Food & Dining", merchant: "Dinner out", rupees: 650, via: "salary" },
  { cat: "Entertainment", merchant: "Movie", rupees: 499, via: "card" },
  { cat: "Entertainment", merchant: "Concert", rupees: 799, via: "card" },
];

async function seed(db: Db, userId: string, today: IstDate, track: (kind: Kind, refId: string) => void): Promise<void> {
  // The built-in investment kinds (Stock, Fund, Gold, Retirement) are needed; an account made by the setup script may not have them.
  await seedDefaultHoldingKinds(db, userId);
  const settings = await getSettings(db, userId);
  const cycleFrom = cycleRange(today, settings.periodStartDay).from;
  const d = (n: number) => addDays(today, -n);
  const cat = async (kind: "expense" | "income", name: string) => (await getCategoryByName(db, userId, kind, name))?.id ?? null;
  const ctx = { source: "seed" as const };

  // ── Accounts ────────────────────────────────────────────────────────────
  const salary = await insertAccount(db, userId, { kind: "bank", name: "Demo Salary Account", openingBalancePaise: 20_000 * R }, { isDemo: true });
  const savings = await insertAccount(db, userId, { kind: "bank", name: "Demo Savings", openingBalancePaise: 40_000 * R, isEmergency: true }, { isDemo: true });
  const cash = await insertAccount(db, userId, { kind: "bank", name: "Demo Cash", openingBalancePaise: 2_000 * R }, { isDemo: true });
  const card = await insertAccount(db, userId, { kind: "card", name: "Demo Card", creditLimitPaise: 1_00_000 * R, statementDay: 20, dueDay: 7 }, { isDemo: true });
  const from = { salary: salary.id, card: card.id, cash: cash.id } as const;

  // ── Money in and the regular outgoings: each repeats by itself, so past months are filled in ────────
  const salaryCat = await cat("income", "Salary");
  const rentCat = await cat("expense", "Rent");
  const subsCat = await cat("expense", "Subscriptions");
  const billsCat = await cat("expense", "Bills & Utilities");
  const start = d(100);

  const rule = async (input: Parameters<typeof createRule>[2]) => {
    const made = await createRule(db, userId, input, today);
    track("recurring_rules", made.id);
    return made;
  };
  await rule({ title: "Demo Salary", type: "income", amountPaise: 50_000 * R, accountId: salary.id, categoryId: salaryCat, frequency: "monthly", day: 1, startDate: start, mode: "auto" });
  await rule({ title: "Demo Rent", type: "expense", amountPaise: 15_000 * R, accountId: salary.id, categoryId: rentCat, frequency: "monthly", day: 5, startDate: start, mode: "auto", remindDaysBefore: 3 });
  await rule({ title: "Demo Netflix", type: "expense", amountPaise: 500 * R, accountId: card.id, categoryId: subsCat, frequency: "monthly", day: 12, startDate: start, mode: "auto" });
  // One bill that waits for you to confirm it: shows the Review step. It is due once, five days ago.
  await rule({ title: "Demo Electricity", type: "expense", amountPaise: 2_000 * R, accountId: salary.id, categoryId: billsCat, frequency: "monthly", day: dom(d(5)), startDate: d(10), mode: "draft" });

  // ── Investments ─────────────────────────────────────────────────────────
  const broker = await createInvestmentAccount(db, userId, { name: "Demo Broker", purpose: "Sample stocks and funds" });
  track("investment_accounts", broker.id);

  const fund = await createHolding(db, userId, { name: "Demo Index Fund", kind: "fund", investedPaise: 10_000 * R, valuePaise: 42_000 * R, valueDate: d(5), investmentAccountId: broker.id }, today);
  track("holdings", fund.id);
  const stock = await createHolding(db, userId, { name: "Demo Tech Stock", kind: "stock", tracking: "units", unitsE4: 6 * 10_000, investedPaise: 2_200 * R, ratePaise: 500 * R, valueDate: d(3), investmentAccountId: broker.id }, today);
  track("holdings", stock.id);
  await addLot(db, userId, stock.id, { unitsE4: 4 * 10_000, costPaise: 1_900 * R, date: d(40), note: "Bought more" }, today);
  const shared = await createHolding(db, userId, { name: "Demo Shared Stock", kind: "stock", tracking: "units", unitsE4: 20 * 10_000, investedPaise: 10_000 * R, ratePaise: 600 * R, valueDate: d(3), investmentAccountId: broker.id }, today);
  track("holdings", shared.id);
  await addPartnerStake(db, userId, shared.id, { name: "Demo Ravi", amountPaise: 4_000 * R, date: d(30), note: "His share of the buy" }, today);
  const gold = await createHolding(db, userId, { name: "Demo Gold", kind: "gold", tracking: "units", unitsE4: 5 * 10_000, investedPaise: 30_000 * R, ratePaise: 70_000 * R, valueDate: d(3) }, today);
  track("holdings", gold.id);
  const epf = await createHolding(db, userId, { name: "Demo EPF", kind: "retirement", investedPaise: 1_20_000 * R, valuePaise: 1_50_000 * R, valueDate: d(5) }, today);
  track("holdings", epf.id);

  await rule({ title: "Demo SIP", type: "investment", amountPaise: 5_000 * R, accountId: salary.id, categoryId: null, frequency: "monthly", day: 10, startDate: start, mode: "auto", holdingId: fund.id });
  await rule({ type: "contribution", frequency: "monthly", day: 5, startDate: start, mode: "auto", holdingId: epf.id, ownPaise: 1_800 * R, employerPaise: 1_800 * R });

  // ── Everyday entries: two months of them, none on the last three days (those are marked quiet below) ───────
  const quiet = new Set<IstDate>([d(1), d(2), d(3)]);
  const create = async (date: IstDate, s: Spend) => {
    const categoryId = await cat("expense", s.cat);
    await createTransaction(db, userId, { type: "expense", amountPaise: s.rupees * R, txnDate: date, accountId: from[s.via], categoryId, merchant: s.merchant }, ctx);
  };
  for (let k = 4; k <= 70; k++) {
    if (k % 2 !== 0 && k % 3 !== 0) continue;
    const date = d(k);
    let s = EVERYDAY[k % EVERYDAY.length] as Spend;
    if (date >= cycleFrom && BUDGETED.has(s.cat)) s = { cat: "Transport", merchant: "Auto", rupees: 90, via: "cash" };
    await create(date, s);
  }
  // This month's budgeted spending, on days that are not quiet.
  // Not today when another day will do: spending today ends the no-spend run the quiet days make.
  const allowed: IstDate[] = [];
  for (let k = 1; ; k++) {
    const date = d(k);
    if (date < cycleFrom) break;
    if (!quiet.has(date)) allowed.push(date);
  }
  if (allowed.length === 0) allowed.push(today);
  for (const [i, s] of THIS_MONTH.entries()) await create(allowed[i % allowed.length] as IstDate, s);

  // A refund that nets against the purchase it came from, a bit of cashback, and one entry left without a category.
  const refundsCat = await cat("income", "Refunds");
  const cashbackCat = await cat("income", "Cashback");
  await createTransaction(db, userId, { type: "income", amountPaise: 1_499 * R, txnDate: d(18), accountId: card.id, categoryId: refundsCat, merchant: "Amazon refund", countsForDate: d(25) }, ctx);
  await createTransaction(db, userId, { type: "income", amountPaise: 120 * R, txnDate: d(9), accountId: card.id, categoryId: cashbackCat, merchant: "Card cashback" }, ctx);
  await createTransaction(db, userId, { type: "expense", amountPaise: 180 * R, txnDate: d(4), accountId: cash.id, categoryId: null, merchant: "Misc store" }, ctx);

  // Moving money between your own accounts is never spending.
  await createTransaction(db, userId, { type: "transfer", amountPaise: 10_000 * R, txnDate: d(40), accountId: salary.id, toAccountId: savings.id, note: "Monthly saving" }, ctx);
  await createTransaction(db, userId, { type: "transfer", amountPaise: 10_000 * R, txnDate: d(10), accountId: salary.id, toAccountId: savings.id, note: "Monthly saving" }, ctx);
  for (const n of [60, 35, 12]) await createTransaction(db, userId, { type: "transfer", amountPaise: 2_000 * R, txnDate: d(n), accountId: salary.id, toAccountId: cash.id, note: "Cash withdrawn" }, ctx);
  await createTransaction(db, userId, { type: "bill_payment", amountPaise: 10_000 * R, txnDate: d(12), accountId: salary.id, toAccountId: card.id, note: "Card bill" }, ctx);

  // ── Budgets: one comfortable, one close, one over ──────────────────────
  for (const [name, limit] of [
    ["Groceries", 6_000],
    ["Food & Dining", 1_900],
    ["Entertainment", 1_000],
  ] as const) {
    const categoryId = await cat("expense", name);
    if (!categoryId) continue;
    const [already] = await db.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.categoryId, categoryId))).limit(1);
    if (already) continue;
    await setBudget(db, userId, categoryId, limit * R);
    const [made] = await db.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.categoryId, categoryId))).limit(1);
    if (made) track("budgets", made.id);
  }

  // ── Goals, a card purchase in instalments, a loan, money lent and borrowed, an IPO application ─────────
  const trip = await createGoal(db, userId, { name: "Demo Trip to Goa", targetPaise: 30_000 * R, targetDate: addDays(today, 150) }, today);
  track("goals", trip.id);
  await addGoalContribution(db, userId, trip.id, { amountPaise: 8_000 * R, date: d(30), note: "First part" }, today);
  await addGoalContribution(db, userId, trip.id, { amountPaise: 4_000 * R, date: d(8) }, today);
  const gadget = await createGoal(db, userId, { name: "Demo New Laptop", targetPaise: 60_000 * R, targetDate: addDays(today, 270) }, today);
  track("goals", gadget.id);
  await addGoalContribution(db, userId, gadget.id, { amountPaise: 2_000 * R, date: d(6) }, today);

  const emi = await createPlan(db, userId, { cardAccountId: card.id, title: "Demo Phone", categoryId: await cat("expense", "Shopping"), totalPaise: 24_000 * R, months: 6, startMonth: d(45).slice(0, 7) }, today);
  track("emi_plans", emi.id);
  const loan = await createLoan(db, userId, { name: "Demo Bike loan", lender: "Demo Bank", kind: "car", accountId: salary.id, principalPaise: 60_000 * R, ratePct: 12, months: 12, dueDay: 8, asOf: d(50) }, today);
  track("loans", loan.id);

  const lent = await createDebt(db, userId, { name: "Demo Ravi", direction: "lent", amountPaise: 3_000 * R, date: d(20), dueDate: addDays(today, 5), note: "For the trip tickets" }, "web", today);
  track("debts", lent.debtId);
  await addPayment(db, userId, lent.debtId, { amountPaise: 1_000 * R, date: d(10), note: "Part paid back" }, "web", today);
  const borrowed = await createDebt(db, userId, { name: "Demo Meera", direction: "borrowed", amountPaise: 2_000 * R, date: d(8), dueDate: addDays(today, 10) }, "web", today);
  track("debts", borrowed.debtId);
  for (const name of ["Demo Ravi", "Demo Meera"]) {
    const [person] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.name, name))).limit(1);
    if (person) track("contacts", person.id);
  }

  await createHold(db, userId, { accountId: salary.id, title: "Demo IPO application", amountPaise: 15_000 * R, appliedDate: d(2), expectedDate: addDays(today, 3) }, today);

  // ── Plan: move first, the long game, cover ──────────────────────────────
  const move = await createReserve(db, userId, { name: "Demo Move to savings", amountPaise: 10_000 * R }, today);
  track("period_reserves", move.id);
  await setMoved(db, userId, move.id, true, today);
  const topUp = await createReserve(db, userId, { name: "Demo Top up the fund", amountPaise: 3_000 * R }, today);
  track("period_reserves", topUp.id);

  const [plan] = await db.select({ userId: firePlan.userId }).from(firePlan).where(eq(firePlan.userId, userId)).limit(1);
  if (!plan) {
    await updateFirePlan(db, userId, { ageNow: 28, targetAge: 45, monthlySavingPaise: 20_000 * R });
    track("fire_plan", userId);
  }
  const [profile] = await db.select({ userId: protectionProfile.userId }).from(protectionProfile).where(eq(protectionProfile.userId, userId)).limit(1);
  if (!profile) {
    await updateProfile(db, userId, { dependants: "yes", employerHealth: "no" });
    track("protection_profile", userId);
  }
  const health = await createPolicy(db, userId, { kind: "health", insurer: "Demo Health Insurer", coverPaise: 5_00_000 * R, premiumPaise: 12_000 * R, frequency: "yearly", renewalDate: addDays(today, 20) }, today);
  track("insurance_policies", health.id);

  // ── Habit: three quiet days in a row, said so, for the no-spend streak ──────
  for (const date of quiet) {
    const id = newId();
    await db.insert(checkinLog).values({ id, userId, kind: "none_today", day: date, createdAt: nowIso() }).onConflictDoNothing();
    track("checkin_log", id);
  }
}

/** Removes the sample and what is attached to its accounts, and nothing else: a real account, real entries and the categories stay. */
export async function clearDemoData(db: Db, userId: string): Promise<{ deleted: number }> {
  const demoAccounts = (await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.isDemo, true)))).map((a) => a.id);
  const registry = await db.select({ kind: demoItems.kind, refId: demoItems.refId }).from(demoItems).where(eq(demoItems.userId, userId));
  const ids = (kind: Kind) => registry.filter((r) => r.kind === kind).map((r) => r.refId);

  const onDemoAccount = demoAccounts.length > 0 ? or(inArray(transactions.accountId, demoAccounts), inArray(transactions.toAccountId, demoAccounts)) : undefined;
  const txnWhere = and(eq(transactions.userId, userId), onDemoAccount ? or(eq(transactions.source, "seed"), onDemoAccount) : eq(transactions.source, "seed"));
  const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(transactions).where(txnWhere)) as [{ n: number }];

  const rules = ids("recurring_rules");
  const loanIds = ids("loans");
  const keys = [...rules.map((r) => `recurring:${r}`), ...loanIds.map((l) => `loan:${l}`)];
  const holdingIds = ids("holdings");
  const debtIds = ids("debts");
  const goalIds = ids("goals");
  const policyIds = ids("insurance_policies");

  // Children first, the order eraseUser uses.
  const steps = [
    db.delete(transactions).where(txnWhere),
    ...(demoAccounts.length > 0
      ? [
          db.delete(holds).where(and(eq(holds.userId, userId), inArray(holds.accountId, demoAccounts))),
          db.delete(nudgeLog).where(and(eq(nudgeLog.userId, userId), inArray(nudgeLog.cardAccountId, demoAccounts))),
          db.delete(statementChecks).where(and(eq(statementChecks.userId, userId), inArray(statementChecks.cardAccountId, demoAccounts))),
        ]
      : []),
    ...(keys.length > 0 ? [db.delete(mandateAlerts).where(and(eq(mandateAlerts.userId, userId), inArray(mandateAlerts.key, keys)))] : []),
    ...(ids("emi_plans").length > 0 ? [db.delete(emiPlans).where(and(eq(emiPlans.userId, userId), inArray(emiPlans.id, ids("emi_plans"))))] : []),
    ...(rules.length > 0 ? [db.delete(recurringRules).where(and(eq(recurringRules.userId, userId), inArray(recurringRules.id, rules)))] : []),
    ...(debtIds.length > 0
      ? [db.delete(debtPayments).where(and(eq(debtPayments.userId, userId), inArray(debtPayments.debtId, debtIds))), db.delete(debts).where(and(eq(debts.userId, userId), inArray(debts.id, debtIds)))]
      : []),
    ...(holdingIds.length > 0 ? [db.delete(holdingPartnerEntries).where(and(eq(holdingPartnerEntries.userId, userId), inArray(holdingPartnerEntries.holdingId, holdingIds)))] : []),
    ...(ids("contacts").length > 0 ? [db.delete(contacts).where(and(eq(contacts.userId, userId), inArray(contacts.id, ids("contacts"))))] : []),
    ...(goalIds.length > 0
      ? [db.delete(goalContributions).where(and(eq(goalContributions.userId, userId), inArray(goalContributions.goalId, goalIds))), db.delete(goals).where(and(eq(goals.userId, userId), inArray(goals.id, goalIds)))]
      : []),
    ...(holdingIds.length > 0
      ? [
          db.delete(holdingContributions).where(and(eq(holdingContributions.userId, userId), inArray(holdingContributions.holdingId, holdingIds))),
          db.delete(holdingLots).where(and(eq(holdingLots.userId, userId), inArray(holdingLots.holdingId, holdingIds))),
          db.delete(holdingValues).where(and(eq(holdingValues.userId, userId), inArray(holdingValues.holdingId, holdingIds))),
          db.delete(holdings).where(and(eq(holdings.userId, userId), inArray(holdings.id, holdingIds))),
        ]
      : []),
    ...(ids("investment_accounts").length > 0 ? [db.delete(investmentAccounts).where(and(eq(investmentAccounts.userId, userId), inArray(investmentAccounts.id, ids("investment_accounts"))))] : []),
    ...(loanIds.length > 0 ? [db.delete(loans).where(and(eq(loans.userId, userId), inArray(loans.id, loanIds)))] : []),
    ...(ids("budgets").length > 0 ? [db.delete(budgets).where(and(eq(budgets.userId, userId), inArray(budgets.id, ids("budgets"))))] : []),
    ...(ids("period_reserves").length > 0 ? [db.delete(periodReserves).where(and(eq(periodReserves.userId, userId), inArray(periodReserves.id, ids("period_reserves"))))] : []),
    ...(policyIds.length > 0
      ? [
          db.delete(insuranceReminders).where(and(eq(insuranceReminders.userId, userId), inArray(insuranceReminders.policyId, policyIds))),
          db.delete(insurancePolicies).where(and(eq(insurancePolicies.userId, userId), inArray(insurancePolicies.id, policyIds))),
        ]
      : []),
    ...(ids("fire_plan").length > 0 ? [db.delete(firePlan).where(eq(firePlan.userId, userId))] : []),
    ...(ids("protection_profile").length > 0 ? [db.delete(protectionProfile).where(eq(protectionProfile.userId, userId))] : []),
    ...(ids("checkin_log").length > 0 ? [db.delete(checkinLog).where(and(eq(checkinLog.userId, userId), inArray(checkinLog.id, ids("checkin_log"))))] : []),
    ...(demoAccounts.length > 0 ? [db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.isDemo, true)))] : []),
    db.delete(demoItems).where(eq(demoItems.userId, userId)),
  ];
  await db.batch(steps as unknown as [(typeof steps)[0], ...(typeof steps)[number][]]);
  return { deleted: Number(n) };
}
