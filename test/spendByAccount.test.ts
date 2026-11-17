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
  return { api, app };
}

async function seeded() {
  const { api, app } = await session();
  const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
  const icici = (await api("POST", "/api/accounts", { kind: "bank", name: "ICICI", openingBalancePaise: 50_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Amazon card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = (await api("GET", "/api/categories")).json.items as Json[];
  const food = cats.find((c) => c.name === "Groceries")!.id as string;
  const add = (body: object) => api("POST", "/api/transactions", { categoryId: food, ...body });
  // test clock is 27 Oct 2026: this month so far is 1 to 27 Oct, last month's same days are 1 to 27 Sep
  await add({ type: "expense", amountPaise: 6_000_00, txnDate: "2026-10-05", accountId: hdfc.id });
  await add({ type: "expense", amountPaise: 2_000_00, txnDate: "2026-10-20", accountId: icici.id });
  await add({ type: "expense", amountPaise: 2_000_00, txnDate: "2026-10-21", accountId: card.id });
  await add({ type: "expense", amountPaise: 4_000_00, txnDate: "2026-09-10", accountId: hdfc.id });
  await add({ type: "expense", amountPaise: 1_000_00, txnDate: "2026-09-12", accountId: card.id });
  // outside the same stretch of last month (28 to 30 Sep), so not compared
  await add({ type: "expense", amountPaise: 9_000_00, txnDate: "2026-09-29", accountId: hdfc.id });
  return { api, app, hdfc, icici, card };
}

describe("GET /api/dashboard/spend-by-account", () => {
  it("lists what each account spent this month, biggest first, with shares", async () => {
    const { api, hdfc, icici, card } = await seeded();
    const res = await api("GET", "/api/dashboard/spend-by-account");
    expect(res.status).toBe(200);
    expect(res.json.period).toEqual({ from: "2026-10-01", to: "2026-10-27" });
    expect(res.json.previousPeriod).toEqual({ from: "2026-09-01", to: "2026-09-27" });
    expect(res.json.totalPaise).toBe(10_000_00);
    expect(res.json.accounts.map((a: Json) => [a.id, a.spentPaise, a.sharePct])).toEqual([
      [hdfc.id, 6_000_00, 60],
      // equal this month, so the one that spent more last month comes first
      [card.id, 2_000_00, 20],
      [icici.id, 2_000_00, 20],
    ]);
    expect(res.json.accounts[0].kind).toBe("bank");
    expect(res.json.accounts[1].kind).toBe("card");
  });

  it("compares with the same days of last month", async () => {
    const { api, hdfc, card, icici } = await seeded();
    const res = await api("GET", "/api/dashboard/spend-by-account");
    const by = (id: string) => res.json.accounts.find((a: Json) => a.id === id);
    expect(by(hdfc.id).previousPaise).toBe(4_000_00);
    expect(by(card.id).previousPaise).toBe(1_000_00);
    expect(by(icici.id).previousPaise).toBe(0);
    expect(res.json.previousTotalPaise).toBe(5_000_00);
  });

  it("counts only confirmed expenses: not transfers, bill payments, income or deleted entries", async () => {
    const { api, hdfc, icici, card } = await seeded();
    await api("POST", "/api/transactions", { type: "transfer", amountPaise: 7_000_00, txnDate: "2026-10-10", accountId: hdfc.id, toAccountId: icici.id });
    await api("POST", "/api/transactions", { type: "bill_payment", amountPaise: 2_000_00, txnDate: "2026-10-25", accountId: hdfc.id, toAccountId: card.id });
    const cats = (await api("GET", "/api/categories")).json.items as Json[];
    await api("POST", "/api/transactions", { type: "income", amountPaise: 80_000_00, txnDate: "2026-10-01", accountId: hdfc.id, categoryId: cats.find((c) => c.name === "Salary")!.id });
    const doomed = (await api("POST", "/api/transactions", { type: "expense", amountPaise: 3_000_00, txnDate: "2026-10-12", accountId: icici.id, categoryId: cats.find((c) => c.name === "Groceries")!.id })).json;
    await api("DELETE", `/api/transactions/${doomed.id}`);
    const res = await api("GET", "/api/dashboard/spend-by-account");
    expect(res.json.totalPaise).toBe(10_000_00);
    expect(res.json.accounts.map((a: Json) => a.spentPaise)).toEqual([6_000_00, 2_000_00, 2_000_00]);
  });

  it("leaves out accounts with no spending in either stretch, and is empty when nothing was spent", async () => {
    const { api } = await session();
    await api("POST", "/api/accounts", { kind: "bank", name: "Idle", openingBalancePaise: 1_000_00 });
    const res = await api("GET", "/api/dashboard/spend-by-account");
    expect(res.json.totalPaise).toBe(0);
    expect(res.json.accounts).toEqual([]);
  });

  it("does not include another person's spending, and needs a sign-in", async () => {
    await seeded();
    const { api: other } = await session();
    expect((await other("GET", "/api/dashboard/spend-by-account")).json.accounts).toEqual([]);
    const anon = await makeApp().call("GET", "/api/dashboard/spend-by-account", {});
    expect(anon.status).toBe(401);
  });

  it("covers other periods against the matching earlier stretch", async () => {
    const { api } = await seeded();
    const rolling = await api("GET", "/api/dashboard/spend-by-account?period=30d");
    expect(rolling.json.period).toEqual({ from: "2026-09-28", to: "2026-10-27" });
    expect(rolling.json.previousPeriod).toEqual({ from: "2026-08-29", to: "2026-09-27" });
    // this month's 10,000 plus the 9,000 on 29 Sep; the earlier window holds the 4,000 and 1,000
    expect(rolling.json.totalPaise).toBe(19_000_00);
    expect(rolling.json.previousTotalPaise).toBe(5_000_00);

    const year = await api("GET", "/api/dashboard/spend-by-account?period=ytd");
    expect(year.json.period).toEqual({ from: "2026-01-01", to: "2026-10-27" });
    expect(year.json.totalPaise).toBe(24_000_00);
    expect(year.json.previousTotalPaise).toBe(0);
  });

  it("refuses a period it does not know", async () => {
    const { api } = await seeded();
    expect((await api("GET", "/api/dashboard/spend-by-account?period=forever")).status).toBe(422);
  });
});
