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
  const line = async () => ((await api("GET", "/api/alfred/briefing")).json.lines as Json[]).find((l) => l.key === "debts");
  return { api, bank, line };
}

describe("the briefing and overdue loans", () => {
  it("says nothing while nothing is overdue", async () => {
    const s = await setup();
    await s.api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, date: "2026-10-01", dueDate: "2026-11-10", accountId: s.bank.id });
    expect(await s.line()).toBeUndefined();
  });

  it("mentions money lent that is past its date, linking to Lent and borrowed", async () => {
    const s = await setup();
    await s.api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, date: "2026-10-01", dueDate: "2026-10-10", accountId: s.bank.id });
    const line = (await s.line())!;
    expect(line.text).toBe("Rahul still owes you ₹5,000, which was due 10 Oct.");
    expect(line.to).toBe("/accounts?view=commitments#lent");
  });

  it("names the oldest, counts the others, and covers money you owe", async () => {
    const s = await setup();
    await s.api("POST", "/api/debts", { name: "Asha", direction: "borrowed", amountPaise: 8_000_00, date: "2026-09-01", dueDate: "2026-09-20", accountId: s.bank.id });
    await s.api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, date: "2026-10-01", dueDate: "2026-10-10", accountId: s.bank.id });
    expect((await s.line())!.text).toBe("You owe Asha ₹8,000, which was due 20 Sep. 1 more loan is overdue too.");
  });

  it("stops once it is paid", async () => {
    const s = await setup();
    const person = (await s.api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, date: "2026-10-01", dueDate: "2026-10-10", accountId: s.bank.id })).json;
    await s.api("POST", `/api/debts/${person.debts[0].id}/settle`, {});
    expect(await s.line()).toBeUndefined();
  });
});
