import { describe, expect, it } from "vitest";
import { levelEmi } from "../src/domain/loans";
import { runMonthlyReview } from "../src/services/reviewJob";
import { world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27, so the last full month is September. HDFC holds ₹1,00,000 and SBI ₹50,000.
const entry = (w: W, type: string, amountPaise: number, txnDate: string, category: string | null, extra: object = {}) =>
  w.api("POST", "/api/transactions", { type, amountPaise, txnDate, accountId: w.hdfc.id, ...(category && { categoryId: w.category(category) }), ...extra });
const view = async (w: W, query = "") => (await w.api("GET", `/api/money-health${query}`)).json as Json;
const review = (w: W, date: string) => runMonthlyReview({ db, telegram: w.tg, now: () => Date.parse(`${date}T05:00:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));

async function september(w: W) {
  await entry(w, "income", 1_00_000_00, "2026-09-05", "Salary");
  await entry(w, "income", 2_000_00, "2026-09-06", "Refunds");
  await entry(w, "expense", 20_000_00, "2026-09-07", "Rent");
  await entry(w, "expense", 5_000_00, "2026-09-08", "Groceries");
  await entry(w, "expense", 10_000_00, "2026-09-09", "Food & Dining");
  await entry(w, "expense", 5_000_00, "2026-09-10", "Shopping");
  await entry(w, "investment", 10_000_00, "2026-09-11", null);
}

describe("the health of a month", () => {
  it("splits income, needs, wants and savings, leaving refunds out and investing inside what was saved", async () => {
    const w = await world();
    await september(w);
    const v = await view(w);
    expect(v.period).toEqual({ kind: "last", from: "2026-09-01", to: "2026-09-30" });
    // The ₹2,000 refund is not income; it is taken off what was spent, wants first.
    expect(v).toMatchObject({ incomePaise: 1_00_000_00, needsPaise: 25_000_00, wantsPaise: 13_000_00, spentPaise: 38_000_00, savingsPaise: 62_000_00, savingsRatePct: 62, needsPct: 25, wantsPct: 13, investedPaise: 10_000_00, reimbursedPaise: 2_000_00, empty: false, savingsBand: "strong" });
  });

  it("is empty for a new person, and the current month is the one so far", async () => {
    const w = await world();
    expect((await view(w)).empty).toBe(true);
    await entry(w, "expense", 10_000_00, "2026-10-10", "Food & Dining");
    const v = await view(w, "?period=current");
    expect(v.period).toEqual({ kind: "current", from: "2026-10-01", to: "2026-10-27" });
    expect(v).toMatchObject({ spentPaise: 10_000_00, wantsPaise: 10_000_00, savingsPaise: -10_000_00, empty: false });
    // Net worth fell by what was spent, over the month so far.
    expect(v.netWorth).toMatchObject({ changePaise: -10_000_00 });
  });

  it("counts loan interest as a need and the whole instalment toward the EMI burden, but not a prepayment", async () => {
    const w = await world();
    await entry(w, "income", 1_00_000_00, "2026-09-05", "Salary");
    const created = await w.api("POST", "/api/loans", { name: "Car loan", kind: "car", accountId: w.hdfc.id, principalPaise: 1_00_000_00, ratePct: 12, months: 12, dueDay: 5, asOf: "2026-08-01" });
    expect(created.status).toBe(201);
    await w.api("POST", `/api/loans/${created.json.id}/prepay`, { amountPaise: 10_000_00, effect: "shorten", date: "2026-09-20" });
    const emi = levelEmi(1_00_000_00, 1200, 12);
    const v = await view(w);
    // September's instalment is the EMI (interest plus principal). The prepayment is saving, not an instalment.
    expect(v.emiPaise).toBe(emi);
    expect(v.principalRepaidPaise).toBe(emi - v.needsPaise + 10_000_00);
    expect(v.needsPaise).toBeLessThan(emi);
    expect(v.wantsPaise).toBe(0);
  });

  it("leaves out balance-check bookings from income, and reads card use against the limits", async () => {
    const w = await world();
    await w.api("POST", "/api/balance-check/settle", { accountId: w.hdfc.id, typedPaise: 1_05_000_00 });
    await entry(w, "expense", 20_000_00, "2026-10-10", "Shopping", { accountId: w.millennia.id });
    const v = await view(w, "?period=current");
    expect(v.incomePaise).toBe(0);
    // ₹20,000 owed against ₹2,00,000 and ₹79,000 of limits.
    expect(v.utilizationPct).toBe(7.2);
  });

  it("carries the runway and shows only your own", async () => {
    const w = await world();
    const other = await world();
    await entry(w, "expense", 30_000_00, "2026-10-02", "Rent");
    expect((await view(w, "?period=current")).runway).toMatchObject({ burnPaise: 3_461_538, solid: false });
    expect((await view(other, "?period=current")).spentPaise).toBe(0);
  });
});

describe("money that comes back", () => {
  it("takes money other people paid back off spending, and does not count it as income", async () => {
    const w = await world();
    await entry(w, "income", 1_00_000_00, "2026-09-05", "Salary");
    await entry(w, "expense", 60_000_00, "2026-09-07", "Travel");
    await entry(w, "income", 26_468_00, "2026-09-20", "Repaid by others");
    const v = await view(w);
    expect(v).toMatchObject({ incomePaise: 1_00_000_00, wantsPaise: 33_532_00, spentPaise: 33_532_00, savingsPaise: 66_468_00, reimbursedPaise: 26_468_00 });
  });

  it("takes it off the wants first and then the needs, never below zero", async () => {
    const w = await world();
    await entry(w, "income", 1_00_000_00, "2026-09-05", "Salary");
    await entry(w, "expense", 10_000_00, "2026-09-07", "Shopping");
    await entry(w, "expense", 20_000_00, "2026-09-08", "Rent");
    await entry(w, "income", 15_000_00, "2026-09-20", "Refunds");
    await entry(w, "income", 20_000_00, "2026-09-21", "Repaid by others");
    // ₹35,000 came back: the ₹10,000 of wants, then ₹20,000 of rent, with ₹5,000 more than was spent.
    expect(await view(w)).toMatchObject({ wantsPaise: 0, needsPaise: 0, spentPaise: 0, reimbursedPaise: 35_000_00, savingsPaise: 1_00_000_00 });
  });

  it("is not an empty month when only a refund came in", async () => {
    const w = await world();
    await entry(w, "income", 3_000_00, "2026-09-10", "Refunds");
    expect((await view(w)).empty).toBe(false);
  });

  it("gives every person Dividends, Gifts received and Repaid by others, the last of them a system category", async () => {
    const w = await world();
    const items = (await w.api("GET", "/api/categories")).json.items as Json[];
    const income = items.filter((c) => c.kind === "income").map((c) => c.name);
    expect(income).toEqual(expect.arrayContaining(["Salary", "Cashback", "Interest", "Dividends", "Refunds", "Repaid by others", "Gifts received", "Other income"]));
    expect(items.find((c) => c.name === "Repaid by others")).toMatchObject({ isSystem: true });
    expect(items.find((c) => c.name === "Dividends")).toMatchObject({ isSystem: false });
    const rename = await w.api("PATCH", `/api/categories/${items.find((c) => c.name === "Repaid by others")!.id}`, { name: "Friends" });
    expect(rename.status).toBe(409);
  });

  it("understands repaid, reimbursed and dividend in the bot", async () => {
    const w = await world();
    await w.say("/income 2500 repaid labdhi hdfc");
    expect(w.tg.last.text).toMatch(/Repaid by others/);
    await w.say("/income 17.25 dividend hdfc");
    expect(w.tg.last.text).toMatch(/Dividends/);
  });
});

describe("a repayment counts in the month of the spend", () => {
  // The test clock is 27 Oct, so the last month is September and the current one is October so far.
  async function flights(w: W, extra: object = {}, repaymentDate = "2026-10-05") {
    await entry(w, "income", 1_00_000_00, "2026-09-05", "Salary");
    await entry(w, "expense", 68_000_00, "2026-09-20", "Travel");
    return entry(w, "income", 26_000_00, repaymentDate, "Repaid by others", extra);
  }

  it("offsets the month of the flights, not the month the money arrived, when a day is set", async () => {
    const w = await world();
    const res = await flights(w, { countsForDate: "2026-09-26" });
    expect(res.status).toBe(201);
    expect(res.json.countsForDate).toBe("2026-09-26");
    expect(await view(w)).toMatchObject({ wantsPaise: 42_000_00, spentPaise: 42_000_00, reimbursedPaise: 26_000_00, savingsPaise: 58_000_00 });
    // The October entry no longer reduces October, and is still not income.
    expect(await view(w, "?period=current")).toMatchObject({ incomePaise: 0, reimbursedPaise: 0 });
  });

  it("counts on the day it arrived when no day is set", async () => {
    const w = await world();
    await flights(w);
    expect(await view(w)).toMatchObject({ wantsPaise: 68_000_00, reimbursedPaise: 0 });
    expect(await view(w, "?period=current")).toMatchObject({ incomePaise: 0, reimbursedPaise: 26_000_00 });
  });

  it("works for a refund too, and still takes off wants first and never below zero", async () => {
    const w = await world();
    await entry(w, "income", 1_00_000_00, "2026-09-05", "Salary");
    await entry(w, "expense", 5_000_00, "2026-09-20", "Shopping");
    await entry(w, "income", 8_000_00, "2026-10-08", "Refunds", { countsForDate: "2026-09-25" });
    expect(await view(w)).toMatchObject({ wantsPaise: 0, spentPaise: 0, reimbursedPaise: 8_000_00 });
  });

  it("can be changed or cleared afterwards", async () => {
    const w = await world();
    const created = (await flights(w, { countsForDate: "2026-09-26" })).json as Json;
    expect((await w.api("PATCH", `/api/transactions/${created.id}`, { countsForDate: null })).json.countsForDate).toBeNull();
    expect(await view(w)).toMatchObject({ wantsPaise: 68_000_00 });
    await w.api("PATCH", `/api/transactions/${created.id}`, { countsForDate: "2026-09-20" });
    expect(await view(w)).toMatchObject({ wantsPaise: 42_000_00 });
  });

  it("is only for refunds and money paid back, on income", async () => {
    const w = await world();
    const bad = async (type: string, category: string, extra: object = {}) => {
      const res = await entry(w, type, 1_000_00, "2026-10-05", category, { countsForDate: "2026-09-26", ...extra });
      expect(res.status).toBe(422);
      return res;
    };
    expect((await bad("income", "Salary")).json.error.details[0].path).toBe("countsForDate");
    expect((await bad("expense", "Travel")).json.error.details[0].path).toBe("countsForDate");
    expect((await entry(w, "income", 1_000_00, "2026-10-05", "Refunds", { countsForDate: "2026-02-30" })).status).toBe(422);
    // Without a category it has nothing to belong to.
    expect((await w.api("POST", "/api/transactions", { type: "income", amountPaise: 1_000_00, txnDate: "2026-10-05", accountId: w.hdfc.id, countsForDate: "2026-09-26" })).status).toBe(422);
  });

  it("lets go of the day when the entry is moved to another category", async () => {
    const w = await world();
    const created = (await flights(w, { countsForDate: "2026-09-26" })).json as Json;
    const moved = await w.api("PATCH", `/api/transactions/${created.id}`, { categoryId: w.category("Other income") });
    expect(moved.status).toBe(200);
    expect(moved.json.countsForDate).toBeNull();
  });

  it("is each person's own", async () => {
    const w = await world();
    const other = await world();
    await flights(w, { countsForDate: "2026-09-26" });
    expect((await view(other)).reimbursedPaise).toBe(0);
  });
});

describe("the monthly review", () => {
  it("is sent on the first morning of the next month, with the month in words", async () => {
    const w = await world();
    await september(w);
    await review(w, "2026-10-01");
    const text = mine(w).at(-1)!.text;
    expect(text).toContain("Your month, 1 Sep to 30 Sep.");
    expect(text).toContain("Income ₹1,00,000. Spent ₹38,000.");
    expect(text).toContain("Saved ₹62,000, which is 62% of income (a common aim is 20% or more).");
    expect(text).toContain("Needs ₹25,000 (25%), wants ₹13,000 (13%). A common rule of thumb is 50% needs, 30% wants, 20% saved.");
    expect(text).toContain("₹2,000 of refunds and money other people paid back is taken off spending, and is not counted as income.");
    expect(text).toContain("₹10,000 went into investments.");
    expect(text).toMatch(/Net worth ₹[\d,.]+, (up|down) ₹[\d,.]+ over the month\./);
  });

  it("is sent once, only on that morning, and not for an empty month or when switched off", async () => {
    const w = await world();
    await september(w);
    await review(w, "2026-10-02");
    expect(mine(w)).toHaveLength(0);
    await review(w, "2026-10-01");
    await review(w, "2026-10-01");
    expect(mine(w)).toHaveLength(1);

    const quiet = await world();
    await review(quiet, "2026-10-01");
    expect(mine(quiet)).toHaveLength(0);

    const off = await world();
    await september(off);
    await off.api("PATCH", "/api/settings", { monthlyReview: false });
    await review(off, "2026-10-01");
    expect(mine(off)).toHaveLength(0);
  });

  it("follows the person's own month start", async () => {
    const w = await world();
    await w.api("PATCH", "/api/settings", { periodStartDay: 25 });
    await entry(w, "income", 1_00_000_00, "2026-09-26", "Salary");
    await entry(w, "expense", 30_000_00, "2026-09-28", "Food & Dining");
    await review(w, "2026-10-01");
    expect(mine(w)).toHaveLength(0);
    await review(w, "2026-10-25");
    expect(mine(w).at(-1)!.text).toContain("Your month, 25 Sep to 24 Oct.");
  });

  it("/review gives the last full month on request, or says there is nothing yet", async () => {
    const w = await world();
    await w.say("/review");
    expect(w.tg.last.text).toBe("There is nothing to review yet: no income or spending in your last full month.");
    await september(w);
    await w.say("/review");
    expect(w.tg.last.text).toContain("Saved ₹62,000, which is 62% of income");
  });

  it("says when more went out than came in, and /settings says whether it is on", async () => {
    const w = await world();
    await entry(w, "income", 10_000_00, "2026-09-05", "Salary");
    await entry(w, "expense", 25_000_00, "2026-09-07", "Shopping");
    await w.say("/review");
    expect(w.tg.last.text).toContain("More went out than came in, by ₹15,000.");
    await w.say("/settings");
    expect(w.tg.last.text).toContain("On the first morning of each month I send you a review of the one just ended.");
    await w.api("PATCH", "/api/settings", { monthlyReview: false });
    await w.say("/settings");
    expect(w.tg.last.text).toContain("I shall not send a monthly review.");
  });
});
