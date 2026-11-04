import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { transactions } from "../src/db/schema";
import { materializeRules } from "../src/services/recurring";
import { login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST), a Tuesday.
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 5_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = (await api("GET", "/api/categories")).json.items as Json[];
  const rent = cats.find((c) => c.name === "Rent" && c.kind === "expense")!.id as string;
  const salary = cats.find((c) => c.name === "Salary" && c.kind === "income")!.id as string;
  const rule = (extra: object = {}) =>
    api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: bank.id, categoryId: rent, frequency: "monthly", day: 5, ...extra });
  const entries = async (ruleId?: string) => {
    const rows = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.source, "recurring")));
    return rows.filter((t) => !ruleId || t.recurringRuleId === ruleId).sort((a, b) => a.txnDate.localeCompare(b.txnDate));
  };
  const bankBalance = async () => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === bank.id)!.balancePaise as number;
  return { app, user, api, bank, card, rent, salary, rule, entries, bankBalance };
}

describe("creating a rule", () => {
  it("starting today adds nothing yet and shows the next dates", async () => {
    const s = await setup();
    const res = await s.rule();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ title: "Rent", repeat: "Every month on the 5th", status: "active", nextDate: "2026-11-05", upcoming: ["2026-11-05", "2026-12-05", "2027-01-05"], mode: "auto", entries: 0, accountName: "HDFC", categoryName: "Rent" });
    expect(await s.entries()).toHaveLength(0);
  });

  it("a start in the past adds the missed ones as confirmed entries on the account", async () => {
    const s = await setup();
    const before = await s.bankBalance();
    const res = await s.rule({ startDate: "2026-08-05" });
    expect(res.json).toMatchObject({ entries: 3, nextDate: "2026-11-05" });
    const made = await s.entries();
    expect(made.map((t) => [t.txnDate, t.amountPaise, t.status, t.type, t.merchant, t.accountId, t.categoryId])).toEqual(
      ["2026-08-05", "2026-09-05", "2026-10-05"].map((d) => [d, 22_000_00, "confirmed", "expense", "Rent", s.bank.id, s.rent]),
    );
    expect(made.every((t) => t.recurringOn === t.txnDate && t.recurringRuleId === res.json.id)).toBe(true);
    expect(await s.bankBalance()).toBe(before - 66_000_00);
    const summary = (await s.api("GET", "/api/dashboard/summary?period=ytd")).json;
    expect(summary.expensePaise).toBe(66_000_00);
  });

  it("adds at most the latest 36 missed entries", async () => {
    const s = await setup();
    const res = await s.rule({ frequency: "weekly", day: 1, startDate: "2025-01-01", title: "Gym" });
    expect(res.status).toBe(201);
    const made = await s.entries();
    expect(made).toHaveLength(36);
    expect(made.at(-1)!.txnDate).toBe("2026-10-26");
  });

  it("a draft rule adds drafts, which do not count until confirmed", async () => {
    const s = await setup();
    const before = await s.bankBalance();
    await s.rule({ startDate: "2026-10-01", mode: "draft", title: "Electricity", amountPaise: 3_000_00 });
    const made = await s.entries();
    expect(made.map((t) => [t.txnDate, t.status])).toEqual([["2026-10-05", "draft"]]);
    expect(await s.bankBalance()).toBe(before);
    expect(((await s.api("GET", "/api/dashboard/summary?period=cycle")).json.draftCount) as number).toBe(1);
    await s.api("PATCH", `/api/transactions/${made[0]!.id}`, { status: "confirmed", amountPaise: 3_250_00 });
    expect(await s.bankBalance()).toBe(before - 3_250_00);
  });

  it("income is credited and an investment lowers the balance without being spending", async () => {
    const s = await setup();
    const before = await s.bankBalance();
    await s.rule({ type: "income", title: "Salary", amountPaise: 90_000_00, categoryId: s.salary, day: 1, startDate: "2026-10-01" });
    await s.rule({ type: "investment", title: "Index fund SIP", amountPaise: 10_000_00, categoryId: null, day: 3, startDate: "2026-10-01" });
    expect(await s.bankBalance()).toBe(before + 90_000_00 - 10_000_00);
    const summary = (await s.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(summary).toMatchObject({ incomePaise: 90_000_00, expensePaise: 0 });
    expect((await s.entries()).map((t) => t.type).sort()).toEqual(["income", "investment"]);
  });

  it("can repeat yearly and weekly", async () => {
    const s = await setup();
    const y = await s.rule({ frequency: "yearly", month: 3, day: 14, title: "Insurance", startDate: "2026-01-01" });
    expect(y.json).toMatchObject({ repeat: "Every year on 14 Mar", nextDate: "2027-03-14", entries: 1 });
    const w = await s.rule({ frequency: "weekly", day: 5, title: "Groceries run" });
    expect(w.json).toMatchObject({ repeat: "Every Friday", nextDate: "2026-10-30" });
  });

  it("validates what it is given", async () => {
    const s = await setup();
    expect((await s.rule({ day: 32 })).status).toBe(422);
    expect((await s.rule({ day: 0 })).status).toBe(422);
    expect((await s.rule({ amountPaise: 0 })).status).toBe(422);
    expect((await s.rule({ title: " " })).status).toBe(422);
    expect((await s.rule({ remindDaysBefore: 0 })).status).toBe(422);
    expect((await s.rule({ remindDaysBefore: 8 })).status).toBe(422);
    expect((await s.rule({ frequency: "yearly", day: 5 })).status).toBe(422);
    expect((await s.rule({ frequency: "yearly", month: 2, day: 30 })).status).toBe(422);
    expect((await s.rule({ frequency: "weekly", day: 8 })).status).toBe(422);
    expect((await s.rule({ startDate: "2026-02-30" })).status).toBe(422);
    expect((await s.rule({ startDate: "2026-11-01", endDate: "2026-10-01" })).status).toBe(422);
    expect((await s.rule({ extra: 1 })).status).toBe(422);
    expect((await s.rule({ accountId: "nope" })).status).toBe(404);
    expect((await s.rule({ type: "investment", accountId: s.card.id, categoryId: null })).status).toBe(422);
    expect((await s.rule({ type: "investment" })).status).toBe(422); // a category on an investment
    expect((await s.rule({ type: "income" })).status).toBe(422); // an expense category on income
    await s.api("POST", `/api/accounts/${s.card.id}/archive`);
    expect((await s.rule({ accountId: s.card.id })).status).toBe(422);
  });

  it("needs a session", async () => {
    expect((await makeApp().call("GET", "/api/recurring")).status).toBe(401);
  });
});

