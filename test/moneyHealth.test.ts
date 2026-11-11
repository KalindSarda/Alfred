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
    expect(v).toMatchObject({ incomePaise: 1_00_000_00, needsPaise: 25_000_00, wantsPaise: 15_000_00, spentPaise: 40_000_00, savingsPaise: 60_000_00, savingsRatePct: 60, needsPct: 25, wantsPct: 15, investedPaise: 10_000_00, empty: false, savingsBand: "strong" });
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

describe("the monthly review", () => {
  it("is sent on the first morning of the next month, with the month in words", async () => {
    const w = await world();
    await september(w);
    await review(w, "2026-10-01");
    const text = mine(w).at(-1)!.text;
    expect(text).toContain("Your month, 1 Sep to 30 Sep.");
    expect(text).toContain("Income ₹1,00,000. Spent ₹40,000.");
    expect(text).toContain("Saved ₹60,000, which is 60% of income (a common aim is 20% or more).");
    expect(text).toContain("Needs ₹25,000 (25%), wants ₹15,000 (15%). A common rule of thumb is 50% needs, 30% wants, 20% saved.");
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
    expect(w.tg.last.text).toContain("Saved ₹60,000, which is 60% of income");
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
