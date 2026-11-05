import { describe, expect, it } from "vitest";
import { avgCostPaise, gainPaise, type HoldingFacts, investedPaise, unitsHeldE4, valuePaise } from "../src/domain/holdings";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

const E4 = 10_000;

describe("quantity times rate (domain)", () => {
  const gold: HoldingFacts = {
    openingInvestedPaise: 0,
    purchases: [
      { date: "2023-05-01", amountPaise: 1_00_000_00 },
      { date: "2025-01-10", amountPaise: 90_000_00 },
    ],
    sales: [],
    values: [],
    units: {
      ratePer: 10,
      openingUnitsE4: 0,
      lots: [
        { date: "2023-05-01", unitsE4: 10 * E4 },
        { date: "2025-01-10", unitsE4: 5 * E4 },
      ],
      buys: [],
      sells: [],
      rates: [{ date: "2026-10-01", ratePaise: 1_30_000_00 }],
    },
  };

  it("values the quantity at the rate quoted for 10 g, and shows the return after making charges", () => {
    expect(unitsHeldE4(gold.units!)).toBe(15 * E4);
    // 15 g at ₹1,30,000 per 10 g is ₹1,95,000; ₹1,90,000 was paid.
    expect(valuePaise(gold)).toBe(1_95_000_00);
    expect(investedPaise(gold)).toBe(1_90_000_00);
    expect(gainPaise(gold)).toBe(5_000_00);
    expect(avgCostPaise(gold)).toBe(1_26_666_67);
  });

  it("counts only what was held on the day, and the rate then", () => {
    expect(unitsHeldE4(gold.units!, "2024-01-01")).toBe(10 * E4);
    expect(valuePaise(gold, "2026-09-30")).toBe(1_90_000_00); // no rate yet: at cost
  });

  it("a sale reduces the quantity and never goes below nothing", () => {
    const sold: HoldingFacts = { ...gold, sales: [{ date: "2026-10-10", amountPaise: 60_000_00 }], units: { ...gold.units!, sells: [{ date: "2026-10-10", unitsE4: 5 * E4 }] } };
    expect(valuePaise(sold)).toBe(1_30_000_00);
    expect(gainPaise(sold)).toBe(1_30_000_00 + 60_000_00 - 1_90_000_00);
    const over: HoldingFacts = { ...gold, units: { ...gold.units!, sells: [{ date: "2026-10-10", unitsE4: 99 * E4 }] } };
    expect(valuePaise(over)).toBe(0);
  });

  it("a rate per unit works for funds and shares", () => {
    const fund: HoldingFacts = { openingInvestedPaise: 50_000_00, purchases: [], sales: [], values: [], units: { ratePer: 1, openingUnitsE4: 1234_5678, lots: [], buys: [], sells: [], rates: [{ date: "2026-10-01", ratePaise: 52_34 }] } };
    expect(valuePaise(fund)).toBe(Math.round((1234_5678 * 52_34) / E4));
  });
});

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
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 5_00_000_00 })).json;
  const gold = (extra: object = {}) =>
    api("POST", "/api/holdings", { name: "Gold coins", kind: "gold", tracking: "units", unitsE4: 15 * E4, investedPaise: 1_90_000_00, ratePaise: 1_30_000_00, ...extra });
  return { api, bank, gold };
}

