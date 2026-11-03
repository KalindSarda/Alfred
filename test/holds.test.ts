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
  const reserve = (await api("POST", "/api/accounts", { kind: "bank", name: "Reserve", openingBalancePaise: 50_000_00, countsTowardSafeToSpend: false })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const hold = (accountId: string, amountPaise: number, extra: object = {}) =>
    api("POST", "/api/holds", { accountId, title: "Tata Tech IPO", amountPaise, ...extra });
  const safe = async () => (await api("GET", "/api/dashboard/summary?period=cycle")).json.safeToSpendPaise as number;
  const account = async (id: string) => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === id)!;
  const overview = async () => (await api("GET", "/api/accounts")).json.overview as Json;
  return { app, api, bank, reserve, card, hold, safe, account, overview };
}

describe("blocked funds and safe-to-spend", () => {
  it("lowers safe-to-spend and the account's available amount, but not its balance or net worth", async () => {
    const s = await setup();
    const before = await s.safe();
    const res = await s.hold(s.bank.id, 15_000_00);
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ accountName: "HDFC", amountPaise: 15_000_00, status: "active", overdue: false, expectedDate: null });
    expect(await s.safe()).toBe(before - 15_000_00);
    const a = await s.account(s.bank.id);
    expect(a).toMatchObject({ balancePaise: 1_00_000_00, blockedPaise: 15_000_00, availablePaise: 85_000_00 });
    const o = await s.overview();
    expect(o).toMatchObject({ blockedPaise: 15_000_00, totalInBanksPaise: 1_50_000_00, netWorthPaise: 1_50_000_00 });
    expect(o.safeToSpendPaise).toBe(before - 15_000_00);
  });

  it("several applications add up", async () => {
    const s = await setup();
    const before = await s.safe();
    await s.hold(s.bank.id, 15_000_00);
    await s.hold(s.bank.id, 20_000_00, { title: "Another IPO" });
    expect(await s.safe()).toBe(before - 35_000_00);
    expect((await s.account(s.bank.id)).blockedPaise).toBe(35_000_00);
  });

  it("money blocked in a set-aside account does not change safe-to-spend", async () => {
    const s = await setup();
    const before = await s.safe();
    await s.hold(s.reserve.id, 10_000_00);
    expect(await s.safe()).toBe(before);
    expect((await s.account(s.reserve.id)).blockedPaise).toBe(10_000_00);
    expect((await s.overview()).blockedPaise).toBe(0);
  });

  it("releasing a block restores safe-to-spend and debits nothing", async () => {
    const s = await setup();
    const before = await s.safe();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    const res = await s.api("POST", `/api/holds/${h.id}/release`);
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("released");
    expect(res.json.resolvedAt).not.toBeNull();
    expect(await s.safe()).toBe(before);
    expect((await s.account(s.bank.id)).balancePaise).toBe(1_00_000_00);
  });

  it("an allotment debits the account as an investment; safe-to-spend stays where the block had put it", async () => {
    const s = await setup();
    const before = await s.safe();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    const res = await s.api("POST", `/api/holds/${h.id}/allot`, {});
    expect(res.status).toBe(200);
    expect(res.json.hold).toMatchObject({ status: "allotted" });
    expect(res.json.transaction).toMatchObject({ type: "investment", amountPaise: 15_000_00, accountId: s.bank.id, merchant: "Tata Tech IPO", categoryId: null, toAccountId: null });
    expect(res.json.hold.resolvedTxnId).toBe(res.json.transaction.id);
    expect(await s.safe()).toBe(before - 15_000_00);
    expect(await s.account(s.bank.id)).toMatchObject({ balancePaise: 85_000_00, blockedPaise: 0, availablePaise: 85_000_00 });
  });

  it("allotted for less than was blocked: only that is debited, the rest is released", async () => {
    const s = await setup();
    const before = await s.safe();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    const res = await s.api("POST", `/api/holds/${h.id}/allot`, { amountPaise: 14_760_00, date: "2026-10-25" });
    expect(res.json.transaction).toMatchObject({ amountPaise: 14_760_00, txnDate: "2026-10-25" });
    expect(await s.safe()).toBe(before - 14_760_00);
  });

  it("refuses an allotment above the blocked amount and leaves the block in place", async () => {
    const s = await setup();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    expect((await s.api("POST", `/api/holds/${h.id}/allot`, { amountPaise: 15_000_01 })).status).toBe(422);
    expect((await s.account(s.bank.id)).blockedPaise).toBe(15_000_00);
  });

  it("an allotment is never counted as spending", async () => {
    const s = await setup();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    await s.api("POST", `/api/holds/${h.id}/allot`, {});
    const summary = (await s.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(summary.expensePaise).toBe(0);
    expect(summary.uncategorizedCount).toBe(0);
    const flow = (await s.api("GET", "/api/dashboard/cashflow?period=cycle")).json;
    expect(flow.expensePaise).toBe(0);
  });

  it("an allotment that cannot be recorded puts the block back", async () => {
    const s = await setup();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    await s.api("POST", `/api/accounts/${s.bank.id}/archive`);
    const res = await s.api("POST", `/api/holds/${h.id}/allot`, {});
    expect(res.status).toBe(422);
    const listed = (await s.api("GET", "/api/holds")).json.items as Json[];
    expect(listed.find((x) => x.id === h.id)).toMatchObject({ status: "active", resolvedTxnId: null });
  });

  it("can only be settled once", async () => {
    const s = await setup();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    expect((await s.api("POST", `/api/holds/${h.id}/release`)).status).toBe(200);
    expect((await s.api("POST", `/api/holds/${h.id}/release`)).status).toBe(409);
    expect((await s.api("POST", `/api/holds/${h.id}/allot`, {})).status).toBe(409);
  });

  it("two settlements at the same moment: exactly one wins", async () => {
    const s = await setup();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    const [a, b] = await Promise.all([s.api("POST", `/api/holds/${h.id}/allot`, {}), s.api("POST", `/api/holds/${h.id}/release`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe("holds API", () => {
  it("lists active first by soonest outcome, marks overdue ones, and keeps history behind status=all", async () => {
    const s = await setup();
    const late = (await s.hold(s.bank.id, 1_000_00, { title: "Late", expectedDate: "2026-11-10" })).json;
    const soon = (await s.hold(s.bank.id, 2_000_00, { title: "Soon", expectedDate: "2026-11-02" })).json;
    const overdue = (await s.hold(s.bank.id, 3_000_00, { title: "Overdue", appliedDate: "2026-10-20", expectedDate: "2026-10-25" })).json;
    const none = (await s.hold(s.bank.id, 4_000_00, { title: "Undated" })).json;
    const done = (await s.hold(s.bank.id, 5_000_00, { title: "Done" })).json;
    await s.api("POST", `/api/holds/${done.id}/release`);

    const active = (await s.api("GET", "/api/holds")).json.items as Json[];
    expect(active.map((h) => h.title)).toEqual(["Overdue", "Soon", "Late", "Undated"]);
    expect(active.find((h) => h.id === overdue.id)!.overdue).toBe(true);
    expect(active.find((h) => h.id === soon.id)!.overdue).toBe(false);
    const all = (await s.api("GET", "/api/holds?status=all")).json.items as Json[];
    expect(all).toHaveLength(5);
    expect(all.at(-1)!.title).toBe("Done");
    void late;
    void none;
  });

  it("edits an active block, and not a settled one", async () => {
    const s = await setup();
    const before = await s.safe();
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    const res = await s.api("PATCH", `/api/holds/${h.id}`, { amountPaise: 12_000_00, title: "Renamed", expectedDate: "2026-11-05" });
    expect(res.json).toMatchObject({ amountPaise: 12_000_00, title: "Renamed", expectedDate: "2026-11-05" });
    expect(await s.safe()).toBe(before - 12_000_00);
    await s.api("POST", `/api/holds/${h.id}/release`);
    expect((await s.api("PATCH", `/api/holds/${h.id}`, { amountPaise: 1 })).status).toBe(409);
  });

  it("moves a block to another account", async () => {
    const s = await setup();
    const other = (await s.api("POST", "/api/accounts", { kind: "bank", name: "SBI", openingBalancePaise: 0 })).json;
    const h = (await s.hold(s.bank.id, 15_000_00)).json;
    await s.api("PATCH", `/api/holds/${h.id}`, { accountId: other.id });
    expect((await s.account(s.bank.id)).blockedPaise).toBe(0);
    expect((await s.account(other.id)).blockedPaise).toBe(15_000_00);
  });

  it("deletes a mistaken block, but not an allotted one", async () => {
    const s = await setup();
    const a = (await s.hold(s.bank.id, 1_000_00)).json;
    const b = (await s.hold(s.bank.id, 2_000_00)).json;
    expect((await s.api("DELETE", `/api/holds/${a.id}`)).status).toBe(204);
    await s.api("POST", `/api/holds/${b.id}/allot`, {});
    const res = await s.api("DELETE", `/api/holds/${b.id}`);
    expect(res.status).toBe(409);
    expect(res.json.error.message).toContain("investment entry");
  });

  it("validates what it is given", async () => {
    const s = await setup();
    const bad = (body: object) => s.api("POST", "/api/holds", { accountId: s.bank.id, title: "x", amountPaise: 100, ...body });
    expect((await bad({ amountPaise: 0 })).status).toBe(422);
    expect((await bad({ amountPaise: 1.5 })).status).toBe(422);
    expect((await bad({ title: "  " })).status).toBe(422);
    expect((await bad({ appliedDate: "2026-02-30" })).status).toBe(422);
    expect((await bad({ appliedDate: "2026-10-20", expectedDate: "2026-10-19" })).status).toBe(422);
    expect((await bad({ extra: 1 })).status).toBe(422);
    expect((await s.hold(s.card.id, 100)).status).toBe(422);
    expect((await s.hold("nope", 100)).status).toBe(404);
    await s.api("POST", `/api/accounts/${s.reserve.id}/archive`);
    expect((await s.hold(s.reserve.id, 100)).status).toBe(422);
  });

  it("never touches another user's blocks", async () => {
    const a = await setup();
    const b = await setup();
    const h = (await a.hold(a.bank.id, 1_000_00)).json;
    expect((await b.api("POST", `/api/holds/${h.id}/release`)).status).toBe(404);
    expect((await b.api("POST", `/api/holds/${h.id}/allot`, {})).status).toBe(404);
    expect((await b.api("PATCH", `/api/holds/${h.id}`, { title: "x" })).status).toBe(404);
    expect((await b.api("DELETE", `/api/holds/${h.id}`)).status).toBe(404);
    expect((await b.api("GET", "/api/holds")).json.items).toEqual([]);
    expect((await b.hold(a.bank.id, 100)).status).toBe(404);
    expect((await a.account(a.bank.id)).blockedPaise).toBe(1_000_00);
  });

  it("needs a session", async () => {
    const anon = makeApp();
    expect((await anon.call("GET", "/api/holds")).status).toBe(401);
    expect((await anon.call("POST", "/api/holds", { body: {} })).status).toBe(401);
  });
});

describe("blocked funds and the rest of the app", () => {
  it("an account with an active block cannot be deleted; with only settled ones it can", async () => {
    const s = await setup();
    const acc = (await s.api("POST", "/api/accounts", { kind: "bank", name: "Temp", openingBalancePaise: 0 })).json;
    const h = (await s.hold(acc.id, 100_00)).json;
    expect((await s.api("DELETE", `/api/accounts/${acc.id}`)).status).toBe(409);
    await s.api("POST", `/api/holds/${h.id}/release`);
    expect((await s.api("DELETE", `/api/accounts/${acc.id}`)).status).toBe(204);
    expect(((await s.api("GET", "/api/holds?status=all")).json.items as Json[]).some((x) => x.id === h.id)).toBe(false);
  });

  it("merging accounts carries the blocks across", async () => {
    const s = await setup();
    const other = (await s.api("POST", "/api/accounts", { kind: "bank", name: "Old", openingBalancePaise: 5_000_00 })).json;
    await s.hold(other.id, 3_000_00);
    expect((await s.api("POST", `/api/accounts/${other.id}/merge`, { intoId: s.bank.id })).status).toBe(200);
    expect(await s.account(s.bank.id)).toMatchObject({ blockedPaise: 3_000_00, balancePaise: 1_05_000_00 });
  });

  it("the JSON export includes blocked funds", async () => {
    const s = await setup();
    await s.hold(s.bank.id, 1_000_00);
    const body = (await s.api("GET", "/api/export/json")).json;
    expect(body.holds).toHaveLength(1);
    expect(body.holds[0]).toMatchObject({ title: "Tata Tech IPO", amountPaise: 1_000_00 });
    expect(JSON.stringify(body.holds)).not.toContain("userId");
  });

  it("clearing demo data does not trip over a block on a demo account", async () => {
    const s = await setup();
    await s.api("POST", "/api/demo-data");
    const demo = ((await s.api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.name === "Demo Savings")!;
    await s.hold(demo.id, 1_000_00);
    expect((await s.api("DELETE", "/api/demo-data")).status).toBe(200);
  });
});
