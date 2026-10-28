import { describe, expect, it } from "vitest";
import { csvCell } from "../src/services/exportData";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const call = (method: string, path: string, body?: unknown) =>
    app.call(method, path, { cookie, ...(body !== undefined && { body }) });
  const json = async (method: string, path: string, body?: unknown) => (await call(method, path, body)).json() as Promise<Json>;
  const bank = await json("POST", "/api/accounts", { kind: "bank", name: "HDFC, Savings", openingBalancePaise: 1_00_000_00 });
  const card = await json("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 });
  const cats = ((await json("GET", "/api/categories")).items as Json[]);
  const id = (name: string) => cats.find((c) => c.name === name && c.kind === "expense")!.id as string;
  const post = (body: object) => json("POST", "/api/transactions", { amountPaise: 100_00, txnDate: "2026-10-05", accountId: bank.id, ...body });
  return { app, call, json, bank, card, id, post };
}

describe("csvCell", () => {
  it("leaves plain text alone and blanks null", () => {
    expect(csvCell("Swiggy")).toBe("Swiggy");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(450)).toBe("450");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("defuses spreadsheet formulas", () => {
    for (const bad of ["=SUM(A1)", "+91 98", "-5", "@cmd", "\tx"]) {
      expect(csvCell(bad).startsWith("'") || csvCell(bad).startsWith(`"'`), bad).toBe(true);
    }
  });
});

describe("GET /api/export/csv", () => {
  it("has a header and one row per live entry, with account and category names", async () => {
    const { call, post, id, bank, card } = await setup();
    await post({ type: "expense", amountPaise: 1_234_50, categoryId: id("Food & Dining"), merchant: "Swiggy", note: "dinner, late" });
    await post({ type: "bill_payment", amountPaise: 500_00, toAccountId: card.id });
    const gone = await post({ type: "expense", amountPaise: 9_00, categoryId: id("Fuel") });
    await call("DELETE", `/api/transactions/${gone.id}`);
    const res = await call("GET", "/api/export/csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="alfred-transactions-2026-10-27.csv"');
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("date,type,amount_rupees,account,to_account,category,merchant,note,status");
    expect(lines).toHaveLength(3);
    expect(lines).toContain('2026-10-05,expense,1234.50,"HDFC, Savings",,Food & Dining,Swiggy,"dinner, late",confirmed');
    expect(lines).toContain('2026-10-05,bill_payment,500,"HDFC, Savings",Card,,,,confirmed');
    expect(bank.name).toBe("HDFC, Savings");
  });

  it("defuses a merchant that looks like a formula", async () => {
    const { call, post } = await setup();
    await post({ type: "expense", merchant: "=HYPERLINK(\"x\")" });
    const text = await (await call("GET", "/api/export/csv")).text();
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("is just the header for a new ledger", async () => {
    const { call } = await setup();
    expect((await (await call("GET", "/api/export/csv")).text())).toBe("date,type,amount_rupees,account,to_account,category,merchant,note,status\r\n");
  });
});

describe("GET /api/export/json", () => {
  it("returns the user's whole ledger, including deleted entries, with no user ids", async () => {
    const { call, post, id } = await setup();
    await post({ type: "expense", categoryId: id("Food & Dining") });
    const gone = await post({ type: "expense", categoryId: id("Fuel") });
    await call("DELETE", `/api/transactions/${gone.id}`);
    await call("PUT", `/api/budgets/${id("Food & Dining")}`, { limitPaise: 6_000_00 });
    const res = await call("GET", "/api/export/json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="alfred-export-2026-10-27.json"');
    const body = (await res.json()) as Json;
    expect(body.version).toBe(1);
    expect(body.exportedAt).toBe("2026-10-27T10:00:00.000Z");
    expect(body.accounts).toHaveLength(2);
    expect(body.transactions).toHaveLength(2);
    expect(body.transactions.filter((t: Json) => t.deletedAt)).toHaveLength(1);
    expect(body.budgets).toHaveLength(1);
    expect(body.settings.periodStartDay).toBe(1);
    expect(JSON.stringify(body)).not.toContain("userId");
  });

  it("never includes another user's data", async () => {
    const a = await setup();
    const b = await setup();
    await a.post({ type: "expense", merchant: "OnlyA" });
    const body = (await (await b.call("GET", "/api/export/json")).json()) as Json;
    expect(body.transactions).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("OnlyA");
  });

  it("requires a session", async () => {
    const anon = makeApp();
    expect((await anon.call("GET", "/api/export/json")).status).toBe(401);
    expect((await anon.call("GET", "/api/export/csv")).status).toBe(401);
  });

  it("allows ten exports an hour, then asks to wait", async () => {
    const { call } = await setup();
    for (let i = 0; i < 10; i++) expect((await call("GET", "/api/export/csv")).status).toBe(200);
    const res = await call("GET", "/api/export/json");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });
});
