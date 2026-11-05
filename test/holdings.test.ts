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
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const make = (extra: object = {}) => api("POST", "/api/holdings", { name: "Tata Tech", kind: "stock", investedPaise: 10_000_00, valuePaise: 12_000_00, ...extra });
  const figures = async () => {
    const res = (await api("GET", "/api/accounts")).json;
    return { balance: (res.items as Json[]).find((a) => a.id === bank.id)!.balancePaise as number, overview: res.overview as Json };
  };
  const list = async (status = "active") => (await api("GET", `/api/holdings?status=${status}`)).json;
  return { app, user, api, bank, card, make, figures, list };
}

describe("creating holdings", () => {
  it("records what was put in and what it is worth", async () => {
    const s = await setup();
    const res = await s.make();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Tata Tech", kind: "stock", status: "active", investedPaise: 10_000_00, soldPaise: 0, valuePaise: 12_000_00, valueDate: "2026-10-27", gainPaise: 2_000_00, gainPct: 20, staleDays: 0 });
    expect((await s.list()).totalValuePaise).toBe(12_000_00);
  });

  it("can start empty, to buy into later", async () => {
    const s = await setup();
    const res = await s.make({ investedPaise: undefined, valuePaise: undefined });
    expect(res.json).toMatchObject({ investedPaise: 0, valuePaise: 0, valueDate: null, staleDays: null, gainPct: null });
  });

  it("refuses a duplicate active name, a future date, and extra fields", async () => {
    const s = await setup();
    await s.make();
    expect((await s.make({ name: " tata  tech " })).status).toBe(422);
    expect((await s.make({ name: "Gold", valueDate: "2026-10-28" })).status).toBe(422);
    expect((await s.make({ name: "Gold", colour: "red" })).status).toBe(422);
    expect((await s.make({ name: "Gold", kind: "bonds" })).status).toBe(422);
  });

  it("changes the name and kind", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { name: "Tata Technologies", kind: "other" })).json).toMatchObject({ name: "Tata Technologies", kind: "other" });
  });
});

describe("values", () => {
  it("a new value replaces the last, and a second one the same day replaces the first", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    expect((await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 15_000_00 })).json).toMatchObject({ valuePaise: 15_000_00, gainPaise: 5_000_00 });
    const again = (await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 14_000_00 })).json;
    expect(again.valuePaise).toBe(14_000_00);
    expect(again.values).toHaveLength(1);
  });

  it("keeps history, and refuses a future date or a closed holding", async () => {
    const s = await setup();
    const h = (await s.make({ valueDate: "2026-09-01" })).json;
    const res = (await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 13_000_00 })).json;
    expect(res.values.map((v: Json) => v.valuePaise)).toEqual([13_000_00, 12_000_00]);
    expect((await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 1, date: "2026-10-28" })).status).toBe(422);
    await s.api("POST", `/api/holdings/${h.id}/close`);
    expect((await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 5 })).status).toBe(409);
  });
});

describe("buying and selling", () => {
  it("buying lowers the bank, raises what was put in and the value, and is not spending", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    const before = await s.figures();
    const res = await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 5_000_00, accountId: s.bank.id, date: "2026-10-27" });
    expect(res.status).toBe(201);
    // The value was typed today and the purchase is dated today, so the purchase moves it.
    expect(res.json).toMatchObject({ investedPaise: 15_000_00, valuePaise: 17_000_00, gainPaise: 2_000_00 });
    const later = await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 1_000_00, accountId: s.bank.id, date: "2026-10-27" });
    expect(later.json.entries).toHaveLength(2);
    expect(later.json.valuePaise).toBe(18_000_00);
    expect((await s.figures()).balance).toBe(before.balance - 6_000_00);
    const summary = (await s.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(summary).toMatchObject({ expensePaise: 0, incomePaise: 0 });
    const entry = ((await s.api("GET", "/api/transactions?type=investment&limit=10")).json.items as Json[])[0]!;
    expect(entry).toMatchObject({ type: "investment", holdingId: h.id, merchant: "Tata Tech", categoryId: null });
  });

  it("a purchase after the latest value adds to the value until it is typed again", async () => {
    const s = await setup();
    const h = (await s.make({ valueDate: "2026-10-01" })).json;
    const res = await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 3_000_00, accountId: s.bank.id, date: "2026-10-10" });
    expect(res.json).toMatchObject({ investedPaise: 13_000_00, valuePaise: 15_000_00, gainPaise: 2_000_00 });
  });

  it("selling raises the bank, never counts as income, and lowers the value", async () => {
    const s = await setup();
    const h = (await s.make({ valueDate: "2026-10-01" })).json;
    const before = await s.figures();
    const res = await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 4_000_00, accountId: s.bank.id, date: "2026-10-20" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ soldPaise: 4_000_00, valuePaise: 8_000_00, gainPaise: 2_000_00 });
    expect((await s.figures()).balance).toBe(before.balance + 4_000_00);
    expect((await s.api("GET", "/api/dashboard/summary?period=cycle")).json).toMatchObject({ incomePaise: 0, expensePaise: 0 });
    const entry = ((await s.api("GET", "/api/transactions?type=investment_sale&limit=10")).json.items as Json[])[0]!;
    expect(entry).toMatchObject({ type: "investment_sale", holdingId: h.id, categoryId: null });
  });

  it("a sale dated the same day as the latest value moves that value", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    const res = (await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 5_000_00, accountId: s.bank.id })).json;
    expect(res).toMatchObject({ valuePaise: 7_000_00, soldPaise: 5_000_00, gainPaise: 2_000_00 });
  });

  it("selling everything can close the holding, and the total return holds", async () => {
    const s = await setup();
    const h = (await s.make({ valueDate: "2026-10-01" })).json;
    const res = (await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 12_500_00, accountId: s.bank.id, closeOut: true })).json;
    expect(res).toMatchObject({ status: "closed", valuePaise: 0, soldPaise: 12_500_00, gainPaise: 2_500_00, gainPct: 25 });
    expect((await s.list()).holdings).toEqual([]);
    expect((await s.list("all")).holdings).toHaveLength(1);
    expect((await s.figures()).overview.investmentsPaise).toBe(0);
  });

  it("only goes through a bank account, and not with a nothing-left holding", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    expect((await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 100_00, accountId: s.card.id })).status).toBe(422);
    expect((await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 100_00, accountId: s.card.id })).status).toBe(422);
    expect((await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 100_00, accountId: "nope" })).status).toBe(404);
    expect((await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 100_00, accountId: s.bank.id, date: "2026-10-28" })).status).toBe(422);
    const empty = (await s.make({ name: "Empty", investedPaise: undefined, valuePaise: undefined })).json;
    expect((await s.api("POST", `/api/holdings/${empty.id}/sell`, { amountPaise: 100_00, accountId: s.bank.id })).status).toBe(422);
  });
});