describe("as the days pass", () => {
  it("adds the next due date once, however often it runs", async () => {
    const s = await setup();
    const r = (await s.rule()).json;
    expect((await materializeRules(db, s.user.id, "2026-11-04")).added).toBe(0);
    expect((await materializeRules(db, s.user.id, "2026-11-05")).added).toBe(1);
    expect((await materializeRules(db, s.user.id, "2026-11-05")).added).toBe(0);
    expect(await s.entries(r.id)).toHaveLength(1);
  });

  it("catches up on every missed month", async () => {
    const s = await setup();
    await s.rule();
    expect((await materializeRules(db, s.user.id, "2027-02-10")).added).toBe(4);
  });

  it("does not bring back an entry the person deleted", async () => {
    const s = await setup();
    await s.rule({ startDate: "2026-10-01" });
    const [first] = await s.entries();
    expect((await s.api("DELETE", `/api/transactions/${first!.id}`)).status).toBe(204);
    expect((await materializeRules(db, s.user.id, "2026-10-28")).added).toBe(0);
    expect((await s.api("GET", "/api/transactions?limit=50")).json.items.filter((t: Json) => t.source === "recurring")).toHaveLength(0);
  });

  it("stops at its end date", async () => {
    const s = await setup();
    const r = (await s.rule({ endDate: "2026-12-31" })).json;
    await materializeRules(db, s.user.id, "2027-06-01");
    expect((await s.entries(r.id)).map((t) => t.txnDate)).toEqual(["2026-11-05", "2026-12-05"]);
    expect(((await s.api("GET", "/api/recurring")).json.items as Json[])[0]).toMatchObject({ status: "ended", nextDate: null });
  });

  it("skipping the next one leaves it out once", async () => {
    const s = await setup();
    const r = (await s.rule()).json;
    const res = await s.api("POST", `/api/recurring/${r.id}/skip`);
    expect(res.json).toMatchObject({ nextDate: "2026-12-05" });
    await materializeRules(db, s.user.id, "2027-01-10");
    expect((await s.entries(r.id)).map((t) => t.txnDate)).toEqual(["2026-12-05", "2027-01-05"]);
  });

  it("pausing adds nothing; resuming skips what fell during the pause", async () => {
    const s = await setup();
    const r = (await s.rule()).json;
    expect((await s.api("POST", `/api/recurring/${r.id}/pause`)).json.status).toBe("paused");
    expect((await s.api("POST", `/api/recurring/${r.id}/pause`)).status).toBe(409);
    expect((await materializeRules(db, s.user.id, "2026-12-20")).added).toBe(0);
    expect(await s.entries(r.id)).toHaveLength(0);
    // The test clock is still 27 Oct, so everything from the pause to "today" is nothing to skip; carry on from there.
    const resumed = await s.api("POST", `/api/recurring/${r.id}/resume`);
    expect(resumed.json.status).toBe("active");
    expect((await s.api("POST", `/api/recurring/${r.id}/resume`)).status).toBe(409);
    expect((await materializeRules(db, s.user.id, "2026-11-05")).added).toBe(1);
  });

  it("changing the amount affects the next ones, not those already made", async () => {
    const s = await setup();
    const r = (await s.rule({ startDate: "2026-10-01" })).json;
    await s.api("PATCH", `/api/recurring/${r.id}`, { amountPaise: 25_000_00 });
    await materializeRules(db, s.user.id, "2026-11-10");
    expect((await s.entries(r.id)).map((t) => t.amountPaise)).toEqual([22_000_00, 25_000_00]);
  });

  it("changing how it repeats starts the new pattern from today, so nothing is duplicated", async () => {
    const s = await setup();
    const r = (await s.rule({ startDate: "2026-09-01" })).json; // made 5 Sep and 5 Oct
    const res = await s.api("PATCH", `/api/recurring/${r.id}`, { day: 20 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ repeat: "Every month on the 20th", startDate: "2026-10-27", nextDate: "2026-11-20" });
    expect(await s.entries(r.id)).toHaveLength(2);
  });

  it("rejects an invalid change", async () => {
    const s = await setup();
    const r = (await s.rule()).json;
    expect((await s.api("PATCH", `/api/recurring/${r.id}`, { day: 40 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/recurring/${r.id}`, { frequency: "yearly" })).status).toBe(422);
    expect((await s.api("PATCH", `/api/recurring/${r.id}`, { accountId: "nope" })).status).toBe(404);
    expect((await s.api("PATCH", "/api/recurring/nope", { title: "x" })).status).toBe(404);
  });

  it("deleting a rule keeps the entries it made", async () => {
    const s = await setup();
    const r = (await s.rule({ startDate: "2026-10-01" })).json;
    expect((await s.api("DELETE", `/api/recurring/${r.id}`)).status).toBe(204);
    expect(await s.entries()).toHaveLength(1);
    expect((await s.api("GET", "/api/recurring")).json.items).toEqual([]);
  });
});

describe("rules and the rest of the app", () => {
  it("an account with a rule cannot be deleted, and cannot be archived while the rule runs", async () => {
    const s = await setup();
    const acc = (await s.api("POST", "/api/accounts", { kind: "bank", name: "Temp", openingBalancePaise: 0 })).json;
    const r = (await s.rule({ accountId: acc.id })).json;
    expect((await s.api("DELETE", `/api/accounts/${acc.id}`)).status).toBe(409);
    expect((await s.api("POST", `/api/accounts/${acc.id}/archive`)).status).toBe(409);
    await s.api("POST", `/api/recurring/${r.id}/pause`);
    expect((await s.api("POST", `/api/accounts/${acc.id}/archive`)).status).toBe(200);
  });

  it("merging accounts moves the rules to the target", async () => {
    const s = await setup();
    const other = (await s.api("POST", "/api/accounts", { kind: "bank", name: "Old", openingBalancePaise: 0 })).json;
    const r = (await s.rule({ accountId: other.id })).json;
    expect((await s.api("POST", `/api/accounts/${other.id}/merge`, { intoId: s.bank.id })).status).toBe(200);
    expect(((await s.api("GET", "/api/recurring")).json.items as Json[]).find((x) => x.id === r.id)).toMatchObject({ accountId: s.bank.id, accountName: "HDFC" });
  });

  it("deleting or merging a category carries its rules along", async () => {
    const s = await setup();
    const cats = (await s.api("GET", "/api/categories")).json.items as Json[];
    const sub = cats.find((c) => c.name === "Subscriptions")!.id as string;
    const ent = cats.find((c) => c.name === "Entertainment")!.id as string;
    const r = (await s.rule({ title: "Netflix", categoryId: sub })).json;
    expect((await s.api("POST", `/api/categories/${sub}/merge`, { intoId: ent })).status).toBe(200);
    expect(((await s.api("GET", "/api/recurring")).json.items as Json[]).find((x) => x.id === r.id)!.categoryId).toBe(ent);
    expect((await s.api("DELETE", `/api/categories/${ent}`)).status).toBe(204);
    expect(((await s.api("GET", "/api/recurring")).json.items as Json[]).find((x) => x.id === r.id)!.categoryId).toBeNull();
  });

  it("the JSON export includes the rules, without user ids", async () => {
    const s = await setup();
    await s.rule();
    const body = (await s.api("GET", "/api/export/json")).json;
    expect(body.recurringRules).toHaveLength(1);
    expect(body.recurringRules[0]).toMatchObject({ title: "Rent", frequency: "monthly", day: 5 });
    expect(JSON.stringify(body.recurringRules)).not.toContain("userId");
  });

  it("never touches another person's rules", async () => {
    const a = await setup();
    const b = await setup();
    const r = (await a.rule()).json;
    for (const call of [
      b.api("PATCH", `/api/recurring/${r.id}`, { title: "x" }),
      b.api("POST", `/api/recurring/${r.id}/pause`),
      b.api("POST", `/api/recurring/${r.id}/resume`),
      b.api("POST", `/api/recurring/${r.id}/skip`),
      b.api("DELETE", `/api/recurring/${r.id}`),
    ]) {
      expect((await call).status).toBe(404);
    }
    expect((await b.api("GET", "/api/recurring")).json.items).toEqual([]);
    expect((await b.rule({ accountId: a.bank.id })).status).toBe(404);
    expect(((await a.api("GET", "/api/recurring")).json.items as Json[])).toHaveLength(1);
  });
});
