import { describe, expect, it } from "vitest";
import { statusOf } from "../src/services/budgets";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST).
async function setup(startDay?: number) {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  if (startDay !== undefined) await api("PATCH", "/api/settings", { periodStartDay: startDay });
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "Bank", openingBalancePaise: 10_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = (await api("GET", "/api/categories")).json.items as Json[];
  const id = (name: string, kind = "expense") => cats.find((c) => c.name === name && c.kind === kind)!.id as string;
  const spend = (amount: number, date: string, extra: object = {}) =>
    api("POST", "/api/transactions", { type: "expense", amountPaise: amount, txnDate: date, accountId: bank.id, ...extra });
  return { api, bank, card, id, spend };
}

describe("statusOf", () => {
  it("is ok below 80%, near from 80% up to and including the limit, and over beyond it", () => {
    expect(statusOf(7_999, 10_000)).toBe("ok");
    expect(statusOf(8_000, 10_000)).toBe("near");
    expect(statusOf(9_999, 10_000)).toBe("near");
    expect(statusOf(10_000, 10_000)).toBe("near");
    expect(statusOf(10_001, 10_000)).toBe("over");
    expect(statusOf(0, 10_000)).toBe("ok");
  });
});

describe("budgets API", () => {
  it("starts empty with the current month's range", async () => {
    const { api } = await setup();
    const res = (await api("GET", "/api/budgets")).json;
    expect(res).toEqual({ period: { from: "2026-10-01", to: "2026-10-31" }, totalLimitPaise: 0, totalSpentPaise: 0, items: [] });
  });

  it("sets a limit and reports spending against it", async () => {
    const { api, id, spend } = await setup();
    await spend(2_500_00, "2026-10-05", { categoryId: id("Food & Dining") });
    await spend(1_000_00, "2026-10-20", { categoryId: id("Food & Dining") });
    const set = await api("PUT", `/api/budgets/${id("Food & Dining")}`, { limitPaise: 6_000_00 });
    expect(set.status).toBe(200);
    expect(set.json.items).toEqual([
      {
        categoryId: id("Food & Dining"),
        categoryName: "Food & Dining",
        limitPaise: 6_000_00,
        spentPaise: 3_500_00,
        remainingPaise: 2_500_00,
        pct: 58.3,
        status: "ok",
      },
    ]);
    expect(set.json.totalLimitPaise).toBe(6_000_00);
    expect(set.json.totalSpentPaise).toBe(3_500_00);
  });

  it("changing a limit replaces it rather than adding another", async () => {
    const { api, id } = await setup();
    await api("PUT", `/api/budgets/${id("Fuel")}`, { limitPaise: 2_000_00 });
    const res = (await api("PUT", `/api/budgets/${id("Fuel")}`, { limitPaise: 3_000_00 })).json;
    expect(res.items).toHaveLength(1);
    expect(res.items[0].limitPaise).toBe(3_000_00);
  });

  it("flags near and over, and lists the most pressed budget first", async () => {
    const { api, id, spend } = await setup();
    await spend(850_00, "2026-10-05", { categoryId: id("Fuel") }); // 85%
    await spend(1_200_00, "2026-10-06", { categoryId: id("Groceries") }); // 120%
    await spend(100_00, "2026-10-07", { categoryId: id("Rent") }); // 10%
    for (const [name, limit] of [["Fuel", 1_000_00], ["Groceries", 1_000_00], ["Rent", 1_000_00]] as const) {
      await api("PUT", `/api/budgets/${id(name)}`, { limitPaise: limit });
    }
    const items = (await api("GET", "/api/budgets")).json.items as Json[];
    expect(items.map((i) => [i.categoryName, i.status])).toEqual([["Groceries", "over"], ["Fuel", "near"], ["Rent", "ok"]]);
    expect(items[0]!.remainingPaise).toBe(-200_00);
    expect(items[0]!.pct).toBe(120);
  });

  it("only confirmed expenses in the category and month count", async () => {
    const { api, bank, card, id, spend } = await setup();
    const food = id("Food & Dining");
    await api("PUT", `/api/budgets/${food}`, { limitPaise: 10_000_00 });
    await spend(1_000_00, "2026-10-05", { categoryId: food }); // counts
    await spend(500_00, "2026-10-06", { categoryId: food, status: "draft" }); // draft: no
    await spend(400_00, "2026-09-30", { categoryId: food }); // last month: no
    await spend(300_00, "2026-10-08", { categoryId: id("Fuel") }); // other category: no
    const gone = (await spend(900_00, "2026-10-09", { categoryId: food })).json;
    await api("DELETE", `/api/transactions/${gone.id}`); // deleted: no
    await api("POST", "/api/transactions", { type: "income", amountPaise: 700_00, txnDate: "2026-10-10", accountId: bank.id, categoryId: id("Salary", "income") });
    await api("POST", "/api/transactions", { type: "bill_payment", amountPaise: 600_00, txnDate: "2026-10-11", accountId: bank.id, toAccountId: card.id });
    const item = ((await api("GET", "/api/budgets")).json.items as Json[])[0]!;
    expect(item.spentPaise).toBe(1_000_00);
  });

  it("expenses on a credit card count the same as on a bank", async () => {
    const { api, card, id } = await setup();
    await api("PUT", `/api/budgets/${id("Shopping")}`, { limitPaise: 5_000_00 });
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 1_500_00, txnDate: "2026-10-12", accountId: card.id, categoryId: id("Shopping") });
    expect(((await api("GET", "/api/budgets")).json.items as Json[])[0]!.spentPaise).toBe(1_500_00);
  });

  it("measures against the user's own month, not the calendar month", async () => {
    const { api, id, spend } = await setup(30);
    const food = id("Food & Dining");
    await api("PUT", `/api/budgets/${food}`, { limitPaise: 10_000_00 });
    await spend(2_000_00, "2026-09-30", { categoryId: food }); // first day of the cycle 30 Sep - 29 Oct
    await spend(1_000_00, "2026-09-29", { categoryId: food }); // the cycle before
    const res = (await api("GET", "/api/budgets")).json;
    expect(res.period).toEqual({ from: "2026-09-30", to: "2026-10-29" });
    expect(res.items[0].spentPaise).toBe(2_000_00);
  });

  it("removes a budget", async () => {
    const { api, id } = await setup();
    await api("PUT", `/api/budgets/${id("Fuel")}`, { limitPaise: 2_000_00 });
    expect((await api("DELETE", `/api/budgets/${id("Fuel")}`)).status).toBe(204);
    expect(((await api("GET", "/api/budgets")).json.items as Json[])).toHaveLength(0);
    expect((await api("DELETE", `/api/budgets/${id("Fuel")}`)).status).toBe(404);
  });

  it("validates the limit and the category", async () => {
    const { api, id } = await setup();
    const fuel = id("Fuel");
    for (const bad of [0, -5, 1.5, "100", null]) {
      expect((await api("PUT", `/api/budgets/${fuel}`, { limitPaise: bad })).status, String(bad)).toBe(422);
    }
    expect((await api("PUT", `/api/budgets/${fuel}`, { limitPaise: 100, extra: 1 })).status).toBe(422);
    expect((await api("PUT", `/api/budgets/${id("Salary", "income")}`, { limitPaise: 100 })).status).toBe(422);
    expect((await api("PUT", "/api/budgets/not-a-category", { limitPaise: 100 })).status).toBe(404);
  });

  it("refuses an archived category", async () => {
    const { api, id } = await setup();
    await api("PATCH", `/api/categories/${id("Fuel")}`, { archived: true });
    expect((await api("PUT", `/api/budgets/${id("Fuel")}`, { limitPaise: 100 })).status).toBe(422);
  });

  it("never mixes users: not their spending, categories or budgets", async () => {
    const a = await setup();
    const b = await setup();
    await a.api("PUT", `/api/budgets/${a.id("Fuel")}`, { limitPaise: 2_000_00 });
    await a.spend(500_00, "2026-10-05", { categoryId: a.id("Fuel") });
    await b.spend(9_000_00, "2026-10-05", { categoryId: b.id("Fuel") });
    expect(((await b.api("GET", "/api/budgets")).json.items as Json[])).toHaveLength(0);
    expect(((await a.api("GET", "/api/budgets")).json.items as Json[])[0]!.spentPaise).toBe(500_00);
    // b cannot set or delete a budget on a's category, and cannot see it
    expect((await b.api("PUT", `/api/budgets/${a.id("Fuel")}`, { limitPaise: 100 })).status).toBe(404);
    expect((await b.api("DELETE", `/api/budgets/${a.id("Fuel")}`)).status).toBe(404);
    expect(((await a.api("GET", "/api/budgets")).json.items as Json[])[0]!.limitPaise).toBe(2_000_00);
  });

  it("requires a session", async () => {
    const anon = makeApp();
    expect((await anon.call("GET", "/api/budgets")).status).toBe(401);
    expect((await anon.call("PUT", "/api/budgets/x", { body: { limitPaise: 1 } })).status).toBe(401);
  });
});
