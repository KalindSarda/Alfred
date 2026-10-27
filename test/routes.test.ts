import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser, type TestApp } from "./api-helpers";

type Json = Record<string, any>;

async function session() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as Json };
  };
  return { app, user, cookie, api };
}

async function otherSession(app: TestApp) {
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  return { user, cookie, call };
}

const bank = (name = "HDFC Bank", opening = 10_000_00) => ({ kind: "bank", name, openingBalancePaise: opening });
const card = (name = "HDFC Millennia") => ({
  kind: "card",
  name,
  creditLimitPaise: 2_00_000_00,
  statementDay: 23,
  dueDay: 12,
});

describe("accounts", () => {
  it("creates a bank account and a card with computed figures", async () => {
    const { api } = await session();
    const b = await api("POST", "/api/accounts", bank());
    expect(b.status).toBe(201);
    expect(b.json).toMatchObject({ kind: "bank", name: "HDFC Bank", balancePaise: 10_000_00, countsTowardSafeToSpend: true, archived: false });

    const c = await api("POST", "/api/accounts", { ...card(), last4: "1234" });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({
      kind: "card",
      last4: "1234",
      outstandingPaise: 0,
      unbilledPaise: 0,
      utilizationPct: 0,
      nextStatementDate: "2026-11-23",
      nextDueDate: "2026-11-12",
    });
  });

  it("rejects bad payloads with field details", async () => {
    const { api } = await session();
    const noLimit = await api("POST", "/api/accounts", { kind: "card", name: "X", statementDay: 1, dueDay: 2 });
    expect(noLimit.status).toBe(422);
    expect(noLimit.json.error.code).toBe("validation_failed");
    expect((await api("POST", "/api/accounts", { ...card(), statementDay: 32 })).status).toBe(422);
    expect((await api("POST", "/api/accounts", { ...bank(), last4: "12" })).status).toBe(422);
    expect((await api("POST", "/api/accounts", { kind: "wallet", name: "X" })).status).toBe(422);
    expect((await api("POST", "/api/accounts", { ...bank(), openingBalancePaise: 10.5 })).status).toBe(422);
  });

  it("409s on a duplicate name", async () => {
    const { api } = await session();
    await api("POST", "/api/accounts", bank());
    expect((await api("POST", "/api/accounts", bank())).status).toBe(409);
  });

  it("lists accounts, hiding archived ones unless asked", async () => {
    const { api } = await session();
    const a = (await api("POST", "/api/accounts", bank("A"))).json;
    await api("POST", "/api/accounts", bank("B"));
    await api("POST", `/api/accounts/${a.id}/archive`);
    expect((await api("GET", "/api/accounts")).json.items.map((x: Json) => x.name)).toEqual(["B"]);
    const all = (await api("GET", "/api/accounts?includeArchived=true")).json.items;
    expect(all.map((x: Json) => x.name)).toEqual(["A", "B"]);
    expect(all[0].archived).toBe(true);
    expect((await api("GET", "/api/accounts?includeArchived=maybe")).status).toBe(422);
  });

  it("patches applicable fields and rejects the rest", async () => {
    const { api } = await session();
    const b = (await api("POST", "/api/accounts", bank())).json;
    const c = (await api("POST", "/api/accounts", card())).json;

    const renamed = await api("PATCH", `/api/accounts/${b.id}`, { name: "HDFC Salary", countsTowardSafeToSpend: false });
    expect(renamed.json).toMatchObject({ name: "HDFC Salary", countsTowardSafeToSpend: false });

    const moved = await api("PATCH", `/api/accounts/${c.id}`, { statementDay: 20, dueDay: 7 });
    expect(moved.json).toMatchObject({ statementDay: 20, dueDay: 7, nextStatementDate: "2026-11-20", nextDueDate: "2026-11-07" });

    expect((await api("PATCH", `/api/accounts/${c.id}`, { openingBalancePaise: 1 })).status).toBe(422);
    expect((await api("PATCH", `/api/accounts/${b.id}`, { creditLimitPaise: 1 })).status).toBe(422);
    expect((await api("PATCH", `/api/accounts/${b.id}`, { kind: "card" })).status).toBe(422);
    expect((await api("PATCH", `/api/accounts/${b.id}`, { name: "HDFC Salary" })).status).toBe(200);
    expect((await api("PATCH", `/api/accounts/${b.id}`, { name: card().name })).status).toBe(409);
    expect((await api("PATCH", "/api/accounts/nope", { name: "Z" })).status).toBe(404);
  });

  it("will not archive a card that still owes money, and archived accounts cannot take transactions", async () => {
    const { api } = await session();
    const b = (await api("POST", "/api/accounts", bank())).json;
    const c = (await api("POST", "/api/accounts", card())).json;
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 500_00, txnDate: "2026-10-26", accountId: c.id });

    const refused = await api("POST", `/api/accounts/${c.id}/archive`);
    expect(refused.status).toBe(409);

    await api("POST", "/api/transactions", { type: "bill_payment", amountPaise: 500_00, txnDate: "2026-10-27", accountId: b.id, toAccountId: c.id });
    expect((await api("POST", `/api/accounts/${c.id}/archive`)).status).toBe(200);

    await api("POST", `/api/accounts/${b.id}/archive`);
    const onArchived = await api("POST", "/api/transactions", { type: "expense", amountPaise: 1_00, txnDate: "2026-10-27", accountId: b.id });
    expect(onArchived.status).toBe(422);
    expect((await api("POST", `/api/accounts/${b.id}/unarchive`)).json.archived).toBe(false);
  });

  it("another user gets 404 for your account", async () => {
    const { app, api } = await session();
    const mine = (await api("POST", "/api/accounts", bank())).json;
    const other = await otherSession(app);
    expect((await other.call("PATCH", `/api/accounts/${mine.id}`, { name: "Stolen" })).status).toBe(404);
    expect((await other.call("POST", `/api/accounts/${mine.id}/archive`)).status).toBe(404);
    expect((await other.call("GET", "/api/accounts")).json.items).toEqual([]);
  });
});

