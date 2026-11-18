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
  const make = (name: string, extra: object = {}) => api("POST", "/api/holdings", { name, kind: "retirement", investedPaise: 0, valuePaise: 10_000_00, valueDate: "2026-10-01", ...extra });
  const get = async (id: string) => ((await api("GET", "/api/holdings")).json.holdings as Json[]).find((h) => h.id === id)!;
  return { api, make, get };
}

describe("contributions to an investment valued by typing", () => {
  it("count as put in, and raise the worth when dated after the latest value typed", async () => {
    const s = await setup();
    const epf = (await s.make("EPF")).json;
    const added = await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_800_00, employerPaise: 550_00 });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ investedPaise: 2_350_00, valuePaise: 12_350_00, gainPaise: 10_000_00 });
    expect(added.json.contributions).toHaveLength(1);
    expect(added.json.contributions[0]).toMatchObject({ date: "2026-10-15", ownPaise: 1_800_00, employerPaise: 550_00, linked: null });
    // an earlier month is already inside the value typed on 1 Oct, so it adds to what was put in but not to the worth
    const earlier = await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-09-20", ownPaise: 1_000_00 });
    expect(earlier.json).toMatchObject({ investedPaise: 3_350_00, valuePaise: 12_350_00 });
  });

  it("start again from a value typed later: typing the passbook balance resets the base", async () => {
    const s = await setup();
    const epf = (await s.make("EPF")).json;
    await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_800_00, employerPaise: 550_00 });
    await s.api("POST", `/api/holdings/${epf.id}/value`, { valuePaise: 13_000_00, date: "2026-10-26" });
    expect((await s.get(epf.id)).valuePaise).toBe(13_000_00);
    await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-27", ownPaise: 100_00 });
    expect((await s.get(epf.id)).valuePaise).toBe(13_100_00);
  });

  it("send a pension share to another investment as a linked entry, and removing one removes both", async () => {
    const s = await setup();
    const epf = (await s.make("EPF")).json;
    const eps = (await s.make("EPS pension", { valuePaise: 0 })).json;
    const res = await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 2_360_00, employerPaise: 722_00, pensionPaise: 1_638_00, pensionHoldingId: eps.id });
    expect(res.status).toBe(201);
    expect(res.json.contributions[0].linked).toMatchObject({ role: "primary", holdingId: eps.id, holdingName: "EPS pension", paise: 1_638_00 });
    const pension = await s.get(eps.id);
    expect(pension).toMatchObject({ investedPaise: 1_638_00, valuePaise: 1_638_00 });
    expect(pension.contributions[0]).toMatchObject({ ownPaise: 0, employerPaise: 1_638_00, linked: { role: "pension", holdingName: "EPF", paise: 3_082_00 } });
    // the EPF entry holds only the person's share and the employer's EPF share
    expect((await s.get(epf.id)).investedPaise).toBe(3_082_00);
    const removed = await s.api("DELETE", `/api/holdings/${eps.id}/contributions/${pension.contributions[0].id}`);
    expect(removed.status).toBe(200);
    expect((await s.get(epf.id)).contributions).toHaveLength(0);
    expect((await s.get(eps.id)).contributions).toHaveLength(0);
  });

  it("refuse an investment counted by quantity, a closed one, and bad amounts or days", async () => {
    const s = await setup();
    const gold = (await s.api("POST", "/api/holdings", { name: "Coins", kind: "gold", tracking: "units", unitsE4: 100_000, investedPaise: 50_000_00 })).json;
    expect((await s.api("POST", `/api/holdings/${gold.id}/contributions`, { date: "2026-10-15", ownPaise: 1_000_00 })).status).toBe(422);
    const epf = (await s.make("EPF")).json;
    const url = `/api/holdings/${epf.id}/contributions`;
    expect((await s.api("POST", url, { date: "2026-10-15" })).status).toBe(422);
    expect((await s.api("POST", url, { date: "2026-10-15", ownPaise: 0, employerPaise: 0 })).status).toBe(422);
    expect((await s.api("POST", url, { date: "2026-10-15", ownPaise: -5 })).status).toBe(422);
    expect((await s.api("POST", url, { date: "2026-10-15", ownPaise: 10.5 })).status).toBe(422);
    expect((await s.api("POST", url, { date: "2026-11-30", ownPaise: 1_000_00 })).status).toBe(422);
    expect((await s.api("POST", url, { date: "2026-13-45", ownPaise: 1_000_00 })).status).toBe(422);
    await s.api("POST", `/api/holdings/${epf.id}/close`);
    expect((await s.api("POST", url, { date: "2026-10-15", ownPaise: 1_000_00 })).status).toBe(409);
  });

  it("refuse a pension share with no target, the same investment, one counted by quantity, or an unknown one", async () => {
    const s = await setup();
    const epf = (await s.make("EPF")).json;
    const gold = (await s.api("POST", "/api/holdings", { name: "Coins", kind: "gold", tracking: "units", unitsE4: 100_000, investedPaise: 50_000_00 })).json;
    const url = `/api/holdings/${epf.id}/contributions`;
    const base = { date: "2026-10-15", ownPaise: 1_000_00, pensionPaise: 500_00 };
    expect((await s.api("POST", url, base)).status).toBe(422);
    expect((await s.api("POST", url, { ...base, pensionHoldingId: epf.id })).status).toBe(422);
    expect((await s.api("POST", url, { ...base, pensionHoldingId: gold.id })).status).toBe(422);
    expect((await s.api("POST", url, { ...base, pensionHoldingId: "nope" })).status).toBe(404);
    expect((await s.get(epf.id)).contributions).toHaveLength(0);
  });

  it("belong to one person, and go when the investment is deleted", async () => {
    const s = await setup();
    const epf = (await s.make("EPF")).json;
    const eps = (await s.make("EPS pension", { valuePaise: 0 })).json;
    await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_000_00, pensionPaise: 500_00, pensionHoldingId: eps.id });
    const other = await setup();
    expect((await other.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_00 })).status).toBe(404);
    const mine = (await s.get(epf.id)).contributions[0];
    expect((await other.api("DELETE", `/api/holdings/${epf.id}/contributions/${mine.id}`)).status).toBe(404);
    expect((await s.api("DELETE", `/api/holdings/${epf.id}/contributions/missing`)).status).toBe(404);
    expect((await s.api("DELETE", `/api/holdings/${epf.id}`)).status).toBe(204);
    // what was left on the pension investment no longer points at anything
    expect((await s.get(eps.id)).contributions[0].linked).toBeNull();
  });

  it("count in net worth, and toward the independence number only when ticked", async () => {
    const s = await setup();
    const epf = (await s.make("EPF")).json;
    const eps = (await s.make("EPS pension", { valuePaise: 0 })).json;
    await s.api("POST", `/api/holdings/${epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_000_00, pensionPaise: 500_00, pensionHoldingId: eps.id });
    await s.api("PATCH", `/api/holdings/${eps.id}`, { countsForFire: false });
    const worth = (await s.api("GET", "/api/accounts")).json.overview.investmentsPaise;
    expect(worth).toBe(10_000_00 + 1_000_00 + 500_00);
    const fire = (await s.api("GET", "/api/fire")).json;
    const flags = Object.fromEntries((fire.corpus.holdings as Json[]).map((h) => [h.name, h.counts]));
    expect(flags).toMatchObject({ EPF: true, "EPS pension": false });
  });
});
