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
  const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC Bank", openingBalancePaise: 100_000_00 })).json;
  const sbi = (await api("POST", "/api/accounts", { kind: "bank", name: "SBI Salary", openingBalancePaise: 0 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Millennia Card", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const cats = ((await api("GET", "/api/categories")).json.items as Json[]);
  const id = (name: string) => cats.find((c) => c.name === name)!.id as string;
  const add = (body: object) => api("POST", "/api/transactions", body);

  await add({ type: "expense", amountPaise: 450_00, txnDate: "2026-10-01", accountId: hdfc.id, categoryId: id("Food & Dining"), merchant: "Swiggy" });
  await add({ type: "expense", amountPaise: 2_500_00, txnDate: "2026-10-05", accountId: card.id, categoryId: id("Shopping"), merchant: "Amazon" });
  await add({ type: "expense", amountPaise: 12_000_00, txnDate: "2026-10-10", accountId: hdfc.id, categoryId: id("Rent"), note: "October rent" });
  await add({ type: "expense", amountPaise: 800_00, txnDate: "2026-10-12", accountId: hdfc.id, merchant: "Unknown shop" });
  await add({ type: "income", amountPaise: 90_000_00, txnDate: "2026-10-15", accountId: sbi.id, categoryId: id("Salary") });
  await add({ type: "expense", amountPaise: 300_00, txnDate: "2026-10-20", accountId: hdfc.id, status: "draft", merchant: "Cafe" });
  await add({ type: "bill_payment", amountPaise: 2_500_00, txnDate: "2026-10-21", accountId: hdfc.id, toAccountId: card.id });
  await add({ type: "transfer", amountPaise: 5_000_00, txnDate: "2026-10-22", accountId: hdfc.id, toAccountId: sbi.id });
  return { api, id, hdfc, sbi, card };
}

const merchants = (items: Json[]) => items.map((t) => t.merchant ?? t.note ?? t.type);

describe("transaction filters", () => {
  it("filters by amount range in paise", async () => {
    const { api } = await setup();
    const big = (await api("GET", "/api/transactions?minAmountPaise=1000000")).json.items as Json[];
    expect(big.every((t) => t.amountPaise >= 1_000_000)).toBe(true);
    expect(big).toHaveLength(2);
    const small = (await api("GET", "/api/transactions?maxAmountPaise=50000")).json.items as Json[];
    expect(merchants(small).sort()).toEqual(["Cafe", "Swiggy"].sort());
    const band = (await api("GET", "/api/transactions?minAmountPaise=50000&maxAmountPaise=300000")).json.items as Json[];
    expect(merchants(band).sort()).toEqual(["Amazon", "Unknown shop", "bill_payment"].sort());
  });

  it("rejects an inverted or invalid amount range", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/transactions?minAmountPaise=500&maxAmountPaise=100")).status).toBe(422);
    expect((await api("GET", "/api/transactions?minAmountPaise=-5")).status).toBe(422);
    expect((await api("GET", "/api/transactions?minAmountPaise=abc")).status).toBe(422);
  });

  it("filters by several categories at once and by uncategorized", async () => {
    const { api, id } = await setup();
    const two = (await api("GET", `/api/transactions?categoryId=${id("Food & Dining")},${id("Rent")}`)).json.items as Json[];
    expect(merchants(two).sort()).toEqual(["October rent", "Swiggy"].sort());
    const none = (await api("GET", "/api/transactions?categoryId=none")).json.items as Json[];
    expect(merchants(none).sort()).toEqual(["Cafe", "Unknown shop"].sort());
    const mixed = (await api("GET", `/api/transactions?categoryId=none,${id("Rent")}`)).json.items as Json[];
    expect(mixed).toHaveLength(3);
  });

  it("uncategorized never includes transfers or bill payments", async () => {
    const { api } = await setup();
    const none = (await api("GET", "/api/transactions?categoryId=none")).json.items as Json[];
    expect(none.some((t) => t.type === "transfer" || t.type === "bill_payment")).toBe(false);
  });

  it("search matches merchant, note, category name and account name", async () => {
    const { api } = await setup();
    const find = async (q: string) => merchants((await api("GET", `/api/transactions?q=${encodeURIComponent(q)}`)).json.items);
    expect(await find("swig")).toEqual(["Swiggy"]);
    expect(await find("october")).toEqual(["October rent"]);
    expect((await find("dining")).sort()).toEqual(["Swiggy"]);
    expect((await find("shopping")).sort()).toEqual(["Amazon"]);
    // account names: HDFC Bank is involved in many entries, SBI Salary in the salary and the transfer
    expect((await find("sbi")).sort()).toEqual(["income", "transfer"].sort());
    expect((await find("millennia")).sort()).toEqual(["Amazon", "bill_payment"].sort());
  });

  it("search treats percent and underscore literally in every field", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/transactions?q=%25")).json.items).toHaveLength(0);
    expect((await api("GET", "/api/transactions?q=_")).json.items).toHaveLength(0);
  });

  it("combines filters", async () => {
    const { api, hdfc } = await setup();
    const res = (await api("GET", `/api/transactions?accountId=${hdfc.id}&type=expense&from=2026-10-05&to=2026-10-12&minAmountPaise=100000`)).json.items as Json[];
    expect(merchants(res)).toEqual(["October rent"]);
  });
});

