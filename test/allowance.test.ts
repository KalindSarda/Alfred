import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { allowance, streak } from "../src/domain/allowance";
import { periodReserves } from "../src/db/schema";
import { login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

describe("the weekly allowance", () => {
  // The 30th to the 29th: 31 days, so four weeks of seven and a last one of three.
  const from = "2026-10-30";
  const until = "2026-11-30";
  const at = (today: string, flexiblePaise: number, spent: [string, number][] = []) => allowance({ from, until, today, flexiblePaise, spentByDay: new Map(spent) });

  it("cuts the period into weeks of seven days, the last one shorter", () => {
    const first = at("2026-10-30", 31_000_00).week!;
    expect(first).toMatchObject({ index: 1, of: 5, from: "2026-10-30", to: "2026-11-05", budgetPaise: 7_000_00, leftPaise: 7_000_00, perDayPaise: 1_000_00, daysLeft: 7, nextWeekPaise: 7_000_00 });
    const last = at("2026-11-29", 3_000_00).week!;
    expect(last).toMatchObject({ index: 5, from: "2026-11-27", to: "2026-11-29", budgetPaise: 3_000_00, daysLeft: 1, perDayPaise: 3_000_00, nextWeekPaise: null });
  });

  it("takes what has been spent this week off the week, and spreads the rest over the days left", () => {
    // 2,000 spent on the first day: 29,000 is left, so the week still began with 31,000
    const w = at("2026-10-31", 29_000_00, [["2026-10-30", 2_000_00]]).week!;
    expect(w).toMatchObject({ budgetPaise: 7_000_00, spentPaise: 2_000_00, leftPaise: 5_000_00, overPaise: 0, daysLeft: 6, perDayPaise: 833_33 });
  });

  it("rolls what was not spent into the later weeks", () => {
    // Only 3,000 spent in the first week, so the second week begins with more than 7,000
    const w = at("2026-11-06", 28_000_00, [["2026-10-31", 3_000_00]]).week!;
    expect(w).toMatchObject({ index: 2, budgetPaise: Math.floor((28_000_00 * 7) / 24), spentPaise: 0 });
    expect(w.budgetPaise).toBeGreaterThan(7_000_00);
  });

  it("lowers the later weeks after overspending, and never shows a negative", () => {
    const w = at("2026-11-02", 22_000_00, [["2026-10-30", 9_000_00]]).week!;
    expect(w).toMatchObject({ budgetPaise: 7_000_00, spentPaise: 9_000_00, leftPaise: 0, overPaise: 2_000_00, perDayPaise: 0 });
    expect(w.nextWeekPaise).toBe(Math.floor((22_000_00 * 7) / 24));
    expect(w.nextWeekPaise).toBeLessThan(7_000_00);
  });

  it("has no week budget when nothing is free", () => {
    expect(at("2026-11-02", -5_000_00).week).toMatchObject({ budgetPaise: 0, leftPaise: 0, nextWeekPaise: 0 });
    expect(at("2026-11-02", -5_000_00).pace).toBeNull();
  });

  it("says nothing outside the period", () => {
    expect(at("2026-10-29", 1_000_00)).toEqual({ week: null, pace: null });
    expect(at("2026-11-30", 1_000_00)).toEqual({ week: null, pace: null });
  });

  it("measures the pace against an even spread of the period's money", () => {
    // 31,000 over 31 days is 1,000 a day; by the end of day 4 (elapsed 3) 4,000 would have been allowed
    const under = at("2026-11-02", 29_000_00, [["2026-10-30", 2_000_00]]).pace!;
    expect(under).toMatchObject({ spentPaise: 2_000_00, expectedPaise: 4_000_00, aheadPaise: 2_000_00 });
    const over = at("2026-11-02", 25_000_00, [["2026-10-30", 6_000_00]]).pace!;
    expect(over.aheadPaise).toBe(-2_000_00);
  });
});

describe("the no-spend streak", () => {
  const set = (...days: string[]) => new Set(days);
  const base = { today: "2026-11-10", since: "2026-11-01" };

  it("counts days with nothing spent that the person said so, through yesterday", () => {
    const s = streak({ ...base, spendDays: set(), nothingDays: set("2026-11-07", "2026-11-08", "2026-11-09"), loggedDays: set() });
    expect(s).toEqual({ current: 3, best: 3, todayCounts: false });
  });

  it("counts a day on which something else was logged, and is not broken by bills or investments", () => {
    const s = streak({ ...base, spendDays: set(), nothingDays: set(), loggedDays: set("2026-11-08", "2026-11-09", "2026-11-10") });
    expect(s).toEqual({ current: 3, best: 3, todayCounts: true });
  });

  it("is broken by a spend, and does not count a day nobody logged", () => {
    const s = streak({ ...base, spendDays: set("2026-11-05"), nothingDays: set("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-07", "2026-11-08", "2026-11-09"), loggedDays: set() });
    // 5 Nov had a spend, 6 Nov nothing was said: the run is 7 to 9 Nov, and the best was 2 to 4 Nov
    expect(s).toEqual({ current: 3, best: 3, todayCounts: false });
  });

  it("is waiting, not broken, while today has nothing yet, but a spend today ends it", () => {
    const open = streak({ ...base, spendDays: set(), nothingDays: set("2026-11-08", "2026-11-09"), loggedDays: set() });
    expect(open.current).toBe(2);
    const spent = streak({ ...base, spendDays: set("2026-11-10"), nothingDays: set("2026-11-08", "2026-11-09"), loggedDays: set("2026-11-10") });
    expect(spent.current).toBe(0);
    expect(spent.best).toBe(2);
  });

  it("is nothing with no history", () => {
    expect(streak({ today: "2026-11-10", since: "2026-11-10", spendDays: set(), nothingDays: set(), loggedDays: set() })).toEqual({ current: 0, best: 0, todayCounts: false });
  });
});

// The test clock is 2026-10-27 (IST). The period starts on the 1st, so it runs 1 Oct to 31 Oct and ends before 1 Nov.
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 31_000_00 })).json;
  const cat = ((await api("GET", "/api/categories")).json.items as Json[]).find((c) => c.kind === "expense")!;
  const spend = (paise: number, date = "2026-10-27") => api("POST", "/api/transactions", { type: "expense", amountPaise: paise, txnDate: date, accountId: bank.id, categoryId: cat.id });
  const get = async () => (await api("GET", "/api/allowance")).json;
  return { api, bank, cat, spend, get, userId: user.id };
}

