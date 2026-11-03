import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { transactions } from "../src/db/schema";
import { materializeAllEmi, materializeEmi } from "../src/services/emi";
import { login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST). The card's statement is on the 23rd, due on the 12th of the next month.
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 10_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Millennia", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = (await api("GET", "/api/categories")).json.items as Json[];
  const shopping = cats.find((c) => c.name === "Shopping" && c.kind === "expense")!.id as string;
  const salary = cats.find((c) => c.name === "Salary" && c.kind === "income")!.id as string;
  const plan = (extra: object = {}) =>
    api("POST", "/api/emi-plans", { cardAccountId: card.id, title: "Phone", categoryId: shopping, totalPaise: 1_22_000_00, months: 6, startMonth: "2026-10", ...extra });
  const entries = async (planId?: string) =>
    ((await api("GET", `/api/transactions?accountId=${card.id}&limit=100`)).json.items as Json[]).filter((t) => (planId ? t.note?.startsWith("EMI") : true) && t.source === "emi");
  const cardFigures = async () => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === card.id)!;
  const overview = async () => (await api("GET", "/api/accounts")).json.overview as Json;
  return { app, user, api, bank, card, shopping, salary, plan, entries, cardFigures, overview };
}

describe("creating a plan", () => {
  it("adds the instalments already billed as ordinary expenses on the card, on the statement date", async () => {
    const s = await setup();
    const res = await s.plan();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ title: "Phone", cardName: "Millennia", months: 6, instalmentPaise: 20_333_33, totalPaise: 1_22_000_00, status: "active", billedCount: 1, locked: true, nextDate: "2026-11-23", categoryName: "Shopping" });
    expect(res.json.toComePaise).toBe(1_22_000_00 - 20_333_33);
    const made = await s.entries();
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ type: "expense", amountPaise: 20_333_33, txnDate: "2026-10-23", accountId: s.card.id, categoryId: s.shopping, merchant: "Phone", note: "EMI 1 of 6", source: "emi", status: "confirmed" });
  });

  it("a plan starting in a future month adds nothing yet, and the whole amount is still to come", async () => {
    const s = await setup();
    const res = await s.plan({ startMonth: "2026-12" });
    expect(res.json).toMatchObject({ billedCount: 0, toComePaise: 1_22_000_00, locked: false, nextDate: "2026-12-23" });
    expect(await s.entries()).toHaveLength(0);
  });

  it("an instalment that includes interest makes the plan's total instalment times months", async () => {
    const s = await setup();
    const res = await s.plan({ instalmentPaise: 21_500_00, startMonth: "2026-08" });
    expect(res.json).toMatchObject({ totalPaise: 1_29_000_00, instalmentPaise: 21_500_00, months: 6 });
    expect((await s.entries()).map((t) => t.amountPaise)).toEqual([21_500_00, 21_500_00, 21_500_00]);
  });

  it("backfills past months and the last instalment carries the remainder", async () => {
    const s = await setup();
    await s.plan({ totalPaise: 1_00_000_00, months: 3, startMonth: "2026-08" });
    const made = (await s.entries()).sort((a, b) => a.txnDate.localeCompare(b.txnDate));
    expect(made.map((t) => [t.txnDate, t.amountPaise, t.note])).toEqual([
      ["2026-08-23", 33_333_33, "EMI 1 of 3"],
      ["2026-09-23", 33_333_33, "EMI 2 of 3"],
      ["2026-10-23", 33_333_34, "EMI 3 of 3"],
    ]);
  });

  it("can replace the purchase that was already logged, so it is not counted twice", async () => {
    const s = await setup();
    const purchase = (await s.api("POST", "/api/transactions", { type: "expense", amountPaise: 1_22_000_00, txnDate: "2026-10-10", accountId: s.card.id, categoryId: s.shopping, merchant: "Phone" })).json;
    const before = (await s.cardFigures()).outstandingPaise;
    expect(before).toBe(1_22_000_00);
    expect((await s.plan({ replacesTransactionId: purchase.id })).status).toBe(201);
    expect((await s.api("GET", `/api/transactions/${purchase.id}`)).status).toBe(404);
    expect((await s.cardFigures()).outstandingPaise).toBe(20_333_33);
  });

  it("refuses to replace something that is not an expense on this card", async () => {
    const s = await setup();
    const income = (await s.api("POST", "/api/transactions", { type: "income", amountPaise: 100_00, txnDate: "2026-10-10", accountId: s.bank.id, categoryId: s.salary })).json;
    expect((await s.plan({ replacesTransactionId: income.id })).status).toBe(422);
    expect((await s.plan({ replacesTransactionId: "nope" })).status).toBe(404);
  });

  it("validates what it is given", async () => {
    const s = await setup();
    expect((await s.plan({ months: 0 })).status).toBe(422);
    expect((await s.plan({ months: 61 })).status).toBe(422);
    expect((await s.plan({ startMonth: "2026-13" })).status).toBe(422);
    expect((await s.plan({ totalPaise: 0 })).status).toBe(422);
    expect((await s.plan({ title: "  " })).status).toBe(422);
    expect((await s.plan({ extra: 1 })).status).toBe(422);
    expect((await s.plan({ instalmentPaise: 1_22_000_00, months: 2 })).json.totalPaise).toBe(2_44_000_00);
    expect((await s.plan({ cardAccountId: s.bank.id })).status).toBe(422);
    expect((await s.plan({ cardAccountId: "nope" })).status).toBe(404);
    expect((await s.plan({ categoryId: s.salary })).status).toBe(422);
    await s.api("POST", `/api/accounts/${s.card.id}/archive`);
  });
});

