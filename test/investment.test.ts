import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    let json: Json = null as never;
    try {
      json = (text ? JSON.parse(text) : null) as Json;
    } catch {
      // not JSON (the spreadsheet export)
    }
    return { status: res.status, json, text };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = ((await api("GET", "/api/categories")).json.items as Json[]);
  const food = cats.find((c) => c.name === "Food & Dining")!.id as string;
  const invest = (extra: object = {}) =>
    api("POST", "/api/transactions", { type: "investment", amountPaise: 10_000_00, txnDate: "2026-10-05", accountId: bank.id, merchant: "Some IPO", ...extra });
  return { api, bank, card, food, invest };
}

describe("the investment transaction type", () => {
  it("lowers the bank balance and is listed with its type", async () => {
    const s = await setup();
    const res = await s.invest();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ type: "investment", categoryId: null, toAccountId: null });
    const acct = ((await s.api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === s.bank.id)!;
    expect(acct.balancePaise).toBe(90_000_00);
    const listed = (await s.api("GET", "/api/transactions?type=investment")).json.items as Json[];
    expect(listed.map((t) => t.id)).toEqual([res.json.id]);
  });

  it("is never income or expense: not in cash flow, totals, budgets or the review count", async () => {
    const s = await setup();
    await s.invest();
    await s.api("PUT", `/api/budgets/${s.food}`, { limitPaise: 5_000_00 });
    const summary = (await s.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(summary).toMatchObject({ expensePaise: 0, incomePaise: 0, uncategorizedCount: 0 });
    expect((await s.api("GET", "/api/dashboard/cashflow?period=cycle")).json).toMatchObject({ expensePaise: 0, incomePaise: 0 });
    expect((await s.api("GET", "/api/budgets")).json.items[0].spentPaise).toBe(0);
    expect((await s.api("GET", "/api/dashboard/review")).json.uncategorizedCount).toBe(0);
    expect((await s.api("GET", "/api/transactions")).json.totals).toMatchObject({ expensePaise: 0, incomePaise: 0 });
  });

  it("is paid from a bank, with no category and no destination", async () => {
    const s = await setup();
    expect((await s.invest({ accountId: s.card.id })).status).toBe(422);
    expect((await s.invest({ categoryId: s.food })).status).toBe(422);
    expect((await s.invest({ toAccountId: s.card.id })).status).toBe(422);
  });

  it("changing an expense into an investment clears its category", async () => {
    const s = await setup();
    const e = (await s.api("POST", "/api/transactions", { type: "expense", amountPaise: 500_00, txnDate: "2026-10-05", accountId: s.bank.id, categoryId: s.food })).json;
    const res = await s.api("PATCH", `/api/transactions/${e.id}`, { type: "investment" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ type: "investment", categoryId: null });
  });

  it("appears in the spreadsheet export", async () => {
    const s = await setup();
    await s.invest();
    const csv = (await s.api("GET", "/api/export/csv")).text;
    expect(csv).toContain("2026-10-05,investment,10000,HDFC,,,Some IPO,,confirmed");
  });
});
