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
  const bank = async (name: string, opening: number, extra: object = {}) =>
    (await api("POST", "/api/accounts", { kind: "bank", name, openingBalancePaise: opening, ...extra })).json;
  const card = async (name: string, owed = 0, statementDay = 23, dueDay = 12) =>
    (await api("POST", "/api/accounts", { kind: "card", name, creditLimitPaise: 1_00_000_00, statementDay, dueDay, openingOutstandingPaise: owed })).json;
  const cats = ((await api("GET", "/api/categories")).json.items as Json[]);
  const food = cats.find((c) => c.name === "Food & Dining")!.id as string;
  const post = (body: object) =>
    api("POST", "/api/transactions", { amountPaise: 100_00, txnDate: "2026-10-05", ...body });
  const spend = (accountId: string, amount = 100_00) => post({ type: "expense", accountId, amountPaise: amount, categoryId: food });
  const list = async () => (await api("GET", "/api/accounts?includeArchived=true")).json;
  const get = async (id: string) => (await list()).items.find((a: Json) => a.id === id) as Json | undefined;
  return { api, bank, card, post, spend, list, get };
}

describe("entryCount", () => {
  it("counts live entries per account, both ends of a transfer, and ignores deleted ones", async () => {
    const { api, bank, card, post, spend, get } = await setup();
    const a = await bank("A", 1_000_00);
    const b = await bank("B", 1_000_00);
    const c = await card("C");
    await spend(a.id);
    await spend(a.id);
    await post({ type: "transfer", accountId: a.id, toAccountId: b.id });
    await post({ type: "bill_payment", accountId: b.id, toAccountId: c.id });
    const gone = (await spend(a.id)).json;
    await api("DELETE", `/api/transactions/${gone.id}`);
    expect((await get(a.id))!.entryCount).toBe(3);
    expect((await get(b.id))!.entryCount).toBe(2);
    expect((await get(c.id))!.entryCount).toBe(1);
  });
});

describe("DELETE /api/accounts/:id", () => {
  it("removes an account with no entries", async () => {
    const { api, bank, get } = await setup();
    const a = await bank("A", 500_00);
    expect((await api("DELETE", `/api/accounts/${a.id}`)).status).toBe(204);
    expect(await get(a.id)).toBeUndefined();
  });

  it("refuses when entries use it, on either side of a transfer", async () => {
    const { api, bank, post, spend } = await setup();
    const a = await bank("A", 500_00);
    const b = await bank("B", 500_00);
    await spend(a.id);
    const res = await api("DELETE", `/api/accounts/${a.id}`);
    expect(res.status).toBe(409);
    expect(res.json.error.message).toContain("1 entry uses this account");
    await post({ type: "transfer", accountId: b.id, toAccountId: a.id });
    expect((await api("DELETE", `/api/accounts/${a.id}`)).json.error.message).toContain("2 entries use this account");
  });

  it("is allowed when only deleted entries remain", async () => {
    const { api, bank, spend, get } = await setup();
    const a = await bank("A", 500_00);
    const t = (await spend(a.id)).json;
    await api("DELETE", `/api/transactions/${t.id}`);
    expect((await api("DELETE", `/api/accounts/${a.id}`)).status).toBe(204);
    expect(await get(a.id)).toBeUndefined();
  });

  it("deletes a card with no entries", async () => {
    const { api, card, get } = await setup();
    const c = await card("C");
    expect((await api("DELETE", `/api/accounts/${c.id}`)).status).toBe(204);
    expect(await get(c.id)).toBeUndefined();
  });

  it("is 404 for another user's account", async () => {
    const a = await setup();
    const b = await setup();
    const mine = await a.bank("Mine", 100_00);
    expect((await b.api("DELETE", `/api/accounts/${mine.id}`)).status).toBe(404);
    expect(await a.get(mine.id)).toBeDefined();
  });
});