describe("what the card and the totals show", () => {
  it("the whole amount is held against the limit, but the card only owes what has been billed", async () => {
    const s = await setup();
    await s.plan();
    const c = await s.cardFigures();
    expect(c.outstandingPaise).toBe(20_333_33);
    expect(c.emiToComePaise).toBe(1_22_000_00 - 20_333_33);
    expect(c.availableCreditPaise).toBe(2_00_000_00 - 1_22_000_00);
    expect(c.utilizationPct).toBe(61);
  });

  it("net worth counts the whole debt; safe-to-spend only what is billed", async () => {
    const s = await setup();
    await s.plan();
    const o = await s.overview();
    expect(o.cardsOwedPaise).toBe(20_333_33);
    expect(o.emiToComePaise).toBe(1_22_000_00 - 20_333_33);
    expect(o.netWorthPaise).toBe(10_00_000_00 - 1_22_000_00);
    expect(o.safeToSpendPaise).toBe(10_00_000_00 - 20_333_33);
    const summary = (await s.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(summary.safeToSpendPaise).toBe(10_00_000_00 - 20_333_33);
  });

  it("the statement asks only for the instalment, and the instalment is spending in its category", async () => {
    const s = await setup();
    await s.plan();
    const c = await s.cardFigures();
    expect(c.statementOutstandingPaise).toBe(20_333_33);
    expect(c.nextDueDate).toBe("2026-11-12");
    const flow = (await s.api("GET", "/api/dashboard/cashflow?period=cycle")).json;
    expect(flow.expensePaise).toBe(20_333_33);
    expect(flow.expenses[0]).toMatchObject({ name: "Shopping", amountPaise: 20_333_33 });
  });
});

describe("adding instalments as the months pass", () => {
  it("adds the next instalment on its statement date, once, however often it runs", async () => {
    const s = await setup();
    await s.plan();
    expect(await materializeEmi(db, s.user.id, "2026-11-22")).toBe(0);
    expect(await materializeEmi(db, s.user.id, "2026-11-23")).toBe(1);
    expect(await materializeEmi(db, s.user.id, "2026-11-23")).toBe(0);
    expect(await s.entries()).toHaveLength(2);
  });

  it("catches up on every month that was missed", async () => {
    const s = await setup();
    await s.plan();
    expect(await materializeEmi(db, s.user.id, "2027-05-01")).toBe(5);
    const made = await s.entries();
    expect(made).toHaveLength(6);
    expect(made.reduce((sum, t) => sum + t.amountPaise, 0)).toBe(1_22_000_00);
    const plan = ((await s.api("GET", "/api/emi-plans")).json.items as Json[])[0]!;
    expect(plan.status).toBe("active"); // the plan is read as of the test clock, 27 Oct
  });

  it("does not bring back an instalment the person deleted", async () => {
    const s = await setup();
    await s.plan();
    const [first] = await s.entries();
    expect((await s.api("DELETE", `/api/transactions/${first!.id}`)).status).toBe(204);
    expect(await materializeEmi(db, s.user.id, "2026-10-28")).toBe(0);
    expect(await s.entries()).toHaveLength(0);
  });

  it("the daily job does everyone's plans, and one person's failure does not stop it", async () => {
    const a = await setup();
    const b = await setup();
    await a.plan();
    await b.plan();
    const errors: unknown[] = [];
    expect(await materializeAllEmi(db, "2026-11-23", (e) => errors.push(e))).toBeGreaterThanOrEqual(2);
    expect(errors).toHaveLength(0);
    expect(await a.entries()).toHaveLength(2);
    expect(await b.entries()).toHaveLength(2);
  });
});

describe("changing and closing a plan", () => {
  it("renaming or re-categorising updates the instalments already added", async () => {
    const s = await setup();
    const p = (await s.plan()).json;
    const other = ((await s.api("GET", "/api/categories")).json.items as Json[]).find((c) => c.name === "Electronics" || c.name === "Entertainment")!.id;
    const res = await s.api("PATCH", `/api/emi-plans/${p.id}`, { title: "Pixel phone", categoryId: other });
    expect(res.json).toMatchObject({ title: "Pixel phone", categoryId: other });
    expect(await s.entries()).toMatchObject([{ merchant: "Pixel phone", categoryId: other }]);
  });

  it("the amounts and months can change only before any instalment exists", async () => {
    const s = await setup();
    const early = (await s.plan({ startMonth: "2026-12" })).json;
    const res = await s.api("PATCH", `/api/emi-plans/${early.id}`, { months: 12, totalPaise: 1_20_000_00 });
    expect(res.json).toMatchObject({ months: 12, instalmentPaise: 10_000_00, totalPaise: 1_20_000_00 });
    const running = (await s.plan()).json;
    const blocked = await s.api("PATCH", `/api/emi-plans/${running.id}`, { months: 12 });
    expect(blocked.status).toBe(409);
  });

  it("closing a plan early stops further instalments and the remaining debt", async () => {
    const s = await setup();
    const p = (await s.plan()).json;
    const res = await s.api("POST", `/api/emi-plans/${p.id}/cancel`);
    expect(res.json).toMatchObject({ status: "cancelled", toComePaise: 0, nextDate: null, billedCount: 1 });
    expect(await materializeEmi(db, s.user.id, "2027-05-01")).toBe(0);
    expect(await s.entries()).toHaveLength(1);
    expect((await s.cardFigures()).emiToComePaise).toBe(0);
    expect((await s.api("POST", `/api/emi-plans/${p.id}/cancel`)).status).toBe(409);
    expect((await s.api("PATCH", `/api/emi-plans/${p.id}`, { months: 3 })).status).toBe(409);
  });

  it("a plan made by mistake can be deleted until an instalment exists", async () => {
    const s = await setup();
    const early = (await s.plan({ startMonth: "2026-12" })).json;
    expect((await s.api("DELETE", `/api/emi-plans/${early.id}`)).status).toBe(204);
    const running = (await s.plan()).json;
    expect((await s.api("DELETE", `/api/emi-plans/${running.id}`)).status).toBe(409);
    expect(((await s.api("GET", "/api/emi-plans")).json.items as Json[]).map((x) => x.id)).toEqual([running.id]);
  });

  it("lists running plans first, then closed ones", async () => {
    const s = await setup();
    const done = (await s.plan({ title: "Old" })).json;
    await s.api("POST", `/api/emi-plans/${done.id}/cancel`);
    await s.plan({ title: "New", startMonth: "2026-12" });
    const items = (await s.api("GET", "/api/emi-plans")).json.items as Json[];
    expect(items.map((p) => [p.title, p.status])).toEqual([["New", "active"], ["Old", "cancelled"]]);
  });
});

describe("plans and the rest of the app", () => {
  it("a card with a running plan cannot be deleted or archived", async () => {
    const s = await setup();
    await s.plan({ startMonth: "2026-12" });
    expect((await s.api("DELETE", `/api/accounts/${s.card.id}`)).status).toBe(409);
    expect((await s.api("POST", `/api/accounts/${s.card.id}/archive`)).status).toBe(409);
  });

  it("merging a card carries its plans to the target, whose statement day they then follow", async () => {
    const s = await setup();
    const other = (await s.api("POST", "/api/accounts", { kind: "card", name: "Other", creditLimitPaise: 1_00_000_00, statementDay: 5, dueDay: 25 })).json;
    await s.plan({ startMonth: "2026-12" });
    expect((await s.api("POST", `/api/accounts/${s.card.id}/merge`, { intoId: other.id })).status).toBe(200);
    const plan = ((await s.api("GET", "/api/emi-plans")).json.items as Json[])[0]!;
    expect(plan).toMatchObject({ cardAccountId: other.id, cardName: "Other", nextDate: "2026-12-05" });
  });

  it("the JSON export includes the plans, without user ids", async () => {
    const s = await setup();
    await s.plan({ startMonth: "2026-12" });
    const body = (await s.api("GET", "/api/export/json")).json;
    expect(body.emiPlans).toHaveLength(1);
    expect(body.emiPlans[0]).toMatchObject({ title: "Phone", months: 6 });
    expect(JSON.stringify(body.emiPlans)).not.toContain("userId");
  });

  it("never touches another person's plans or entries", async () => {
    const a = await setup();
    const b = await setup();
    const p = (await a.plan({ startMonth: "2026-12" })).json;
    expect((await b.api("PATCH", `/api/emi-plans/${p.id}`, { title: "x" })).status).toBe(404);
    expect((await b.api("POST", `/api/emi-plans/${p.id}/cancel`)).status).toBe(404);
    expect((await b.api("DELETE", `/api/emi-plans/${p.id}`)).status).toBe(404);
    expect((await b.api("GET", "/api/emi-plans")).json.items).toEqual([]);
    expect((await b.plan({ cardAccountId: a.card.id })).status).toBe(404);
    const theirs = (await a.api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-10-10", accountId: a.card.id })).json;
    expect((await b.plan({ replacesTransactionId: theirs.id })).status).toBe(404);
    expect(await db.select().from(transactions).where(and(eq(transactions.userId, b.user.id), eq(transactions.source, "emi")))).toHaveLength(0);
  });

  it("needs a session", async () => {
    expect((await makeApp().call("GET", "/api/emi-plans")).status).toBe(401);
  });
});
