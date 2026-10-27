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
  return { api };
}

describe("balance overview on GET /api/accounts", () => {
  async function seeded() {
    const { api } = await setup();
    const main = (await api("POST", "/api/accounts", { kind: "bank", name: "Main", openingBalancePaise: 10_000_00 })).json;
    const reserve = (await api("POST", "/api/accounts", { kind: "bank", name: "Reserve", openingBalancePaise: 50_000_00, countsTowardSafeToSpend: false })).json;
    const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 3_000_00, txnDate: "2026-10-20", accountId: card.id });
    return { api, main, reserve, card };
  }

  it("splits what you hold into counted and set-aside, and nets off the cards", async () => {
    const { api } = await seeded();
    const { overview } = (await api("GET", "/api/accounts")).json;
    expect(overview).toEqual({
      totalInBanksPaise: 60_000_00,
      countedPaise: 10_000_00,
      setAsidePaise: 50_000_00,
      cardsOwedPaise: 3_000_00,
      netWorthPaise: 57_000_00,
      safeToSpendPaise: 7_000_00,
    });
  });

  it("agrees with the safe-to-spend figure on the dashboard", async () => {
    const { api } = await seeded();
    const overview = (await api("GET", "/api/accounts")).json.overview;
    const summary = (await api("GET", "/api/dashboard/summary")).json;
    expect(overview.safeToSpendPaise).toBe(summary.safeToSpendPaise);
  });

  it("a bill payment lowers banks and cards equally, so net worth is unchanged", async () => {
    const { api, main, card } = await seeded();
    const before = (await api("GET", "/api/accounts")).json.overview;
    await api("POST", "/api/transactions", { type: "bill_payment", amountPaise: 3_000_00, txnDate: "2026-10-25", accountId: main.id, toAccountId: card.id });
    const after = (await api("GET", "/api/accounts")).json.overview;
    expect(after.netWorthPaise).toBe(before.netWorthPaise);
    expect(after.safeToSpendPaise).toBe(before.safeToSpendPaise);
    expect(after.cardsOwedPaise).toBe(0);
    expect(after.totalInBanksPaise).toBe(before.totalInBanksPaise - 3_000_00);
  });

  it("income raises net worth; an expense on a bank lowers it", async () => {
    const { api, main } = await seeded();
    const base = (await api("GET", "/api/accounts")).json.overview.netWorthPaise;
    await api("POST", "/api/transactions", { type: "income", amountPaise: 1_000_00, txnDate: "2026-10-21", accountId: main.id });
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 400_00, txnDate: "2026-10-21", accountId: main.id });
    expect((await api("GET", "/api/accounts")).json.overview.netWorthPaise).toBe(base + 600_00);
  });

  it("archived accounts are left out, whether or not they are listed", async () => {
    const { api, reserve } = await seeded();
    await api("POST", `/api/accounts/${reserve.id}/archive`);
    const hidden = (await api("GET", "/api/accounts")).json.overview;
    const shown = (await api("GET", "/api/accounts?includeArchived=true")).json.overview;
    expect(hidden.totalInBanksPaise).toBe(10_000_00);
    expect(shown).toEqual(hidden);
  });

  it("is all zeros for a new user", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/accounts")).json.overview).toEqual({
      totalInBanksPaise: 0,
      countedPaise: 0,
      setAsidePaise: 0,
      cardsOwedPaise: 0,
      netWorthPaise: 0,
      safeToSpendPaise: 0,
    });
  });

  it("never mixes in another user's money", async () => {
    const { api } = await seeded();
    const other = await setup();
    await other.api("POST", "/api/accounts", { kind: "bank", name: "Theirs", openingBalancePaise: 9_999_00 });
    expect((await api("GET", "/api/accounts")).json.overview.totalInBanksPaise).toBe(60_000_00);
  });
});