describe("POST /api/accounts/:id/merge", () => {
  it("merges banks: entries move, opening balances add, the total is unchanged", async () => {
    const { api, bank, spend, get, list } = await setup();
    const a = await bank("A", 10_000_00);
    const b = await bank("B", 5_000_00);
    await spend(a.id, 1_000_00);
    await spend(b.id, 500_00);
    const before = (await list()).overview;
    const res = await api("POST", `/api/accounts/${a.id}/merge`, { intoId: b.id });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ movedEntries: 1, removedTransfers: 0 });
    expect(await get(a.id)).toBeUndefined();
    const merged = (await get(b.id))!;
    expect(merged.openingBalancePaise).toBe(15_000_00);
    expect(merged.balancePaise).toBe(13_500_00);
    expect(merged.entryCount).toBe(2);
    expect((await list()).overview).toEqual(before);
  });

  it("removes transfers between the two and keeps every balance right", async () => {
    const { api, bank, post, get, list } = await setup();
    const a = await bank("A", 10_000_00);
    const b = await bank("B", 5_000_00);
    const other = await bank("Other", 1_000_00);
    await post({ type: "transfer", accountId: a.id, toAccountId: b.id, amountPaise: 2_000_00 });
    await post({ type: "transfer", accountId: b.id, toAccountId: a.id, amountPaise: 300_00 });
    await post({ type: "transfer", accountId: a.id, toAccountId: other.id, amountPaise: 400_00 });
    const before = (await list()).overview;
    const res = await api("POST", `/api/accounts/${a.id}/merge`, { intoId: b.id });
    expect(res.json).toEqual({ movedEntries: 1, removedTransfers: 2 });
    expect((await get(b.id))!.balancePaise).toBe(15_000_00 - 400_00);
    expect((await get(other.id))!.balancePaise).toBe(1_000_00 + 400_00);
    expect((await list()).overview).toEqual(before);
  });

  it("merges cards: owed amounts add, bill payments follow, statements use the target's days", async () => {
    const { api, bank, card, post, get } = await setup();
    const hdfc = await bank("HDFC", 10_000_00);
    const c1 = await card("Old card", 2_000_00, 20, 7);
    const c2 = await card("New card", 3_000_00, 23, 12);
    await post({ type: "expense", accountId: c1.id, amountPaise: 500_00 });
    await post({ type: "bill_payment", accountId: hdfc.id, toAccountId: c1.id, amountPaise: 1_000_00 });
    const res = await api("POST", `/api/accounts/${c1.id}/merge`, { intoId: c2.id });
    expect(res.json).toEqual({ movedEntries: 2, removedTransfers: 0 });
    const merged = (await get(c2.id))!;
    expect(merged.openingOutstandingPaise).toBe(5_000_00);
    expect(merged.outstandingPaise).toBe(5_000_00 + 500_00 - 1_000_00);
    expect(merged.statementDay).toBe(23);
    expect((await get(hdfc.id))!.balancePaise).toBe(9_000_00);
  });

  it("refuses different kinds, the same account, and an archived target", async () => {
    const { api, bank, card } = await setup();
    const a = await bank("A", 0);
    const b = await bank("B", 0);
    const c = await card("C");
    expect((await api("POST", `/api/accounts/${a.id}/merge`, { intoId: c.id })).status).toBe(422);
    expect((await api("POST", `/api/accounts/${c.id}/merge`, { intoId: a.id })).status).toBe(422);
    expect((await api("POST", `/api/accounts/${a.id}/merge`, { intoId: a.id })).status).toBe(422);
    await api("POST", `/api/accounts/${b.id}/archive`);
    expect((await api("POST", `/api/accounts/${a.id}/merge`, { intoId: b.id })).status).toBe(422);
  });

  it("can merge an archived account into an active one", async () => {
    const { api, bank, spend, get } = await setup();
    const old = await bank("Old", 2_000_00);
    const main = await bank("Main", 1_000_00);
    await spend(old.id, 500_00);
    await api("POST", `/api/accounts/${old.id}/archive`);
    expect((await api("POST", `/api/accounts/${old.id}/merge`, { intoId: main.id })).json.movedEntries).toBe(1);
    expect((await get(main.id))!.balancePaise).toBe(2_500_00);
  });

  it("never touches another user's accounts", async () => {
    const a = await setup();
    const b = await setup();
    const mine = await a.bank("Mine", 100_00);
    const theirs = await b.bank("Theirs", 100_00);
    expect((await b.api("POST", `/api/accounts/${mine.id}/merge`, { intoId: theirs.id })).status).toBe(404);
    expect((await b.api("POST", `/api/accounts/${theirs.id}/merge`, { intoId: mine.id })).status).toBe(404);
    expect(await a.get(mine.id)).toBeDefined();
    expect(await b.get(theirs.id)).toBeDefined();
  });

  it("validates the body", async () => {
    const { api, bank } = await setup();
    const a = await bank("A", 0);
    expect((await api("POST", `/api/accounts/${a.id}/merge`, {})).status).toBe(422);
    expect((await api("POST", `/api/accounts/${a.id}/merge`, { intoId: "x", extra: 1 })).status).toBe(422);
  });
});
