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
  const kinds = async () => (await api("GET", "/api/holding-kinds")).json.items as Json[];
  const kind = async (name: string) => (await kinds()).find((k) => k.name === name)!;
  const silver = (extra: object = {}) => api("POST", "/api/holding-kinds", { name: "Silver", unit: "g", ratePer: 1000, ...extra });
  return { app, user, api, kinds, kind, silver };
}

describe("investment kinds", () => {
  it("starts with the six built-in kinds", async () => {
    const s = await setup();
    const list = await s.kinds();
    expect(list.map((k) => k.name).sort()).toEqual(["Crypto", "Gold", "Mutual fund", "Other", "Retirement (EPF, PPF, NPS)", "Stock or IPO"]);
    expect(list.find((k) => k.key === "gold")).toMatchObject({ unit: "g", unitOne: "g", ratePer: 10, isSystem: false, holdingCount: 0, locked: false });
    expect(list.find((k) => k.key === "stock")).toMatchObject({ unit: "shares", unitOne: "share", ratePer: 1, isSystem: true });
    expect(list.find((k) => k.key === "crypto")).toMatchObject({ unit: null, unitOne: null });
  });

  it("creates Silver with a unit and a rate quoted per 1,000 g", async () => {
    const s = await setup();
    const res = await s.silver();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Silver", unit: "g", ratePer: 1000, isSystem: false, archived: false, holdingCount: 0 });
    expect(res.json.key).not.toBe("silver");
  });

  it("refuses a duplicate name (any case), a rate without a unit, a bad rate quantity and extra fields", async () => {
    const s = await setup();
    expect((await s.silver({ name: "gold" })).status).toBe(409);
    expect((await s.api("POST", "/api/holding-kinds", { name: "Art", ratePer: 10 })).status).toBe(422);
    expect((await s.silver({ name: "Platinum", ratePer: 7 })).status).toBe(422);
    expect((await s.silver({ name: "Platinum", colour: "grey" })).status).toBe(422);
    expect((await s.api("POST", "/api/holding-kinds", { name: "Art" })).json).toMatchObject({ unit: null, ratePer: 1 });
  });

  it("holdings can use a custom kind, counted by quantity with the rate quoted for 1,000 g", async () => {
    const s = await setup();
    const silver = (await s.silver()).json;
    const h = await s.api("POST", "/api/holdings", { name: "Silver bars", kind: silver.key, tracking: "units", unitsE4: 10 * E4, investedPaise: 1_000_00, ratePaise: 1_00_000_00 });
    expect(h.status).toBe(201);
    // 10 g at ₹1,00,000 per 1,000 g is ₹1,000.
    expect(h.json).toMatchObject({ kind: silver.key, kindName: "Silver", unitLabel: "g", unitOne: "g", ratePer: 1000, valuePaise: 1_000_00, gainPaise: 0 });
    expect((await s.api("POST", `/api/holdings/${h.json.id}/rate`, { ratePaise: 1_10_000_00 })).json).toMatchObject({ valuePaise: 1_100_00 });
    expect((await s.kind("Silver")).holdingCount).toBe(1);
    expect((await s.kind("Silver")).locked).toBe(true);
  });

  it("a kind with no unit is valued by typing, and a kind that does not exist or is archived is refused", async () => {
    const s = await setup();
    expect((await s.api("POST", "/api/holdings", { name: "Coin", kind: "crypto", tracking: "units", ratePaise: 100 })).status).toBe(422);
    expect((await s.api("POST", "/api/holdings", { name: "X", kind: "bonds" })).status).toBe(422);
    const silver = (await s.silver()).json;
    await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { archived: true });
    expect((await s.api("POST", "/api/holdings", { name: "Bars", kind: silver.key, valuePaise: 100 })).status).toBe(422);
    await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { archived: false });
    expect((await s.api("POST", "/api/holdings", { name: "Bars", kind: silver.key, valuePaise: 100 })).status).toBe(201);
  });

  it("the name can change any time; unit and rate only while no holding is counted by quantity", async () => {
    const s = await setup();
    const silver = (await s.silver()).json;
    expect((await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { unit: "kg", ratePer: 1 })).json).toMatchObject({ unit: "kg", ratePer: 1 });
    await s.api("POST", "/api/holdings", { name: "Bars", kind: silver.key, tracking: "units", unitsE4: E4, investedPaise: 100, ratePaise: 100 });
    expect((await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { name: "Silver coins" })).json).toMatchObject({ name: "Silver coins" });
    const locked = await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { ratePer: 10 });
    expect(locked.status).toBe(409);
    expect(locked.json.error.message).toContain("counted by quantity in 1 holding");
    expect((await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { name: "Gold" })).status).toBe(409);
  });

  it("a holding counted by quantity can only move to a kind counted the same way", async () => {
    const s = await setup();
    const silver = (await s.silver()).json;
    const h = (await s.api("POST", "/api/holdings", { name: "Bars", kind: silver.key, tracking: "units", unitsE4: E4, investedPaise: 100, ratePaise: 100 })).json;
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { kind: "gold" })).status).toBe(422);
    const twin = (await s.silver({ name: "Silver too" })).json;
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { kind: twin.key })).json).toMatchObject({ kindName: "Silver too" });
  });

  it("built-in Stock and Other cannot be archived, deleted or merged away", async () => {
    const s = await setup();
    const stock = await s.kind("Stock or IPO");
    expect((await s.api("PATCH", `/api/holding-kinds/${stock.id}`, { archived: true })).status).toBe(409);
    expect((await s.api("DELETE", `/api/holding-kinds/${stock.id}`)).status).toBe(409);
    const fund = await s.kind("Mutual fund");
    expect((await s.api("POST", `/api/holding-kinds/${stock.id}/merge`, { intoId: fund.id })).status).toBe(409);
    expect((await s.api("PATCH", `/api/holding-kinds/${stock.id}`, { name: "Shares" })).json).toMatchObject({ name: "Shares" });
  });

  it("deletes only an unused kind, and merges into one counted the same way", async () => {
    const s = await setup();
    const a = (await s.silver()).json;
    const b = (await s.silver({ name: "Silver too" })).json;
    const gold = await s.kind("Gold");
    await s.api("POST", "/api/holdings", { name: "Bars", kind: a.key, valuePaise: 100 });
    expect((await s.api("DELETE", `/api/holding-kinds/${a.id}`)).status).toBe(409);
    expect((await s.api("POST", `/api/holding-kinds/${a.id}/merge`, { intoId: gold.id })).status).toBe(422);
    expect((await s.api("POST", `/api/holding-kinds/${a.id}/merge`, { intoId: a.id })).status).toBe(422);
    const merged = await s.api("POST", `/api/holding-kinds/${a.id}/merge`, { intoId: b.id });
    expect(merged.json).toMatchObject({ movedHoldings: 1 });
    expect((await s.kinds()).some((k) => k.id === a.id)).toBe(false);
    expect((await s.kind("Silver too")).holdingCount).toBe(1);
    expect((await s.api("DELETE", `/api/holding-kinds/${b.id}`)).status).toBe(409);
    const empty = (await s.api("POST", "/api/holding-kinds", { name: "Art" })).json;
    expect((await s.api("DELETE", `/api/holding-kinds/${empty.id}`)).status).toBe(204);
  });

  it("is exported, and another person's kinds are not reachable", async () => {
    const s = await setup();
    const silver = (await s.silver()).json;
    const exported = (await s.api("GET", "/api/export/json")).json;
    expect((exported.holdingKinds as Json[]).map((k) => k.name)).toContain("Silver");
    expect(exported.holdingKinds[0]).not.toHaveProperty("userId");
    const app = makeApp();
    const other = await registeredUser();
    const cookie = await login(app, other.email);
    expect((await app.call("PATCH", `/api/holding-kinds/${silver.id}`, { cookie, body: { name: "Mine" } })).status).toBe(404);
    expect((await app.call("DELETE", `/api/holding-kinds/${silver.id}`, { cookie })).status).toBe(404);
  });
});
