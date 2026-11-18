import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

const E4 = 10_000;

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
  const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 5_00_000_00 })).json;
  const icici = (await api("POST", "/api/accounts", { kind: "bank", name: "ICICI", openingBalancePaise: 5_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const balance = async (id: string) => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === id)!.balancePaise as number;
  const get = async (id: string) => ((await api("GET", "/api/holdings?status=all")).json.holdings as Json[]).find((h) => h.id === id)!;
  const gold = async () => (await api("POST", "/api/holdings", { name: "Coins", kind: "gold", tracking: "units", unitsE4: 10 * E4, investedPaise: 50_000_00, ratePaise: 1_30_000_00 })).json;
  const epf = async (name = "EPF", extra: object = {}) => (await api("POST", "/api/holdings", { name, kind: "retirement", investedPaise: 0, valuePaise: 10_000_00, valueDate: "2026-10-01", ...extra })).json;
  return { api, hdfc, icici, card, balance, get, gold, epf };
}

describe("correcting a buy or a sale", () => {
  it("changes the amount, day, bank, quantity and note, and everything follows", async () => {
    const s = await setup();
    const g = await s.gold();
    const bought = (await s.api("POST", `/api/holdings/${g.id}/buy`, { amountPaise: 70_000_00, unitsE4: 5 * E4, accountId: s.hdfc.id, date: "2026-10-10" })).json;
    const entry = bought.entries[0];
    expect(entry).toMatchObject({ accountId: s.hdfc.id, amountPaise: 70_000_00, unitsE4: 5 * E4 });
    const before = await s.balance(s.hdfc.id);
    const res = await s.api("PATCH", `/api/holdings/${g.id}/entries/${entry.id}`, { amountPaise: 60_000_00, unitsE4: 4 * E4, accountId: s.icici.id, date: "2026-10-12", note: "Diwali" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ investedPaise: 1_10_000_00, unitsHeldE4: 14 * E4 });
    expect(res.json.entries[0]).toMatchObject({ amountPaise: 60_000_00, unitsE4: 4 * E4, accountId: s.icici.id, date: "2026-10-12", note: "Diwali" });
    expect(await s.balance(s.hdfc.id)).toBe(before + 70_000_00);
    expect(await s.balance(s.icici.id)).toBe(5_00_000_00 - 60_000_00);
    // an edit that sends only a note changes nothing else
    const noted = await s.api("PATCH", `/api/holdings/${g.id}/entries/${entry.id}`, { note: "Gold coins" });
    expect(noted.json.entries[0]).toMatchObject({ amountPaise: 60_000_00, unitsE4: 4 * E4, note: "Gold coins" });
  });

  it("corrects a sale, and refuses one that sells more than was bought", async () => {
    const s = await setup();
    const g = await s.gold();
    await s.api("POST", `/api/holdings/${g.id}/buy`, { amountPaise: 40_000_00, unitsE4: 3 * E4, accountId: s.hdfc.id, date: "2026-10-05" });
    const sold = (await s.api("POST", `/api/holdings/${g.id}/sell`, { amountPaise: 20_000_00, unitsE4: 2 * E4, accountId: s.hdfc.id, date: "2026-10-20" })).json;
    const sale = sold.entries.find((e: Json) => e.kind === "sell");
    const fixed = await s.api("PATCH", `/api/holdings/${g.id}/entries/${sale.id}`, { amountPaise: 22_000_00, unitsE4: 1 * E4 });
    expect(fixed.status).toBe(200);
    expect(fixed.json).toMatchObject({ soldPaise: 22_000_00, unitsHeldE4: 12 * E4 });
    // 10 g opening and 3 g bought is 13 g, so 14 g sold is too much
    const tooMuch = await s.api("PATCH", `/api/holdings/${g.id}/entries/${sale.id}`, { unitsE4: 14 * E4 });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.json.error.details[0]).toMatchObject({ path: "unitsE4" });
  });

  it("refuses what does not belong: another holding, a card, a future day, a quantity on something valued by typing", async () => {
    const s = await setup();
    const g = await s.gold();
    const e = await s.epf();
    const bought = (await s.api("POST", `/api/holdings/${g.id}/buy`, { amountPaise: 40_000_00, unitsE4: 3 * E4, accountId: s.hdfc.id, date: "2026-10-05" })).json;
    const id = bought.entries[0].id;
    expect((await s.api("PATCH", `/api/holdings/${e.id}/entries/${id}`, { note: "x" })).status).toBe(404);
    expect((await s.api("PATCH", `/api/holdings/${g.id}/entries/${id}`, { accountId: s.card.id })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${g.id}/entries/${id}`, { date: "2026-12-01" })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${g.id}/entries/${id}`, { amountPaise: 0 })).status).toBe(422);
    const typed = (await s.api("POST", `/api/holdings/${e.id}/buy`, { amountPaise: 1_000_00, accountId: s.hdfc.id, date: "2026-10-05" })).json;
    expect((await s.api("PATCH", `/api/holdings/${e.id}/entries/${typed.entries[0].id}`, { unitsE4: 1 * E4 })).status).toBe(422);
    const other = await setup();
    expect((await other.api("PATCH", `/api/holdings/${g.id}/entries/${id}`, { note: "x" })).status).toBe(404);
  });

  it("removes a sale, and removes a buy only when no sale depends on it", async () => {
    const s = await setup();
    const g = await s.gold();
    const bought = (await s.api("POST", `/api/holdings/${g.id}/buy`, { amountPaise: 40_000_00, unitsE4: 3 * E4, accountId: s.hdfc.id, date: "2026-10-05" })).json;
    const buy = bought.entries[0];
    // sell 12 g of the 13 g held, more than the opening 10 g, so the 3 g bought is needed
    const sold = (await s.api("POST", `/api/holdings/${g.id}/sell`, { amountPaise: 1_50_000_00, unitsE4: 12 * E4, accountId: s.hdfc.id, date: "2026-10-20" })).json;
    const sale = sold.entries.find((e: Json) => e.kind === "sell");
    const blocked = await s.api("DELETE", `/api/holdings/${g.id}/entries/${buy.id}`);
    expect(blocked.status).toBe(422);
    const before = await s.balance(s.hdfc.id);
    const undone = await s.api("DELETE", `/api/holdings/${g.id}/entries/${sale.id}`);
    expect(undone.status).toBe(200);
    expect(undone.json).toMatchObject({ soldPaise: 0, unitsHeldE4: 13 * E4 });
    expect(await s.balance(s.hdfc.id)).toBe(before - 1_50_000_00);
    expect((await s.api("DELETE", `/api/holdings/${g.id}/entries/${buy.id}`)).status).toBe(200);
    expect((await s.get(g.id)).entries).toHaveLength(0);
    expect((await s.api("DELETE", `/api/holdings/${g.id}/entries/${buy.id}`)).status).toBe(404);
  });
});