describe("transactions", () => {
  async function withAccounts() {
    const s = await session();
    const hdfc = (await s.api("POST", "/api/accounts", bank())).json;
    const sbi = (await s.api("POST", "/api/accounts", bank("SBI", 5_000_00))).json;
    const millennia = (await s.api("POST", "/api/accounts", card())).json;
    return { ...s, hdfc, sbi, millennia };
  }

  it("creates, reads, updates, deletes and restores", async () => {
    const { api, hdfc } = await withAccounts();
    const created = await api("POST", "/api/transactions", {
      type: "expense",
      amountPaise: 450_00,
      txnDate: "2026-10-26",
      accountId: hdfc.id,
      merchant: "Swiggy",
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ type: "expense", amountPaise: 45000, status: "confirmed", source: "web", merchant: "Swiggy" });
    const id = created.json.id;

    expect((await api("GET", `/api/transactions/${id}`)).json).toEqual(created.json);
    const patched = await api("PATCH", `/api/transactions/${id}`, { amountPaise: 500_00, note: "dinner" });
    expect(patched.json).toMatchObject({ amountPaise: 50000, note: "dinner" });

    const deleted = await api("DELETE", `/api/transactions/${id}`);
    expect(deleted.status).toBe(204);
    expect((await api("GET", `/api/transactions/${id}`)).status).toBe(404);
    expect((await api("GET", "/api/transactions")).json.items).toEqual([]);

    expect((await api("POST", `/api/transactions/${id}/restore`)).status).toBe(200);
    expect((await api("GET", `/api/transactions/${id}`)).status).toBe(200);
  });

  it("a bill payment moves both balances and is not an expense", async () => {
    const { api, hdfc, millennia } = await withAccounts();
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-20", accountId: millennia.id });
    const pay = await api("POST", "/api/transactions", {
      type: "bill_payment",
      amountPaise: 4_500_00,
      txnDate: "2026-10-25",
      accountId: hdfc.id,
      toAccountId: millennia.id,
      note: "Oct bill",
    });
    expect(pay.status).toBe(201);
    expect(pay.json.toAccountId).toBe(millennia.id);
    const items = (await api("GET", "/api/accounts")).json.items as Json[];
    expect(items.find((a) => a.id === hdfc.id)?.balancePaise).toBe(10_000_00 - 4_500_00);
    expect(items.find((a) => a.id === millennia.id)?.outstandingPaise).toBe(0);
  });

  it("returns 422 with details for invalid bodies and 422 for non-JSON", async () => {
    const { api, hdfc, app, cookie } = await withAccounts();
    const bad = await api("POST", "/api/transactions", { type: "bill_payment", amountPaise: 100, txnDate: "2026-10-26", accountId: hdfc.id });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details[0].path).toBe("toAccountId");
    const notJson = await app.call("POST", "/api/transactions", { cookie, body: "{nope" });
    expect(notJson.status).toBe(422);
    expect((await api("POST", "/api/transactions", { type: "expense", amountPaise: 0, txnDate: "2026-10-26", accountId: hdfc.id })).status).toBe(422);
  });

  it("Idempotency-Key makes retries safe and is scoped per user", async () => {
    const { api, hdfc, app, cookie } = await withAccounts();
    const body = { type: "expense", amountPaise: 99_00, txnDate: "2026-10-26", accountId: hdfc.id };
    const send = (key: string, who = cookie, target = app) =>
      target.call("POST", "/api/transactions", { cookie: who, body, headers: { "Idempotency-Key": key } });

    const first = await send("retry-1");
    const second = await send("retry-1");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(((await second.json()) as Json).id).toBe(((await first.json()) as Json).id);
    expect((await api("GET", "/api/transactions")).json.items).toHaveLength(1);

    expect((await send("k".repeat(101))).status).toBe(422);
    expect((await api("GET", "/api/transactions")).json.items).toHaveLength(1);

    // The same key from a different user is a different request.
    const other = await otherSession(app);
    const theirAccount = (await other.call("POST", "/api/accounts", bank("Theirs"))).json;
    const theirs = await app.call("POST", "/api/transactions", {
      cookie: other.cookie,
      body: { ...body, accountId: theirAccount.id },
      headers: { "Idempotency-Key": "retry-1" },
    });
    expect(theirs.status).toBe(201);
    expect(theirs.headers.get("Idempotent-Replayed")).toBeNull();
  });

  it("pages with limit and cursor", async () => {
    const { api, hdfc } = await withAccounts();
    for (let i = 1; i <= 5; i++) {
      await api("POST", "/api/transactions", { type: "expense", amountPaise: i * 100, txnDate: `2026-10-0${i}`, accountId: hdfc.id });
    }
    const page1 = (await api("GET", "/api/transactions?limit=2")).json;
    expect(page1.items.map((t: Json) => t.txnDate)).toEqual(["2026-10-05", "2026-10-04"]);
    const page2 = (await api("GET", `/api/transactions?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`)).json;
    expect(page2.items.map((t: Json) => t.txnDate)).toEqual(["2026-10-03", "2026-10-02"]);
    const page3 = (await api("GET", `/api/transactions?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`)).json;
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
    expect((await api("GET", "/api/transactions?cursor=junk")).status).toBe(422);
    expect((await api("GET", "/api/transactions?limit=500")).status).toBe(422);
  });

  it("filters by account, type, dates and text", async () => {
    const { api, hdfc, sbi } = await withAccounts();
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-01", accountId: hdfc.id, merchant: "Alpha" });
    await api("POST", "/api/transactions", { type: "income", amountPaise: 200, txnDate: "2026-10-10", accountId: sbi.id, merchant: "Beta" });
    expect((await api("GET", `/api/transactions?accountId=${sbi.id}`)).json.items).toHaveLength(1);
    expect((await api("GET", "/api/transactions?type=income")).json.items).toHaveLength(1);
    expect((await api("GET", "/api/transactions?from=2026-10-05&to=2026-10-31")).json.items).toHaveLength(1);
    expect((await api("GET", "/api/transactions?q=alp")).json.items).toHaveLength(1);
  });

  it("confirms drafts and 409s otherwise", async () => {
    const { api, hdfc } = await withAccounts();
    const draft = (await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: hdfc.id, status: "draft" })).json;
    expect((await api("POST", `/api/transactions/${draft.id}/confirm`)).json.status).toBe("confirmed");
    expect((await api("POST", `/api/transactions/${draft.id}/confirm`)).status).toBe(409);
  });

  it("another user gets 404 for everything of yours", async () => {
    const { app, api, hdfc } = await withAccounts();
    const mine = (await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: hdfc.id })).json;
    const other = await otherSession(app);
    expect((await other.call("GET", `/api/transactions/${mine.id}`)).status).toBe(404);
    expect((await other.call("PATCH", `/api/transactions/${mine.id}`, { amountPaise: 1 })).status).toBe(404);
    expect((await other.call("DELETE", `/api/transactions/${mine.id}`)).status).toBe(404);
    expect((await other.call("POST", `/api/transactions/${mine.id}/restore`)).status).toBe(404);
    expect((await other.call("GET", "/api/transactions")).json.items).toEqual([]);
    expect((await other.call("POST", "/api/transactions", { type: "expense", amountPaise: 1, txnDate: "2026-10-26", accountId: hdfc.id })).status).toBe(404);
    expect((await api("GET", `/api/transactions/${mine.id}`)).json.amountPaise).toBe(100);
  });
});