describe("the allowance through the app", () => {
  it("is the free money cut into weeks, with this week's spending taken off", async () => {
    const s = await setup();
    const before = await s.get();
    expect(before).toMatchObject({ from: "2026-10-01", until: "2026-11-01", basis: "month", freeToSpendPaise: 31_000_00, flexiblePaise: 31_000_00, goalsPaise: 0, reservesPaise: 0 });
    // 27 Oct is the 27th day of 31: the fourth week runs 22 to 28 Oct
    expect(before.week).toMatchObject({ index: 4, from: "2026-10-22", to: "2026-10-28", daysLeft: 2 });
    await s.spend(1_000_00);
    const after = await s.get();
    expect(after.flexiblePaise).toBe(30_000_00);
    expect(after.week.spentPaise).toBe(1_000_00);
    expect(after.week.leftPaise).toBe(before.week.leftPaise - 1_000_00);
    expect(after.pace).toMatchObject({ spentPaise: 1_000_00 });
  });

  it("does not count income, investments or what a recurring rule made as everyday spending", async () => {
    const s = await setup();
    await s.api("POST", "/api/transactions", { type: "income", amountPaise: 5_000_00, txnDate: "2026-10-27", accountId: s.bank.id, categoryId: ((await s.api("GET", "/api/categories")).json.items as Json[]).find((c) => c.kind === "income")!.id });
    const rule = await s.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 2_000_00, accountId: s.bank.id, frequency: "monthly", day: 27, startDate: "2026-10-27" });
    expect(rule.status).toBe(201);
    const a = await s.get();
    expect(a.week.spentPaise).toBe(0);
    expect(a.pace.spentPaise).toBe(0);
  });

  it("holds back the money to move first until it is marked moved, and brings it back next period", async () => {
    const s = await setup();
    const made = await s.api("POST", "/api/allowance/reserves", { name: "Move to savings", amountPaise: 10_000_00 });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: "Move to savings", amountPaise: 10_000_00, moved: false });
    expect(await s.get()).toMatchObject({ reservesPaise: 10_000_00, flexiblePaise: 21_000_00 });
    const moved = await s.api("POST", `/api/allowance/reserves/${made.json.id}/moved`, {});
    expect(moved.json.moved).toBe(true);
    expect(await s.get()).toMatchObject({ reservesPaise: 0, flexiblePaise: 31_000_00 });
    // moved for an earlier period: held back again
    await db.update(periodReserves).set({ doneFor: "2026-09-01" }).where(eq(periodReserves.id, made.json.id));
    expect(await s.get()).toMatchObject({ reservesPaise: 10_000_00 });
    expect((await s.api("POST", `/api/allowance/reserves/${made.json.id}/moved`, { moved: false })).json.moved).toBe(false);
    const edited = await s.api("PATCH", `/api/allowance/reserves/${made.json.id}`, { name: "Savings", amountPaise: 12_000_00 });
    expect(edited.json).toMatchObject({ name: "Savings", amountPaise: 12_000_00 });
    expect((await s.api("DELETE", `/api/allowance/reserves/${made.json.id}`)).status).toBe(204);
    expect((await s.get()).reserves).toEqual([]);
  });

  it("holds back the goals' monthly amounts until something is put toward them", async () => {
    const s = await setup();
    const goal = await s.api("POST", "/api/goals", { name: "Trip", targetPaise: 12_000_00, targetDate: "2027-04-27" });
    expect(goal.status).toBe(201);
    const need = goal.json.monthlyNeededPaise as number;
    expect(need).toBeGreaterThan(0);
    expect((await s.get()).goalsPaise).toBe(need);
    await s.api("POST", `/api/goals/${goal.json.id}/contributions`, { amountPaise: need, date: "2026-10-27" });
    expect((await s.get()).goalsPaise).toBe(0);
  });

  it("refuses what does not fit and keeps people apart", async () => {
    const s = await setup();
    const other = await setup();
    expect((await s.api("POST", "/api/allowance/reserves", { name: "", amountPaise: 5 })).status).toBe(422);
    expect((await s.api("POST", "/api/allowance/reserves", { name: "x", amountPaise: 0 })).status).toBe(422);
    const mine = await s.api("POST", "/api/allowance/reserves", { name: "Mine", amountPaise: 5_00 });
    expect((await other.api("POST", `/api/allowance/reserves/${mine.json.id}/moved`, {})).status).toBe(404);
    expect((await other.api("DELETE", `/api/allowance/reserves/${mine.json.id}`)).status).toBe(404);
    expect((await other.api("PATCH", `/api/allowance/reserves/${mine.json.id}`, { name: "x" })).status).toBe(404);
    expect((await other.get()).reserves).toEqual([]);
  });

  it("counts a no-spend day once the person says so, and a spend ends it", async () => {
    const s = await setup();
    expect((await s.get()).streak).toEqual({ current: 0, best: 0, todayCounts: false });
    const said = await s.api("POST", "/api/allowance/nothing-today", {});
    expect(said.json).toMatchObject({ nothingToday: true, streak: { todayCounts: true, current: 1, best: 1 } });
    expect((await s.api("POST", "/api/allowance/nothing-today", {})).status).toBe(200);
    await s.spend(100_00);
    expect((await s.get()).streak).toMatchObject({ current: 0, todayCounts: false });
  });

  it("is in the data export, and goes with the person", async () => {
    const s = await setup();
    await s.api("POST", "/api/allowance/reserves", { name: "Savings", amountPaise: 5_000_00 });
    const out = (await s.api("GET", "/api/export/json")).json;
    expect(out.periodReserves).toHaveLength(1);
    expect(out.periodReserves[0]).toMatchObject({ name: "Savings", amountPaise: 5_000_00 });
    expect(out.periodReserves[0].userId).toBeUndefined();
  });
});