describe("correcting a purchase from before tracking", () => {
  it("changes the quantity, cost, day and note, and refuses a quantity the sales need", async () => {
    const s = await setup();
    const g = await s.gold();
    const lot = (await s.api("POST", `/api/holdings/${g.id}/lots`, { date: "2025-05-01", unitsE4: 4 * E4, costPaise: 40_000_00 })).json.lots[0];
    const res = await s.api("PATCH", `/api/holdings/${g.id}/lots/${lot.id}`, { unitsE4: 5 * E4, costPaise: 52_000_00, date: "2025-06-01", note: "Akshaya Tritiya" });
    expect(res.status).toBe(200);
    expect(res.json.lots[0]).toMatchObject({ unitsE4: 5 * E4, costPaise: 52_000_00, date: "2025-06-01", note: "Akshaya Tritiya" });
    expect(res.json.unitsHeldE4).toBe(15 * E4);
    await s.api("POST", `/api/holdings/${g.id}/sell`, { amountPaise: 1_90_000_00, unitsE4: 15 * E4, accountId: s.hdfc.id, date: "2026-10-20" });
    expect((await s.api("PATCH", `/api/holdings/${g.id}/lots/${lot.id}`, { unitsE4: 1 * E4 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${g.id}/lots/missing`, { note: "x" })).status).toBe(404);
    expect((await s.api("PATCH", `/api/holdings/${g.id}/lots/${lot.id}`, { date: "2026-12-01" })).status).toBe(422);
    const other = await setup();
    expect((await other.api("PATCH", `/api/holdings/${g.id}/lots/${lot.id}`, { note: "x" })).status).toBe(404);
  });
});

describe("correcting a month of contributions", () => {
  it("changes the amounts, day and note, and keeps the pension share in step", async () => {
    const s = await setup();
    const epf = await s.epf();
    const eps = await s.epf("EPS pension", { valuePaise: 0 });
    const added = (await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 2_360_00, employerPaise: 722_00, pensionPaise: 1_638_00, pensionHoldingId: eps.id })).json;
    const c = added.contributions[0];
    const url = `/api/holdings/${epf.id}/contributions/${c.id}`;
    const fixed = await s.api("PATCH", url, { date: "2026-10-16", ownPaise: 2_400_00, employerPaise: 700_00, pensionPaise: 1_000_00, pensionHoldingId: eps.id, note: "Corrected" });
    expect(fixed.status).toBe(200);
    expect(fixed.json.contributions[0]).toMatchObject({ date: "2026-10-16", ownPaise: 2_400_00, employerPaise: 700_00, note: "Corrected", linked: { role: "primary", paise: 1_000_00 } });
    expect(await s.get(eps.id)).toMatchObject({ investedPaise: 1_000_00 });
    expect((await s.get(eps.id)).contributions[0]).toMatchObject({ date: "2026-10-16", employerPaise: 1_000_00, note: "Corrected" });
    // drop the pension share: the linked entry goes
    const dropped = await s.api("PATCH", url, { date: "2026-10-16", ownPaise: 2_400_00, employerPaise: 700_00 });
    expect(dropped.json.contributions[0].linked).toBeNull();
    expect((await s.get(eps.id)).contributions).toHaveLength(0);
    // add one back
    const back = await s.api("PATCH", url, { date: "2026-10-16", ownPaise: 2_400_00, employerPaise: 700_00, pensionPaise: 500_00, pensionHoldingId: eps.id });
    expect(back.json.contributions[0].linked).toMatchObject({ role: "primary", holdingId: eps.id, paise: 500_00 });
    expect((await s.get(eps.id)).contributions).toHaveLength(1);
  });

  it("moves the pension share to another investment, and refuses a change from the pension side", async () => {
    const s = await setup();
    const epf = await s.epf();
    const eps = await s.epf("EPS pension", { valuePaise: 0 });
    const nps = await s.epf("NPS pension", { valuePaise: 0 });
    const c = (await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_000_00, pensionPaise: 500_00, pensionHoldingId: eps.id })).json.contributions[0];
    await s.api("PATCH", `/api/holdings/${epf.id}/contributions/${c.id}`, { date: "2026-10-15", ownPaise: 1_000_00, pensionPaise: 500_00, pensionHoldingId: nps.id });
    expect((await s.get(eps.id)).contributions).toHaveLength(0);
    expect((await s.get(nps.id)).contributions).toHaveLength(1);
    const side = (await s.get(nps.id)).contributions[0];
    const refused = await s.api("PATCH", `/api/holdings/${nps.id}/contributions/${side.id}`, { date: "2026-10-15", employerPaise: 600_00 });
    expect(refused.status).toBe(409);
  });

  it("refuses bad input, an investment counted by quantity, and another person's entry", async () => {
    const s = await setup();
    const epf = await s.epf();
    const c = (await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_000_00 })).json.contributions[0];
    const url = `/api/holdings/${epf.id}/contributions/${c.id}`;
    expect((await s.api("PATCH", url, { date: "2026-10-15" })).status).toBe(422);
    expect((await s.api("PATCH", url, { date: "2026-12-01", ownPaise: 1_00 })).status).toBe(422);
    expect((await s.api("PATCH", url, { date: "2026-10-15", ownPaise: 1_00, pensionPaise: 5_00 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${epf.id}/contributions/missing`, { date: "2026-10-15", ownPaise: 1_00 })).status).toBe(404);
    const other = await setup();
    expect((await other.api("PATCH", url, { date: "2026-10-15", ownPaise: 1_00 })).status).toBe(404);
  });
});

describe("the opening balance", () => {
  it("changes the quantity and the amount put in before tracking", async () => {
    const s = await setup();
    const g = await s.gold();
    const res = await s.api("PATCH", `/api/holdings/${g.id}`, { openingUnitsE4: 12 * E4, openingInvestedPaise: 60_000_00 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ openingUnitsE4: 12 * E4, openingInvestedPaise: 60_000_00, unitsHeldE4: 12 * E4, investedPaise: 60_000_00 });
    const zero = await s.api("PATCH", `/api/holdings/${g.id}`, { openingUnitsE4: 0, openingInvestedPaise: 0 });
    expect(zero.json).toMatchObject({ unitsHeldE4: 0, investedPaise: 0 });
  });

  it("changes the amount for something valued by typing, but not a quantity", async () => {
    const s = await setup();
    const e = await s.epf();
    expect((await s.api("PATCH", `/api/holdings/${e.id}`, { openingInvestedPaise: 7_000_00 })).json).toMatchObject({ openingInvestedPaise: 7_000_00, investedPaise: 7_000_00 });
    expect((await s.api("PATCH", `/api/holdings/${e.id}`, { openingUnitsE4: 5 * E4 })).status).toBe(422);
  });

  it("refuses a negative amount, a quantity the sales need, and both ways of setting the amount at once", async () => {
    const s = await setup();
    const g = await s.gold();
    await s.api("POST", `/api/holdings/${g.id}/sell`, { amountPaise: 1_00_000_00, unitsE4: 8 * E4, accountId: s.hdfc.id, date: "2026-10-20" });
    expect((await s.api("PATCH", `/api/holdings/${g.id}`, { openingUnitsE4: 5 * E4 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${g.id}`, { openingInvestedPaise: -1 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${g.id}`, { openingInvestedPaise: 1_00, investedPaise: 2_00 })).status).toBe(422);
  });
});

describe("deleting a typed value", () => {
  it("removes the value typed on one day, and the worth falls back to what is left", async () => {
    const s = await setup();
    const e = await s.epf();
    await s.api("POST", `/api/holdings/${e.id}/value`, { valuePaise: 12_000_00, date: "2026-10-20" });
    expect((await s.get(e.id)).valuePaise).toBe(12_000_00);
    const res = await s.api("DELETE", `/api/holdings/${e.id}/values/2026-10-20`);
    expect(res.status).toBe(200);
    expect(res.json.valuePaise).toBe(10_000_00);
    expect(res.json.values.map((v: Json) => v.date)).toEqual(["2026-10-01"]);
    expect((await s.api("DELETE", `/api/holdings/${e.id}/values/2026-10-20`)).status).toBe(404);
  });

  it("removes a typed rate from something counted by quantity", async () => {
    const s = await setup();
    const g = await s.gold();
    // the rate given when it was added is dated today; typing today again replaces it
    await s.api("POST", `/api/holdings/${g.id}/rate`, { ratePaise: 1_40_000_00 });
    await s.api("POST", `/api/holdings/${g.id}/rate`, { ratePaise: 1_20_000_00, date: "2026-10-20" });
    expect((await s.get(g.id)).ratePaise).toBe(1_40_000_00);
    // deleting an earlier day leaves the latest rate alone
    expect((await s.api("DELETE", `/api/holdings/${g.id}/values/2026-10-20`)).json.ratePaise).toBe(1_40_000_00);
    // deleting the latest day leaves no rate, so the worth falls back to what was put in
    const none = await s.api("DELETE", `/api/holdings/${g.id}/values/2026-10-27`);
    expect(none.json).toMatchObject({ ratePaise: null, valuePaise: 50_000_00 });
  });

  it("refuses a closed holding, a bad day and another person's holding", async () => {
    const s = await setup();
    const e = await s.epf();
    expect((await s.api("DELETE", `/api/holdings/${e.id}/values/not-a-day`)).status).toBe(422);
    const other = await setup();
    expect((await other.api("DELETE", `/api/holdings/${e.id}/values/2026-10-01`)).status).toBe(404);
    await s.api("POST", `/api/holdings/${e.id}/close`);
    expect((await s.api("DELETE", `/api/holdings/${e.id}/values/2026-10-01`)).status).toBe(409);
  });
});