describe("categories", () => {
  it("lists seeded categories including the system Cashback income category", async () => {
    const { api } = await session();
    const items = (await api("GET", "/api/categories")).json.items as Json[];
    const cashback = items.find((c) => c.name === "Cashback");
    expect(cashback).toMatchObject({ kind: "income", isSystem: true, archived: false });
    expect(items.some((c) => c.name === "Groceries" && c.kind === "expense")).toBe(true);
  });

  it("creates, renames and archives custom categories; conflicts on duplicates", async () => {
    const { api } = await session();
    const created = await api("POST", "/api/categories", { name: "Pets", kind: "expense" });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: "Pets", isSystem: false, archived: false });
    expect((await api("POST", "/api/categories", { name: "Pets", kind: "expense" })).status).toBe(409);
    expect((await api("POST", "/api/categories", { name: "Pets", kind: "income" })).status).toBe(201);

    expect((await api("PATCH", `/api/categories/${created.json.id}`, { name: "Pet care" })).json.name).toBe("Pet care");
    expect((await api("PATCH", `/api/categories/${created.json.id}`, { name: "Groceries" })).status).toBe(409);
    expect((await api("PATCH", `/api/categories/${created.json.id}`, { archived: true })).json.archived).toBe(true);
    expect((await api("PATCH", `/api/categories/${created.json.id}`, { archived: false })).json.archived).toBe(false);
    expect((await api("PATCH", `/api/categories/${created.json.id}`, { bogus: 1 })).status).toBe(422);
    expect((await api("POST", "/api/categories", { name: "", kind: "expense" })).status).toBe(422);
  });

  it("the system category can be archived but not renamed", async () => {
    const { api } = await session();
    const cashback = ((await api("GET", "/api/categories")).json.items as Json[]).find((c) => c.name === "Cashback")!;
    expect((await api("PATCH", `/api/categories/${cashback.id}`, { name: "Rewards" })).status).toBe(409);
    expect((await api("PATCH", `/api/categories/${cashback.id}`, { archived: true })).json.archived).toBe(true);
  });

  it("archived categories cannot be used on new transactions; other users get 404", async () => {
    const { app, api } = await session();
    const bankAcc = (await api("POST", "/api/accounts", bank())).json;
    const cat = (await api("POST", "/api/categories", { name: "Hobby", kind: "expense" })).json;
    await api("PATCH", `/api/categories/${cat.id}`, { archived: true });
    const used = await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: bankAcc.id, categoryId: cat.id });
    expect(used.status).toBe(422);
    const other = await otherSession(app);
    expect((await other.call("PATCH", `/api/categories/${cat.id}`, { name: "Mine" })).status).toBe(404);
  });
});

