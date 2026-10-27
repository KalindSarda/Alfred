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
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "Bank", openingBalancePaise: 0 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = (await api("GET", "/api/categories")).json.items as Json[];
  const id = (name: string) => cats.find((c) => c.name === name)!.id as string;
  const add = (body: object) => api("POST", "/api/transactions", body);
  return { api, bank, card, id, add };
}

describe("GET /api/dashboard/cashflow", () => {
  async function seeded() {
    const s = await setup();
    const { add, bank, card, id } = s;
    await add({ type: "income", amountPaise: 80_000_00, txnDate: "2026-10-01", accountId: bank.id, categoryId: id("Salary"), merchant: "Employer" });
    await add({ type: "income", amountPaise: 20_000_00, txnDate: "2026-10-12", accountId: bank.id, categoryId: id("Interest"), merchant: "Bank" });
    await add({ type: "expense", amountPaise: 22_000_00, txnDate: "2026-10-03", accountId: bank.id, categoryId: id("Rent"), merchant: "Landlord" });
    await add({ type: "expense", amountPaise: 3_000_00, txnDate: "2026-10-05", accountId: card.id, categoryId: id("Food & Dining"), merchant: "Swiggy" });
    await add({ type: "expense", amountPaise: 2_000_00, txnDate: "2026-10-09", accountId: card.id, categoryId: id("Food & Dining"), merchant: "SWIGGY " });
    await add({ type: "expense", amountPaise: 5_000_00, txnDate: "2026-10-10", accountId: bank.id, merchant: "Mystery" });
    // never counted in cash flow:
    await add({ type: "bill_payment", amountPaise: 5_000_00, txnDate: "2026-10-20", accountId: bank.id, toAccountId: card.id });
    await add({ type: "expense", amountPaise: 700_00, txnDate: "2026-10-21", accountId: bank.id, status: "draft", categoryId: id("Fuel") });
    const doomed = (await add({ type: "expense", amountPaise: 900_00, txnDate: "2026-10-22", accountId: bank.id, categoryId: id("Fuel") })).json;
    await s.api("DELETE", `/api/transactions/${doomed.id}`);
    return s;
  }

  it("groups income and expenses by category with shares of income", async () => {
    const { api, id } = await seeded();
    const res = (await api("GET", "/api/dashboard/cashflow?period=this_month")).json;
    expect(res.incomePaise).toBe(100_000_00);
    expect(res.expensePaise).toBe(32_000_00);
    expect(res.surplusPaise).toBe(68_000_00);
    expect(res.income.map((r: Json) => [r.name, r.amountPaise, r.pctOfIncome])).toEqual([
      ["Salary", 80_000_00, 80],
      ["Interest", 20_000_00, 20],
    ]);
    expect(res.expenses.map((r: Json) => [r.name, r.amountPaise, r.pctOfIncome])).toEqual([
      ["Rent", 22_000_00, 22],
      ["Uncategorized", 5_000_00, 5],
      ["Food & Dining", 5_000_00, 5],
    ].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
    expect(res.expenses.find((r: Json) => r.name === "Food & Dining").categoryId).toBe(id("Food & Dining"));
    expect(res.expenses.find((r: Json) => r.name === "Uncategorized")).toMatchObject({ key: "none", categoryId: null });
  });

  it("excludes bill payments, transfers, drafts and deleted entries", async () => {
    const { api } = await seeded();
    const res = (await api("GET", "/api/dashboard/cashflow?period=this_month")).json;
    expect(res.expensePaise).toBe(32_000_00);
    expect(res.expenses.some((r: Json) => r.name === "Fuel")).toBe(false);
  });

  it("totals agree with the summary endpoint for the same period", async () => {
    const { api } = await seeded();
    const flow = (await api("GET", "/api/dashboard/cashflow?period=this_month")).json;
    const summary = (await api("GET", "/api/dashboard/summary?period=this_month")).json;
    expect(flow.incomePaise).toBe(summary.incomePaise);
    expect(flow.expensePaise).toBe(summary.expensePaise);
    expect(flow.surplusPaise).toBe(summary.netPaise);
  });

  it("the rows add up to the totals", async () => {
    const { api } = await seeded();
    const res = (await api("GET", "/api/dashboard/cashflow?period=this_month")).json;
    expect(res.income.reduce((s: number, r: Json) => s + r.amountPaise, 0)).toBe(res.incomePaise);
    expect(res.expenses.reduce((s: number, r: Json) => s + r.amountPaise, 0)).toBe(res.expensePaise);
  });

  it("can group by merchant, merging spelling and case differences", async () => {
    const { api } = await seeded();
    const res = (await api("GET", "/api/dashboard/cashflow?period=this_month&groupBy=merchant")).json;
    expect(res.groupBy).toBe("merchant");
    const swiggy = res.expenses.find((r: Json) => r.key === "swiggy");
    expect(swiggy.amountPaise).toBe(5_000_00);
    expect(res.expenses.map((r: Json) => r.name)).toContain("Landlord");
  });

  it("labels entries with no merchant", async () => {
    const { api, add, bank } = await setup();
    await add({ type: "expense", amountPaise: 100_00, txnDate: "2026-10-05", accountId: bank.id });
    const res = (await api("GET", "/api/dashboard/cashflow?period=this_month&groupBy=merchant")).json;
    expect(res.expenses[0]).toMatchObject({ name: "No merchant", amountPaise: 100_00 });
  });

  it("follows the period and reports its range", async () => {
    const { api } = await seeded();
    const last = (await api("GET", "/api/dashboard/cashflow?period=last_month")).json;
    expect(last.period).toEqual({ key: "last_month", from: "2026-09-01", to: "2026-09-30" });
    expect(last).toMatchObject({ incomePaise: 0, expensePaise: 0, income: [], expenses: [] });
  });

  it("shares are zero when there was no income, and a deficit shows as a negative surplus", async () => {
    const { api, add, bank } = await setup();
    await add({ type: "expense", amountPaise: 1_000_00, txnDate: "2026-10-05", accountId: bank.id });
    const res = (await api("GET", "/api/dashboard/cashflow?period=this_month")).json;
    expect(res.expenses[0].pctOfIncome).toBe(0);
    expect(res.surplusPaise).toBe(-1_000_00);
  });

  it("validates its parameters and requires a session", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/dashboard/cashflow?period=forever")).status).toBe(422);
    expect((await api("GET", "/api/dashboard/cashflow?groupBy=colour")).status).toBe(422);
    expect((await makeApp().call("GET", "/api/dashboard/cashflow")).status).toBe(401);
  });

  it("never includes another user's entries", async () => {
    const { api } = await seeded();
    const other = await setup();
    await other.add({ type: "income", amountPaise: 9_999_00, txnDate: "2026-10-05", accountId: other.bank.id });
    expect((await api("GET", "/api/dashboard/cashflow?period=this_month")).json.incomePaise).toBe(100_000_00);
  });
});