describe("closing and deleting", () => {
  it("closing zeroes the value; reopening needs a free name", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    expect((await s.api("POST", `/api/holdings/${h.id}/close`)).json).toMatchObject({ status: "closed", valuePaise: 0 });
    await s.make();
    expect((await s.api("POST", `/api/holdings/${h.id}/reopen`)).status).toBe(422);
    expect((await s.api("POST", `/api/holdings/${h.id}/close`)).status).toBe(409);
  });

  it("deletes only a holding with no entries", async () => {
    const s = await setup();
    const empty = (await s.make({ name: "Empty" })).json;
    const used = (await s.make({ name: "Used" })).json;
    await s.api("POST", `/api/holdings/${used.id}/buy`, { amountPaise: 100_00, accountId: s.bank.id });
    expect((await s.api("DELETE", `/api/holdings/${used.id}`)).status).toBe(409);
    expect((await s.api("DELETE", `/api/holdings/${empty.id}`)).status).toBe(204);
    expect((await s.api("DELETE", `/api/holdings/${empty.id}`)).status).toBe(404);
  });
});

describe("entries and holdings", () => {
  it("a sale cannot be made or edited as an ordinary entry, but can be deleted", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    expect((await s.api("POST", "/api/transactions", { type: "investment_sale", amountPaise: 100_00, txnDate: "2026-10-20", accountId: s.bank.id })).status).toBe(422);
    await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 1_000_00, accountId: s.bank.id });
    const sale = ((await s.api("GET", "/api/transactions?type=investment_sale&limit=10")).json.items as Json[])[0]!;
    expect((await s.api("PATCH", `/api/transactions/${sale.id}`, { amountPaise: 5 })).status).toBe(409);
    expect((await s.api("DELETE", `/api/transactions/${sale.id}`)).status).toBe(204);
    expect((await s.api("GET", `/api/holdings`)).json.holdings[0].soldPaise).toBe(0);
  });

  it("an Investment entry can be linked to a holding when added or edited, and no other kind can", async () => {
    const s = await setup();
    const h = (await s.make()).json;
    const created = await s.api("POST", "/api/transactions", { type: "investment", amountPaise: 2_000_00, txnDate: "2026-10-26", accountId: s.bank.id, merchant: "SIP", holdingId: h.id });
    expect(created.status).toBe(201);
    expect(created.json.holdingId).toBe(h.id);
    const plain = (await s.api("POST", "/api/transactions", { type: "investment", amountPaise: 3_000_00, txnDate: "2026-10-26", accountId: s.bank.id, merchant: "Other" })).json;
    expect(plain.holdingId).toBeNull();
    expect((await s.api("PATCH", `/api/transactions/${plain.id}`, { holdingId: h.id })).json.holdingId).toBe(h.id);
    expect((await s.api("GET", "/api/holdings")).json.holdings[0].investedPaise).toBe(10_000_00 + 2_000_00 + 3_000_00);
    expect((await s.api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-10-26", accountId: s.bank.id, holdingId: h.id })).status).toBe(422);
    expect((await s.api("POST", "/api/transactions", { type: "investment", amountPaise: 100_00, txnDate: "2026-10-26", accountId: s.bank.id, holdingId: "nope" })).status).toBe(404);
    // Becoming an expense lets go of the holding.
    const changed = (await s.api("PATCH", `/api/transactions/${plain.id}`, { type: "expense" })).json;
    expect(changed.holdingId).toBeNull();
  });

  it("refuses a closed holding, and another person's", async () => {
    const s = await setup();
    const other = await setup();
    const h = (await s.make()).json;
    const theirs = (await other.make()).json;
    expect((await s.api("POST", "/api/transactions", { type: "investment", amountPaise: 100_00, txnDate: "2026-10-26", accountId: s.bank.id, holdingId: theirs.id })).status).toBe(404);
    await s.api("POST", `/api/holdings/${h.id}/close`);
    expect((await s.api("POST", "/api/transactions", { type: "investment", amountPaise: 100_00, txnDate: "2026-10-26", accountId: s.bank.id, holdingId: h.id })).status).toBe(422);
  });
});