describe("settings", () => {
  it("returns defaults, patches partially and validates", async () => {
    const { api } = await session();
    expect((await api("GET", "/api/settings")).json).toEqual({ nudgeLeadDays: 3, nudgeTimeIst: "10:00", sessionDays: 30, displayName: null });
    expect((await api("PATCH", "/api/settings", { nudgeLeadDays: 2 })).json).toEqual({ nudgeLeadDays: 2, nudgeTimeIst: "10:00", sessionDays: 30, displayName: null });
    expect((await api("GET", "/api/settings")).json.nudgeLeadDays).toBe(2);
    expect((await api("PATCH", "/api/settings", { nudgeLeadDays: 0 })).status).toBe(422);
    expect((await api("PATCH", "/api/settings", { nudgeLeadDays: 8 })).status).toBe(422);
    expect((await api("PATCH", "/api/settings", { nudgeTimeIst: "25:00" })).status).toBe(422);
    expect((await api("PATCH", "/api/settings", { sessionDays: 91 })).status).toBe(422);
    expect((await api("PATCH", "/api/settings", { surprise: true })).status).toBe(422);
  });

  it("stores a display name, trims it, can clear it, and /api/me reflects it", async () => {
    const { api } = await session();
    const before = (await api("GET", "/api/me")).json.displayName as string;
    expect(before).toMatch(/^[A-Z]/);
    expect((await api("PATCH", "/api/settings", { displayName: "  Kalind  " })).json.displayName).toBe("Kalind");
    expect((await api("GET", "/api/me")).json.displayName).toBe("Kalind");
    expect((await api("PATCH", "/api/settings", { displayName: "" })).status).toBe(422);
    expect((await api("PATCH", "/api/settings", { displayName: "x".repeat(41) })).status).toBe(422);
    expect((await api("PATCH", "/api/settings", { displayName: null })).json.displayName).toBeNull();
    expect((await api("GET", "/api/me")).json.displayName).toBe(before);
  });
});

