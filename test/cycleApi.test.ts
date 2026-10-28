import { describe, expect, it } from "vitest";
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
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "Bank", openingBalancePaise: 0 })).json;
  const add = (body: object) => api("POST", "/api/transactions", { accountId: bank.id, ...body });
  return { api, add };
}

describe("periodStartDay setting", () => {
  it("defaults to 1, accepts 1 to 31, and rejects anything else", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/settings")).json.periodStartDay).toBe(1);
    expect((await api("PATCH", "/api/settings", { periodStartDay: 30 })).json.periodStartDay).toBe(30);
    expect((await api("GET", "/api/settings")).json.periodStartDay).toBe(30);
    for (const bad of [0, 32, 1.5, "30", null]) {
      expect((await api("PATCH", "/api/settings", { periodStartDay: bad })).status).toBe(422);
    }
    expect((await api("GET", "/api/settings")).json.periodStartDay).toBe(30);
  });
});

describe("period=cycle", () => {
  it("is the calendar month by default", async () => {
    const { api } = await setup();
    const res = (await api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(res.period).toEqual({ key: "cycle", from: "2026-10-01", to: "2026-10-31" });
  });

  it("follows the payday setting", async () => {
    const { api } = await setup(30);
    const res = (await api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(res.period).toEqual({ key: "cycle", from: "2026-09-30", to: "2026-10-29" });
  });

  it("totals only cover the cycle, so a payday on the 30th groups entries differently", async () => {
    const calendar = await setup(1);
    const payday = await setup(30);
    for (const s of [calendar, payday]) {
      await s.add({ type: "income", amountPaise: 90_000_00, txnDate: "2026-09-30" });
      await s.add({ type: "expense", amountPaise: 10_000_00, txnDate: "2026-10-05" });
      await s.add({ type: "expense", amountPaise: 4_000_00, txnDate: "2026-09-29" });
    }
    // calendar October: only the 5 Oct expense. Payday cycle 30 Sep - 29 Oct: the salary and the 5 Oct expense.
    const cal = (await calendar.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect([cal.incomePaise, cal.expensePaise]).toEqual([0, 10_000_00]);
    const pay = (await payday.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect([pay.incomePaise, pay.expensePaise]).toEqual([90_000_00, 10_000_00]);
  });

  it("compares with the same stretch of the previous cycle", async () => {
    const { api, add } = await setup(1);
    // today is 27 Oct, so 27 days elapsed: compare with 1-27 Sep
    await add({ type: "expense", amountPaise: 6_000_00, txnDate: "2026-09-15" });
    await add({ type: "expense", amountPaise: 9_000_00, txnDate: "2026-09-29" }); // after the same point, not compared
    await add({ type: "expense", amountPaise: 1_000_00, txnDate: "2026-10-03" });
    const res = (await api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(res.expensePaise).toBe(1_000_00);
    expect(res.previousExpensePaise).toBe(6_000_00);
  });

  it("cash flow uses the same cycle", async () => {
    const { api, add } = await setup(30);
    await add({ type: "income", amountPaise: 50_000_00, txnDate: "2026-09-30" });
    await add({ type: "expense", amountPaise: 2_000_00, txnDate: "2026-09-29" });
    const res = (await api("GET", "/api/dashboard/cashflow?period=cycle")).json;
    expect(res.period).toEqual({ key: "cycle", from: "2026-09-30", to: "2026-10-29" });
    expect(res).toMatchObject({ incomePaise: 50_000_00, expensePaise: 0 });
  });

  it("the briefing talks about the user's month", async () => {
    const { api, add } = await setup(30);
    await add({ type: "expense", amountPaise: 1_000_00, txnDate: "2026-10-05" });
    const lines = (await api("GET", "/api/alfred/briefing")).json.lines as { key: string; text: string }[];
    expect(lines.find((l) => l.key === "spend")?.text).toContain("since the 30th");
  });
});