describe("net worth", () => {
  it("counts what the holdings are worth, and leaves safe-to-spend alone", async () => {
    const s = await setup();
    const before = await s.figures();
    await s.make();
    const after = await s.figures();
    expect(after.overview.investmentsPaise).toBe(12_000_00);
    expect(after.overview.netWorthPaise).toBe(before.overview.netWorthPaise + 12_000_00);
    expect(after.overview.safeToSpendPaise).toBe(before.overview.safeToSpendPaise);
  });

  it("buying through a bank moves money from the bank to the holding, so net worth holds", async () => {
    const s = await setup();
    const h = (await s.make({ investedPaise: undefined, valuePaise: undefined })).json;
    const before = await s.figures();
    await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 5_000_00, accountId: s.bank.id });
    const after = await s.figures();
    expect(after.balance).toBe(before.balance - 5_000_00);
    expect(after.overview.netWorthPaise).toBe(before.overview.netWorthPaise);
  });
});

describe("IPO allotment and SIPs", () => {
  it("an allotted IPO appears as a holding worth what was paid", async () => {
    const s = await setup();
    const hold = (await s.api("POST", "/api/holds", { accountId: s.bank.id, title: "Zeta IPO", amountPaise: 15_000_00 })).json;
    const res = await s.api("POST", `/api/holds/${hold.id}/allot`, { amountPaise: 15_000_00 });
    expect(res.status).toBe(200);
    const holding = (await s.list()).holdings.find((h: Json) => h.name === "Zeta IPO")!;
    expect(holding).toMatchObject({ kind: "stock", investedPaise: 15_000_00, valuePaise: 15_000_00 });
    expect(res.json.transaction.holdingId).toBe(holding.id);
  });

  it("a second allotment of the same name adds to the holding", async () => {
    const s = await setup();
    await s.make({ name: "Zeta IPO", investedPaise: undefined, valuePaise: undefined });
    const hold = (await s.api("POST", "/api/holds", { accountId: s.bank.id, title: "zeta ipo", amountPaise: 15_000_00 })).json;
    await s.api("POST", `/api/holds/${hold.id}/allot`, {});
    const all = (await s.list()).holdings;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ investedPaise: 15_000_00, valuePaise: 15_000_00 });
  });

  it("a SIP rule adds its entries to the holding", async () => {
    const s = await setup();
    const h = (await s.make({ investedPaise: undefined, valuePaise: undefined })).json;
    const rule = await s.api("POST", "/api/recurring", { title: "SIP", type: "investment", amountPaise: 5_000_00, accountId: s.bank.id, frequency: "monthly", day: 5, startDate: "2026-09-05", holdingId: h.id });
    expect(rule.status).toBe(201);
    expect(rule.json.holdingId).toBe(h.id);
    const holding = (await s.list()).holdings[0];
    expect(holding.investedPaise).toBe(10_000_00);
    expect(holding.entries).toHaveLength(2);
    expect((await s.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 100_00, accountId: s.bank.id, frequency: "monthly", day: 5, holdingId: h.id })).status).toBe(422);
  });
});

describe("holdings and other people", () => {
  it("are private, need a session, and go into the export", async () => {
    const a = await setup();
    const b = await setup();
    const h = (await a.make()).json;
    expect((await b.list()).holdings).toEqual([]);
    expect((await b.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 1 })).status).toBe(404);
    expect((await b.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 100, accountId: b.bank.id })).status).toBe(404);
    expect((await b.api("DELETE", `/api/holdings/${h.id}`)).status).toBe(404);
    expect((await a.app.call("GET", "/api/holdings", {})).status).toBe(401);
    const data = (await a.api("GET", "/api/export/json")).json;
    expect(data.holdings).toHaveLength(1);
    expect(data.holdingValues).toHaveLength(1);
    expect(data.holdings[0]).not.toHaveProperty("userId");
  });
});
