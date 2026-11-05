import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST).
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const trend = async (months?: number) => (await api("GET", `/api/dashboard/networth${months ? `?months=${months}` : ""}`)).json.points as Json[];
  const headline = async () => ((await api("GET", "/api/accounts")).json.overview as Json).netWorthPaise as number;
  const spend = (accountId: string, amountPaise: number, txnDate: string) =>
    api("POST", "/api/transactions", { type: "expense", amountPaise, txnDate, accountId, merchant: "Shop" });
  return { app, api, bank, card, trend, headline, spend };
}

describe("net worth trend", () => {
  it("has a single point today for a brand new ledger, equal to the headline", async () => {
    const s = await setup();
    const points = await s.trend();
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ month: "2026-10", asOf: "2026-10-27", netWorthPaise: 1_00_000_00, banksPaise: 1_00_000_00 });
    expect(points[0]!.netWorthPaise).toBe(await s.headline());
  });

  it("follows entries month by month and starts at the first entry", async () => {
    const s = await setup();
    await s.spend(s.bank.id, 10_000_00, "2026-08-10");
    await s.spend(s.card.id, 6_000_00, "2026-09-12");
    await s.api("POST", "/api/transactions", { type: "income", amountPaise: 50_000_00, txnDate: "2026-10-01", accountId: s.bank.id, merchant: "Pay" });
    const points = await s.trend();
    expect(points.map((p) => [p.month, p.banksPaise, p.cardsOwedPaise, p.netWorthPaise])).toEqual([
      ["2026-08", 90_000_00, 0, 90_000_00],
      ["2026-09", 90_000_00, 6_000_00, 84_000_00],
      ["2026-10", 1_40_000_00, 6_000_00, 1_34_000_00],
    ]);
    expect(points.at(-1)!.netWorthPaise).toBe(await s.headline());
  });

  it("limits the months asked for, and refuses silly values", async () => {
    const s = await setup();
    await s.spend(s.bank.id, 100_00, "2026-01-10");
    expect(await s.trend(3)).toHaveLength(3);
    expect(await s.trend(24)).toHaveLength(10);
    expect((await s.api("GET", "/api/dashboard/networth?months=0")).status).toBe(422);
    expect((await s.api("GET", "/api/dashboard/networth?months=25")).status).toBe(422);
  });

  it("counts loans only while they are outstanding", async () => {
    const s = await setup();
    await s.spend(s.bank.id, 100_00, "2026-08-01");
    await s.api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, date: "2026-09-10", accountId: s.bank.id });
    const person = (await s.api("GET", "/api/debts")).json.people[0];
    await s.api("POST", `/api/debts/${person.debts[0].id}/payments`, { amountPaise: 2_000_00, date: "2026-10-05", accountId: s.bank.id });
    const points = await s.trend();
    expect(points.map((p) => [p.month, p.owedToYouPaise])).toEqual([
      ["2026-08", 0],
      ["2026-09", 5_000_00],
      ["2026-10", 3_000_00],
    ]);
    // Lending through the bank moves money from the bank to what is owed: net worth stays put.
    expect(points[1]!.netWorthPaise).toBe(points[0]!.netWorthPaise);
    expect(points.at(-1)!.netWorthPaise).toBe(await s.headline());
  });

  it("counts EMIs still to be billed as owed from the plan's first instalment", async () => {
    const s = await setup();
    await s.spend(s.bank.id, 100_00, "2026-07-01");
    const made = await s.api("POST", "/api/emi-plans", { cardAccountId: s.card.id, title: "Phone", totalPaise: 60_000_00, months: 6, startMonth: "2026-09" });
    expect(made.status).toBe(201);
    const points = await s.trend();
    const byMonth = Object.fromEntries(points.map((p) => [p.month, p.emiToComePaise]));
    expect(byMonth["2026-07"]).toBe(0);
    expect(byMonth["2026-08"]).toBe(0);
    // Statement day 23: the first instalment lands on 23 Sep, so at the end of September five remain.
    expect(byMonth["2026-09"]).toBe(50_000_00);
    expect(points.at(-1)!.netWorthPaise).toBe(await s.headline());
  });

  it("keeps each person's figures to themselves, and needs a session", async () => {
    const a = await setup();
    const b = await setup();
    await a.spend(a.bank.id, 90_000_00, "2026-09-01");
    expect((await b.trend()).at(-1)!.banksPaise).toBe(1_00_000_00);
    expect((await a.app.call("GET", "/api/dashboard/networth", {})).status).toBe(401);
  });
});
