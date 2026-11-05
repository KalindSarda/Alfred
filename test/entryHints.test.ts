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
  const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
  const sbi = (await api("POST", "/api/accounts", { kind: "bank", name: "SBI", openingBalancePaise: 1_00_000_00 })).json;
  const cats = (await api("GET", "/api/categories")).json.items as Json[];
  const category = (name: string) => cats.find((c) => c.name === name)!.id as string;
  const spend = (accountId: string, merchant: string | null, categoryId: string | null, extra: object = {}) =>
    api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-10-20", accountId, merchant, categoryId, ...extra });
  const hints = async () => (await api("GET", "/api/entry-hints")).json as Json;
  return { app, api, hdfc, sbi, category, spend, hints };
}

describe("entry hints", () => {
  it("is empty for a person with no entries", async () => {
    const s = await setup();
    expect(await s.hints()).toEqual({ merchants: [], lastUsedAccountIds: [] });
  });

  it("remembers each merchant's latest category and account, newest first, once", async () => {
    const s = await setup();
    await s.spend(s.hdfc.id, "Swiggy", s.category("Food & Dining"));
    await s.spend(s.sbi.id, "Amazon", s.category("Shopping"));
    await s.spend(s.sbi.id, "swiggy", s.category("Groceries"));
    const h = await s.hints();
    expect(h.merchants.map((m: Json) => m.merchant)).toEqual(["swiggy", "Amazon"]);
    expect(h.merchants[0]).toMatchObject({ categoryId: s.category("Groceries"), accountId: s.sbi.id, count: 2 });
    expect(h.merchants[1]).toMatchObject({ categoryId: s.category("Shopping"), accountId: s.sbi.id, count: 1 });
  });

  it("orders accounts by how lately they were used", async () => {
    const s = await setup();
    await s.spend(s.hdfc.id, "A", null);
    await s.spend(s.sbi.id, "B", null);
    expect((await s.hints()).lastUsedAccountIds).toEqual([s.sbi.id, s.hdfc.id]);
    await s.spend(s.hdfc.id, "C", null);
    expect((await s.hints()).lastUsedAccountIds).toEqual([s.hdfc.id, s.sbi.id]);
  });

  it("ignores deleted entries, entries with no merchant, and movements between accounts", async () => {
    const s = await setup();
    const gone = (await s.spend(s.hdfc.id, "Ghost", null)).json;
    await s.api("DELETE", `/api/transactions/${gone.id}`);
    await s.spend(s.hdfc.id, null, null);
    await s.api("POST", "/api/transactions", { type: "transfer", amountPaise: 500_00, txnDate: "2026-10-20", accountId: s.hdfc.id, toAccountId: s.sbi.id, merchant: "Self" });
    expect((await s.hints()).merchants).toEqual([]);
  });

  it("leaves out the instalments Alfred adds for an EMI plan", async () => {
    const s = await setup();
    const card = (await s.api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 })).json;
    await s.api("POST", "/api/emi-plans", { cardAccountId: card.id, title: "Phone", totalPaise: 60_000_00, months: 6, startMonth: "2026-10" });
    await s.spend(s.hdfc.id, "Swiggy", null);
    expect((await s.hints()).merchants.map((m: Json) => m.merchant)).toEqual(["Swiggy"]);
  });

  it("includes income merchants", async () => {
    const s = await setup();
    await s.api("POST", "/api/transactions", { type: "income", amountPaise: 90_000_00, txnDate: "2026-10-20", accountId: s.hdfc.id, merchant: "Employer", categoryId: s.category("Salary") });
    expect((await s.hints()).merchants[0]).toMatchObject({ merchant: "Employer", categoryId: s.category("Salary") });
  });

  it("keeps at most 100 merchants", async () => {
    const s = await setup();
    for (let i = 0; i < 105; i++) await s.spend(s.hdfc.id, `Shop ${i}`, null, { txnDate: "2026-10-01" });
    expect((await s.hints()).merchants).toHaveLength(100);
  });

  it("is private to the signed-in person, and needs a session", async () => {
    const a = await setup();
    const b = await setup();
    await a.spend(a.hdfc.id, "Secret Shop", null);
    expect((await b.hints()).merchants).toEqual([]);
    expect((await a.app.call("GET", "/api/entry-hints", {})).status).toBe(401);
  });
});
