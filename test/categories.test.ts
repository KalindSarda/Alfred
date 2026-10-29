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
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "Bank", openingBalancePaise: 1_00_000_00 })).json;
  const list = async () => (await api("GET", "/api/categories")).json.items as Json[];
  const find = async (name: string, kind = "expense") => (await list()).find((c) => c.name === name && c.kind === kind)!;
  const spend = (categoryId: string, amount = 100_00, extra: object = {}) =>
    api("POST", "/api/transactions", { type: "expense", amountPaise: amount, txnDate: "2026-10-05", accountId: bank.id, categoryId, ...extra });
  return { api, list, find, spend };
}

describe("category list", () => {
  it("counts live entries per category and ignores deleted ones", async () => {
    const { api, find, spend } = await setup();
    const food = await find("Food & Dining");
    await spend(food.id);
    await spend(food.id);
    const gone = (await spend(food.id)).json;
    await api("DELETE", `/api/transactions/${gone.id}`);
    expect((await find("Food & Dining")).entryCount).toBe(2);
    expect((await find("Fuel")).entryCount).toBe(0);
  });
});

describe("DELETE /api/categories/:id", () => {
  it("removes an unused category together with its budget", async () => {
    const { api, find, list } = await setup();
    const pets = (await api("POST", "/api/categories", { name: "Pets", kind: "expense" })).json;
    await api("PUT", `/api/budgets/${pets.id}`, { limitPaise: 1_000_00 });
    expect((await api("DELETE", `/api/categories/${pets.id}`)).status).toBe(204);
    expect((await list()).some((c) => c.id === pets.id)).toBe(false);
    expect((await api("GET", "/api/budgets")).json.items).toHaveLength(0);
    expect((await find("Fuel")).id).toBeTruthy();
  });

  it("refuses when entries use it, and says how many", async () => {
    const { api, find, spend } = await setup();
    const food = await find("Food & Dining");
    await spend(food.id);
    await spend(food.id);
    const res = await api("DELETE", `/api/categories/${food.id}`);
    expect(res.status).toBe(409);
    expect(res.json.error.message).toContain("2 entries use this category");
  });

  it("is allowed when only deleted entries remain, and detaches them", async () => {
    const { api, find, spend } = await setup();
    const fuel = await find("Fuel");
    const txn = (await spend(fuel.id)).json;
    await api("DELETE", `/api/transactions/${txn.id}`);
    expect((await api("DELETE", `/api/categories/${fuel.id}`)).status).toBe(204);
  });

  it("never deletes the system category", async () => {
    const { api, find } = await setup();
    const cashback = await find("Cashback", "income");
    expect((await api("DELETE", `/api/categories/${cashback.id}`)).status).toBe(409);
  });

  it("is 404 for an unknown or another user's category", async () => {
    const a = await setup();
    const b = await setup();
    const aFuel = await a.find("Fuel");
    expect((await b.api("DELETE", `/api/categories/${aFuel.id}`)).status).toBe(404);
    expect((await a.api("DELETE", "/api/categories/nope")).status).toBe(404);
    expect((await a.find("Fuel")).id).toBe(aFuel.id);
  });
});

describe("POST /api/categories/:id/merge", () => {
  it("moves the entries, removes the source, and reports how many moved", async () => {
    const { api, find, list, spend } = await setup();
    const from = await find("Groceries");
    const into = await find("Food & Dining");
    await spend(from.id, 300_00);
    await spend(from.id, 200_00);
    await spend(into.id, 100_00);
    const res = await api("POST", `/api/categories/${from.id}/merge`, { intoId: into.id });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ movedEntries: 2 });
    const after = await list();
    expect(after.some((c) => c.id === from.id)).toBe(false);
    expect(after.find((c) => c.id === into.id)!.entryCount).toBe(3);
    const cashflow = (await api("GET", "/api/dashboard/cashflow?period=cycle")).json;
    expect(cashflow.expenses.find((r: Json) => r.categoryId === into.id).amountPaise).toBe(600_00);
  });

  it("keeps the target's budget, dropping the source's", async () => {
    const { api, find } = await setup();
    const from = await find("Groceries");
    const into = await find("Food & Dining");
    await api("PUT", `/api/budgets/${from.id}`, { limitPaise: 9_000_00 });
    await api("PUT", `/api/budgets/${into.id}`, { limitPaise: 5_000_00 });
    await api("POST", `/api/categories/${from.id}/merge`, { intoId: into.id });
    const items = (await api("GET", "/api/budgets")).json.items as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ categoryId: into.id, limitPaise: 5_000_00 });
  });

  it("moves the source's budget across when the target has none", async () => {
    const { api, find } = await setup();
    const from = await find("Groceries");
    const into = await find("Food & Dining");
    await api("PUT", `/api/budgets/${from.id}`, { limitPaise: 9_000_00 });
    await api("POST", `/api/categories/${from.id}/merge`, { intoId: into.id });
    const items = (await api("GET", "/api/budgets")).json.items as Json[];
    expect(items.map((i) => [i.categoryId, i.limitPaise])).toEqual([[into.id, 9_000_00]]);
  });

  it("works for income categories too", async () => {
    const { api, find, list } = await setup();
    const from = await find("Salary", "income");
    const into = await find("Interest", "income");
    expect((await api("POST", `/api/categories/${from.id}/merge`, { intoId: into.id })).status).toBe(200);
    expect((await list()).some((c) => c.id === from.id)).toBe(false);
  });

  it("refuses a different kind, the same category, an archived target and the system category", async () => {
    const { api, find } = await setup();
    const food = await find("Food & Dining");
    const salary = await find("Salary", "income");
    const fuel = await find("Fuel");
    const cashback = await find("Cashback", "income");
    expect((await api("POST", `/api/categories/${food.id}/merge`, { intoId: salary.id })).status).toBe(422);
    expect((await api("POST", `/api/categories/${food.id}/merge`, { intoId: food.id })).status).toBe(422);
    await api("PATCH", `/api/categories/${fuel.id}`, { archived: true });
    expect((await api("POST", `/api/categories/${food.id}/merge`, { intoId: fuel.id })).status).toBe(422);
    expect((await api("POST", `/api/categories/${cashback.id}/merge`, { intoId: salary.id })).status).toBe(409);
  });

  it("can merge an archived category into an active one", async () => {
    const { api, find, spend } = await setup();
    const from = await find("Fuel");
    const into = await find("Transport");
    await spend(from.id);
    await api("PATCH", `/api/categories/${from.id}`, { archived: true });
    expect((await api("POST", `/api/categories/${from.id}/merge`, { intoId: into.id })).json.movedEntries).toBe(1);
  });

  it("never touches another user's data", async () => {
    const a = await setup();
    const b = await setup();
    const aFuel = await a.find("Fuel");
    const bFood = await b.find("Food & Dining");
    expect((await b.api("POST", `/api/categories/${aFuel.id}/merge`, { intoId: bFood.id })).status).toBe(404);
    expect((await b.api("POST", `/api/categories/${bFood.id}/merge`, { intoId: aFuel.id })).status).toBe(404);
    expect((await a.find("Fuel")).id).toBe(aFuel.id);
  });

  it("validates the body", async () => {
    const { api, find } = await setup();
    const food = await find("Food & Dining");
    expect((await api("POST", `/api/categories/${food.id}/merge`, {})).status).toBe(422);
    expect((await api("POST", `/api/categories/${food.id}/merge`, { intoId: "x", extra: 1 })).status).toBe(422);
  });
});