describe("totals", () => {
  it("counts everything matched but sums only confirmed income and expense", async () => {
    const { api } = await setup();
    const all = (await api("GET", "/api/transactions")).json.totals;
    expect(all.count).toBe(8);
    expect(all.incomePaise).toBe(90_000_00);
    // confirmed expenses: 450 + 2,500 + 12,000 + 800 (the 300 draft is excluded)
    expect(all.expensePaise).toBe(15_750_00);
  });

  it("totals follow the filters and ignore paging", async () => {
    const { api, id } = await setup();
    const page = (await api("GET", `/api/transactions?limit=1&categoryId=${id("Food & Dining")},${id("Rent")}`)).json;
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(page.totals).toEqual({ count: 2, incomePaise: 0, expensePaise: 12_450_00 });
  });

  it("totals are empty for no matches", async () => {
    const { api } = await setup();
    expect((await api("GET", "/api/transactions?q=zzzz")).json.totals).toEqual({ count: 0, incomePaise: 0, expensePaise: 0 });
  });
});

describe("review counts", () => {
  it("summary and the review endpoint report uncategorized and drafts separately", async () => {
    const { api } = await setup();
    const review = (await api("GET", "/api/dashboard/review")).json;
    expect(review).toEqual({ uncategorizedCount: 2, draftCount: 1 });
    const summary = (await api("GET", "/api/dashboard/summary")).json;
    expect(summary).toMatchObject({ uncategorizedCount: 2, draftCount: 1 });
  });

  it("the counts match what the filtered lists return", async () => {
    const { api } = await setup();
    const review = (await api("GET", "/api/dashboard/review")).json;
    expect((await api("GET", "/api/transactions?categoryId=none")).json.totals.count).toBe(review.uncategorizedCount);
    expect((await api("GET", "/api/transactions?status=draft")).json.totals.count).toBe(review.draftCount);
  });

  it("confirming a draft and categorizing an entry clears the counts", async () => {
    const { api, id } = await setup();
    const draft = ((await api("GET", "/api/transactions?status=draft")).json.items as Json[])[0]!;
    await api("POST", `/api/transactions/${draft.id}/confirm`);
    const unknown = ((await api("GET", "/api/transactions?q=unknown")).json.items as Json[])[0]!;
    await api("PATCH", `/api/transactions/${unknown.id}`, { categoryId: id("Shopping") });
    // the confirmed draft ("Cafe") is still uncategorized
    expect((await api("GET", "/api/dashboard/review")).json).toEqual({ uncategorizedCount: 1, draftCount: 0 });
  });

  it("requires a session", async () => {
    expect((await makeApp().call("GET", "/api/dashboard/review")).status).toBe(401);
  });
});