describe("holdings counted by quantity", () => {
  it("creates gold from grams, total paid and a rate per 10 g", async () => {
    const s = await setup();
    const res = await s.gold();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ tracking: "units", unitLabel: "g", ratePer: 10, unitsHeldE4: 15 * E4, ratePaise: 1_30_000_00, valuePaise: 1_95_000_00, investedPaise: 1_90_000_00, gainPaise: 5_000_00, avgCostPaise: 1_26_666_67, missingUnits: 0 });
  });

  it("refuses quantity for crypto, a typed value together with quantity, and quantity fields without it", async () => {
    const s = await setup();
    expect((await s.gold({ name: "Bit", kind: "crypto" })).status).toBe(422);
    expect((await s.gold({ name: "Both", valuePaise: 100 })).status).toBe(422);
    expect((await s.api("POST", "/api/holdings", { name: "Typed", kind: "gold", ratePaise: 100 })).status).toBe(422);
  });

  it("a new rate moves the worth, and a second rate the same day replaces the first", async () => {
    const s = await setup();
    const h = (await s.gold()).json;
    expect((await s.api("POST", `/api/holdings/${h.id}/rate`, { ratePaise: 1_40_000_00 })).json).toMatchObject({ valuePaise: 2_10_000_00, ratePaise: 1_40_000_00 });
    expect((await s.api("POST", `/api/holdings/${h.id}/rate`, { ratePaise: 1_32_000_00 })).json).toMatchObject({ valuePaise: 1_98_000_00 });
    expect((await s.api("POST", `/api/holdings/${h.id}/rate`, { ratePaise: 1, date: "2026-10-28" })).status).toBe(422);
    const typed = (await s.api("POST", "/api/holdings", { name: "Tata", kind: "stock", valuePaise: 100 })).json;
    expect((await s.api("POST", `/api/holdings/${typed.id}/rate`, { ratePaise: 100 })).status).toBe(422);
    expect((await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 100 })).status).toBeLessThan(500);
  });

  it("buying needs a quantity, takes the money from the bank, and raises the quantity at the same rate", async () => {
    const s = await setup();
    const h = (await s.gold()).json;
    expect((await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 20_000_00, accountId: s.bank.id })).status).toBe(422);
    const bought = await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 20_000_00, unitsE4: 15_000, accountId: s.bank.id });
    expect(bought.status).toBe(201);
    expect(bought.json).toMatchObject({ unitsHeldE4: 16_5000, investedPaise: 2_10_000_00, valuePaise: Math.round((16_5000 * 1_30_000_00) / (E4 * 10)), missingUnits: 0 });
    const accounts = (await s.api("GET", "/api/accounts")).json;
    expect((accounts.items as Json[]).find((a) => a.id === s.bank.id)!.balancePaise).toBe(5_00_000_00 - 20_000_00);
  });

  it("a past purchase with no bank is a lot: quantity, cost and day, nothing in the bank", async () => {
    const s = await setup();
    const h = (await s.gold({ unitsE4: undefined, investedPaise: undefined, ratePaise: 1_30_000_00 })).json;
    const added = await s.api("POST", `/api/holdings/${h.id}/lots`, { unitsE4: 5 * E4, costPaise: 65_000_00, date: "2024-03-01" });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ unitsHeldE4: 5 * E4, investedPaise: 65_000_00, valuePaise: 65_000_00 });
    expect(added.json.lots).toHaveLength(1);
    expect((await s.api("POST", `/api/holdings/${h.id}/lots`, { unitsE4: 5, costPaise: 1, date: "2026-10-28" })).status).toBe(422);
    const removed = await s.api("DELETE", `/api/holdings/${h.id}/lots/${added.json.lots[0].id}`);
    expect(removed.json).toMatchObject({ unitsHeldE4: 0, investedPaise: 0 });
    expect((await s.api("DELETE", `/api/holdings/${h.id}/lots/${added.json.lots[0].id}`)).status).toBe(404);
  });

  it("selling cannot take more than is held, and brings the proceeds into the bank", async () => {
    const s = await setup();
    const h = (await s.gold()).json;
    expect((await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 10_000_00, unitsE4: 16 * E4, accountId: s.bank.id })).status).toBe(422);
    expect((await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 10_000_00, accountId: s.bank.id })).status).toBe(422);
    const sold = await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 62_000_00, unitsE4: 5 * E4, accountId: s.bank.id });
    expect(sold.json).toMatchObject({ unitsHeldE4: 10 * E4, soldPaise: 62_000_00, valuePaise: 1_30_000_00 });
    const accounts = (await s.api("GET", "/api/accounts")).json;
    expect((accounts.items as Json[]).find((a) => a.id === s.bank.id)!.balancePaise).toBe(5_00_000_00 + 62_000_00);
  });

  it("a holding valued by typing refuses a quantity", async () => {
    const s = await setup();
    const typed = (await s.api("POST", "/api/holdings", { name: "Tata", kind: "stock", investedPaise: 1000, valuePaise: 1000 })).json;
    expect((await s.api("POST", `/api/holdings/${typed.id}/buy`, { amountPaise: 100, unitsE4: 5, accountId: s.bank.id })).status).toBe(422);
    expect((await s.api("POST", `/api/holdings/${typed.id}/lots`, { unitsE4: 5, costPaise: 1, date: "2026-01-01" })).status).toBe(422);
  });

  it("switches an existing holding to quantity: what was put in stays, linked entries count as part of the quantity", async () => {
    const s = await setup();
    const h = (await s.api("POST", "/api/holdings", { name: "gold coin", kind: "gold", investedPaise: 15_000_00, valuePaise: 13_000_00 })).json;
    await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 15_000_00, accountId: s.bank.id });
    const converted = await s.api("POST", `/api/holdings/${h.id}/convert`, { unitsE4: 2_5000, ratePaise: 1_30_000_00 });
    expect(converted.status).toBe(200);
    expect(converted.json).toMatchObject({ tracking: "units", unitsHeldE4: 2_5000, investedPaise: 30_000_00, valuePaise: 32_500_00, missingUnits: 0 });
    expect((await s.api("POST", `/api/holdings/${h.id}/convert`, { unitsE4: 1, ratePaise: 1 })).status).toBe(409);
    const crypto = (await s.api("POST", "/api/holdings", { name: "Coin", kind: "crypto" })).json;
    expect((await s.api("POST", `/api/holdings/${crypto.id}/convert`, { unitsE4: 1, ratePaise: 1 })).status).toBe(422);
  });

  it("an entry with no quantity is flagged until one is given", async () => {
    const s = await setup();
    const h = (await s.gold()).json;
    const txn = (await s.api("POST", "/api/transactions", { type: "investment", amountPaise: 5_000_00, txnDate: "2026-10-20", accountId: s.bank.id, holdingId: h.id })).json;
    const after = (await s.api("GET", `/api/holdings`)).json.holdings[0];
    expect(after.missingUnits).toBe(1);
    const fixed = await s.api("POST", `/api/holdings/${h.id}/entries/${txn.id}/units`, { unitsE4: 4000 });
    expect(fixed.json).toMatchObject({ missingUnits: 0, unitsHeldE4: 15 * E4 + 4000 });
    expect((await s.api("POST", `/api/holdings/${h.id}/entries/nope/units`, { unitsE4: 4000 })).status).toBe(404);
  });

  it("counts toward net worth at quantity times rate, and is exported", async () => {
    const s = await setup();
    await s.gold();
    const accounts = (await s.api("GET", "/api/accounts")).json;
    expect(accounts.overview.investmentsPaise).toBe(1_95_000_00);
    const lot = (await s.api("GET", "/api/holdings")).json.holdings[0];
    await s.api("POST", `/api/holdings/${lot.id}/lots`, { unitsE4: 1 * E4, costPaise: 12_000_00, date: "2025-01-01" });
    const exported = (await s.api("GET", "/api/export/json")).json;
    expect(exported.holdingLots).toHaveLength(1);
    expect(exported.holdings[0]).toMatchObject({ tracking: "units", openingUnitsE4: 15 * E4 });
  });

  it("another person's holding is not found", async () => {
    const s = await setup();
    const h = (await s.gold()).json;
    const app = makeApp();
    const other = await registeredUser();
    const cookie = await login(app, other.email);
    const res = await app.call("POST", `/api/holdings/${h.id}/rate`, { cookie, body: { ratePaise: 5 } });
    expect(res.status).toBe(404);
  });
});
