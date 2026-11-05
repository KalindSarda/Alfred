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
  await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 });
  const make = (extra: object = {}) => api("POST", "/api/goals", { name: "Laptop", targetPaise: 20_000_00, ...extra });
  const overview = async () => (await api("GET", "/api/accounts")).json.overview as Json;
  const put = (id: string, amountPaise: number, extra: object = {}) => api("POST", `/api/goals/${id}/contributions`, { amountPaise, ...extra });
  return { app, user, api, make, overview, put };
}

describe("creating goals", () => {
  it("makes one with a target and an optional date", async () => {
    const s = await setup();
    const res = await s.make({ targetDate: "2027-01-27" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Laptop", targetPaise: 20_000_00, targetDate: "2027-01-27", status: "active", savedPaise: 0, progressPct: 0, monthlyNeededPaise: 6_666_67, needsAttention: false, contributions: [] });
    expect((await s.api("GET", "/api/goals")).json).toMatchObject({ setAsidePaise: 0 });
  });

  it("refuses a duplicate active name, a bad date and extra fields", async () => {
    const s = await setup();
    await s.make();
    expect((await s.make({ name: "  laptop " })).status).toBe(422);
    expect((await s.make({ name: "Trip", targetDate: "2026-02-30" })).status).toBe(422);
    expect((await s.make({ name: "Trip", targetPaise: 0 })).status).toBe(422);
    expect((await s.make({ name: "Trip", colour: "red" })).status).toBe(422);
  });

  it("edits the name, target and date, and keeps names unique", async () => {
    const s = await setup();
    const a = (await s.make()).json;
    await s.make({ name: "Trip" });
    const res = await s.api("PATCH", `/api/goals/${a.id}`, { targetPaise: 25_000_00, targetDate: null });
    expect(res.json).toMatchObject({ targetPaise: 25_000_00, targetDate: null, monthlyNeededPaise: null });
    expect((await s.api("PATCH", `/api/goals/${a.id}`, { name: "trip" })).status).toBe(422);
  });
});

describe("putting money toward a goal", () => {
  it("only sets it aside: the bank stays, safe-to-spend and the summary drop, net worth is unchanged", async () => {
    const s = await setup();
    const before = await s.overview();
    const g = (await s.make()).json;
    const res = await s.put(g.id, 5_000_00, { note: "bonus" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ savedPaise: 5_000_00, progressPct: 25, remainingPaise: 15_000_00 });
    expect(res.json.contributions[0]).toMatchObject({ amountPaise: 5_000_00, note: "bonus" });

    const after = await s.overview();
    expect(after.totalInBanksPaise).toBe(before.totalInBanksPaise);
    expect(after.netWorthPaise).toBe(before.netWorthPaise);
    expect(after.goalsSetAsidePaise).toBe(5_000_00);
    expect(after.safeToSpendPaise).toBe(before.safeToSpendPaise - 5_000_00);
    expect((await s.api("GET", "/api/dashboard/summary?period=cycle")).json.safeToSpendPaise).toBe(after.safeToSpendPaise);
    expect((await s.api("GET", "/api/goals")).json.setAsidePaise).toBe(5_000_00);
  });

  it("takes money back out, never more than is saved", async () => {
    const s = await setup();
    const g = (await s.make()).json;
    await s.put(g.id, 5_000_00);
    expect((await s.put(g.id, -2_000_00)).json.savedPaise).toBe(3_000_00);
    expect((await s.put(g.id, -3_000_01)).status).toBe(422);
    expect((await s.put(g.id, 0)).status).toBe(422);
    expect((await s.overview()).goalsSetAsidePaise).toBe(3_000_00);
  });

  it("refuses a future date, and may go past the target", async () => {
    const s = await setup();
    const g = (await s.make()).json;
    expect((await s.put(g.id, 100, { date: "2026-10-28" })).status).toBe(422);
    const res = await s.put(g.id, 25_000_00, { date: "2026-10-01" });
    expect(res.json).toMatchObject({ savedPaise: 25_000_00, progressPct: 100, remainingPaise: 0, monthlyNeededPaise: null });
  });

  it("removes an entry, unless that would leave less than nothing saved", async () => {
    const s = await setup();
    const g = (await s.make()).json;
    const first = (await s.put(g.id, 5_000_00)).json.contributions[0];
    await s.put(g.id, -4_000_00);
    expect((await s.api("DELETE", `/api/goals/${g.id}/contributions/${first.id}`)).status).toBe(409);
    const withdrawal = (await s.api("GET", "/api/goals")).json.goals[0].contributions.find((c: Json) => c.amountPaise < 0);
    expect((await s.api("DELETE", `/api/goals/${g.id}/contributions/${withdrawal.id}`)).json.savedPaise).toBe(5_000_00);
    expect((await s.api("DELETE", `/api/goals/${g.id}/contributions/${first.id}`)).json.savedPaise).toBe(0);
    expect((await s.api("DELETE", `/api/goals/${g.id}/contributions/nope`)).status).toBe(404);
  });

  it("flags a goal whose date is close, with the briefing saying so", async () => {
    const s = await setup();
    const g = (await s.make({ targetDate: "2026-11-10" })).json;
    expect(g.needsAttention).toBe(true);
    await s.put(g.id, 5_000_00);
    const lines = (await s.api("GET", "/api/alfred/briefing")).json.lines as Json[];
    const line = lines.find((l) => l.key === "goals")!;
    expect(line.text).toContain("₹5,000 is put toward a savings goal");
    expect(line.text).toContain("Laptop still needs ₹15,000 by 10 Nov");
    expect(line.to).toBe("/plan?view=goals");
  });
});

describe("closing goals", () => {
  it("achieving releases the set-aside and closes the goal", async () => {
    const s = await setup();
    const before = await s.overview();
    const g = (await s.make()).json;
    await s.put(g.id, 20_000_00);
    const res = await s.api("POST", `/api/goals/${g.id}/achieve`);
    expect(res.json).toMatchObject({ status: "achieved", savedPaise: 20_000_00 });
    expect((await s.overview()).safeToSpendPaise).toBe(before.safeToSpendPaise);
    expect((await s.api("GET", "/api/goals")).json.goals).toEqual([]);
    expect(((await s.api("GET", "/api/goals?status=all")).json.goals as Json[]).map((x) => x.status)).toEqual(["achieved"]);
    expect((await s.put(g.id, 100)).status).toBe(409);
    expect((await s.api("PATCH", `/api/goals/${g.id}`, { targetPaise: 1 })).status).toBe(409);
  });

  it("archiving releases it too, and the name can be used again", async () => {
    const s = await setup();
    const before = await s.overview();
    const g = (await s.make()).json;
    await s.put(g.id, 4_000_00);
    expect((await s.api("POST", `/api/goals/${g.id}/archive`)).json.status).toBe("archived");
    expect((await s.overview()).safeToSpendPaise).toBe(before.safeToSpendPaise);
    expect((await s.make()).status).toBe(201);
  });

  it("deletes only a goal with no money put toward it", async () => {
    const s = await setup();
    const empty = (await s.make({ name: "Empty" })).json;
    const used = (await s.make({ name: "Used" })).json;
    await s.put(used.id, 100);
    expect((await s.api("DELETE", `/api/goals/${used.id}`)).status).toBe(409);
    expect((await s.api("DELETE", `/api/goals/${empty.id}`)).status).toBe(204);
    expect((await s.api("DELETE", `/api/goals/${empty.id}`)).status).toBe(404);
  });
});

describe("goals and other people", () => {
  it("keeps each person's goals to themselves", async () => {
    const a = await setup();
    const b = await setup();
    const g = (await a.make()).json;
    await a.put(g.id, 5_000_00);
    expect((await b.api("GET", "/api/goals")).json.goals).toEqual([]);
    expect((await b.put(g.id, 100)).status).toBe(404);
    expect((await b.api("POST", `/api/goals/${g.id}/achieve`)).status).toBe(404);
    expect((await b.api("DELETE", `/api/goals/${g.id}`)).status).toBe(404);
    expect((await b.overview()).goalsSetAsidePaise).toBe(0);
  });

  it("needs a signed-in person", async () => {
    const s = await setup();
    expect((await s.app.call("GET", "/api/goals", {})).status).toBe(401);
  });

  it("goes into the export", async () => {
    const s = await setup();
    const g = (await s.make()).json;
    await s.put(g.id, 5_000_00);
    const data = (await s.api("GET", "/api/export/json")).json;
    expect(data.goals).toHaveLength(1);
    expect(data.goalContributions).toHaveLength(1);
    expect(data.goals[0]).not.toHaveProperty("userId");
  });
});
