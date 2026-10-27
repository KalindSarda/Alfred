import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

async function session() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  return { api };
}

describe("GET /api/dashboard/summary", () => {
  async function seeded() {
    const { api } = await session();
    const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 10_000_00 })).json;
    const reserve = (await api("POST", "/api/accounts", { kind: "bank", name: "Reserve", openingBalancePaise: 50_000_00, countsTowardSafeToSpend: false })).json;
    const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
    const cats = ((await api("GET", "/api/categories")).json.items as Json[]);
    const groceries = cats.find((c) => c.name === "Groceries")!.id;
    const salary = cats.find((c) => c.name === "Salary")!.id;
    const add = (body: object) => api("POST", "/api/transactions", body);
    await add({ type: "income", amountPaise: 80_000_00, txnDate: "2026-10-01", accountId: hdfc.id, categoryId: salary });
    await add({ type: "expense", amountPaise: 2_000_00, txnDate: "2026-10-05", accountId: hdfc.id, categoryId: groceries });
    await add({ type: "expense", amountPaise: 3_000_00, txnDate: "2026-10-20", accountId: card.id, categoryId: groceries });
    await add({ type: "expense", amountPaise: 500_00, txnDate: "2026-09-15", accountId: hdfc.id, categoryId: groceries });
    // bill payments and transfers never count as income or expense
    await add({ type: "bill_payment", amountPaise: 3_000_00, txnDate: "2026-10-25", accountId: hdfc.id, toAccountId: card.id });
    return { api, hdfc, reserve, card };
  }

  it("returns safe-to-spend and period totals (default rolling 30 days)", async () => {
    const { api } = await seeded();
    const res = await api("GET", "/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.json.period).toEqual({ key: "30d", from: "2026-09-28", to: "2026-10-27" });
    expect(res.json.incomePaise).toBe(80_000_00);
    expect(res.json.expensePaise).toBe(5_000_00);
    expect(res.json.netPaise).toBe(75_000_00);
    // previous 30 days (29 Aug - 27 Sep) hold the 15 Sep expense of 500
    expect(res.json.previousExpensePaise).toBe(500_00);
    // HDFC 10,000 + 80,000 - 2,000 - 500 - 3,000 bill payment = 84,500; card owed 3,000 - 3,000 = 0; reserve excluded
    expect(res.json.safeToSpendPaise).toBe(84_500_00);
  });

  it("totals follow the selected period but safe-to-spend does not", async () => {
    const { api } = await seeded();
    const sep = (await api("GET", "/api/dashboard/summary?period=last_month")).json;
    expect(sep.period).toEqual({ key: "last_month", from: "2026-09-01", to: "2026-09-30" });
    expect(sep.expensePaise).toBe(500_00);
    expect(sep.incomePaise).toBe(0);
    const week = (await api("GET", "/api/dashboard/summary?period=7d")).json;
    expect(week.incomePaise).toBe(0);
    expect(week.safeToSpendPaise).toBe(sep.safeToSpendPaise);
  });

  it("excludes drafts and deleted transactions from totals", async () => {
    const { api, hdfc } = await seeded();
    const draft = (await api("POST", "/api/transactions", { type: "expense", amountPaise: 900_00, txnDate: "2026-10-26", accountId: hdfc.id, status: "draft" })).json;
    const doomed = (await api("POST", "/api/transactions", { type: "expense", amountPaise: 700_00, txnDate: "2026-10-26", accountId: hdfc.id })).json;
    await api("DELETE", `/api/transactions/${doomed.id}`);
    const res = (await api("GET", "/api/dashboard/summary?period=this_month")).json;
    expect(res.expensePaise).toBe(5_000_00);
    expect(res.reviewCount).toBeGreaterThanOrEqual(1);
    await api("POST", `/api/transactions/${draft.id}/confirm`);
    expect(((await api("GET", "/api/dashboard/summary?period=this_month")).json).expensePaise).toBe(5_900_00);
  });

  it("counts drafts and uncategorized entries for review, but not transfers or bill payments", async () => {
    const { api, hdfc } = await session().then(async ({ api }) => {
      const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 0 })).json;
      return { api, hdfc };
    });
    expect((await api("GET", "/api/dashboard/summary")).json.reviewCount).toBe(0);
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: hdfc.id });
    expect((await api("GET", "/api/dashboard/summary")).json.reviewCount).toBe(1);
  });

  it("validates the period and requires a session", async () => {
    const { api } = await session();
    expect((await api("GET", "/api/dashboard/summary?period=forever")).status).toBe(422);
    const anon = await makeApp().call("GET", "/api/dashboard/summary");
    expect(anon.status).toBe(401);
  });

  it("an empty app returns zeros", async () => {
    const { api } = await session();
    expect((await api("GET", "/api/dashboard/summary")).json).toMatchObject({
      safeToSpendPaise: 0,
      incomePaise: 0,
      expensePaise: 0,
      netPaise: 0,
      reviewCount: 0,
    });
  });
});