describe("demo data", () => {
  it("loads demo accounts and transactions, then clears them in one action", async () => {
    const { api } = await session();
    const loaded = await api("POST", "/api/demo-data");
    expect(loaded.status).toBe(201);
    expect(loaded.json.created).toBe(13);

    const accounts = (await api("GET", "/api/accounts")).json.items as Json[];
    expect(accounts.map((a) => a.name).sort()).toEqual(["Demo Card", "Demo Savings", "Demo Salary Account"].sort());
    expect(((await api("GET", "/api/transactions?limit=200")).json.items as Json[]).every((t) => t.source === "seed")).toBe(true);

    expect((await api("POST", "/api/demo-data")).status).toBe(409);

    const cleared = await api("DELETE", "/api/demo-data");
    expect(cleared.json.deleted).toBe(13);
    expect((await api("GET", "/api/accounts?includeArchived=true")).json.items).toEqual([]);
    expect((await api("GET", "/api/transactions")).json.items).toEqual([]);
  });

  it("clearing also removes anything you added to demo accounts, and keeps your real data", async () => {
    const { api } = await session();
    const real = (await api("POST", "/api/accounts", bank("Real Bank"))).json;
    await api("POST", "/api/demo-data");
    const demoBank = ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.name === "Demo Savings")!;
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: demoBank.id });
    await api("DELETE", "/api/demo-data");
    const left = (await api("GET", "/api/accounts")).json.items as Json[];
    expect(left.map((a) => a.id)).toEqual([real.id]);
  });

  it("refuses to load demo data once real transactions exist", async () => {
    const { api } = await session();
    const real = (await api("POST", "/api/accounts", bank())).json;
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: real.id });
    expect((await api("POST", "/api/demo-data")).status).toBe(409);
  });

  it("demo data never touches another user", async () => {
    const { app, api } = await session();
    const other = await otherSession(app);
    await other.call("POST", "/api/demo-data");
    await api("POST", "/api/demo-data");
    await api("DELETE", "/api/demo-data");
    expect(((await other.call("GET", "/api/accounts")).json.items as Json[]).length).toBe(3);
  });
});
