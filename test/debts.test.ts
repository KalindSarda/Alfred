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
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const lend = (extra: object = {}) => api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, accountId: bank.id, ...extra });
  const borrow = (extra: object = {}) => api("POST", "/api/debts", { name: "Asha", direction: "borrowed", amountPaise: 8_000_00, accountId: bank.id, ...extra });
  const figures = async () => {
    const res = (await api("GET", "/api/accounts")).json;
    return { balance: (res.items as Json[]).find((a) => a.id === bank.id)!.balancePaise as number, overview: res.overview as Json };
  };
  const entries = async (type?: string) => ((await api("GET", `/api/transactions?limit=100${type ? `&type=${type}` : ""}`)).json.items as Json[]);
  const debtOf = (person: Json) => (person.debts as Json[])[0]!;
  return { app, user, api, bank, card, lend, borrow, figures, entries, debtOf };
}

describe("lending", () => {
  it("through a bank account lowers the balance as a debt_out entry, and is not spending", async () => {
    const s = await setup();
    const before = await s.figures();
    const res = await s.lend({ dueDate: "2026-11-10", note: "for the deposit" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Rahul", trusted: false, owedToYouPaise: 5_000_00, youOwePaise: 0 });
    expect(s.debtOf(res.json)).toMatchObject({ direction: "lent", amountPaise: 5_000_00, outstandingPaise: 5_000_00, dueDate: "2026-11-10", note: "for the deposit", accountName: "HDFC", status: "open", overdue: false });

    const after = await s.figures();
    expect(after.balance).toBe(before.balance - 5_000_00);
    const [entry] = await s.entries("debt_out");
    expect(entry).toMatchObject({ type: "debt_out", amountPaise: 5_000_00, accountId: s.bank.id, merchant: "Rahul", categoryId: null, toAccountId: null, source: "web" });
    const summary = (await s.api("GET", "/api/dashboard/summary?period=cycle")).json;
    expect(summary).toMatchObject({ expensePaise: 0, incomePaise: 0, uncategorizedCount: 0 });
    // The money is still yours, in the form of what Rahul owes: net worth is unchanged, safe-to-spend is lower.
    expect(after.overview.netWorthPaise).toBe(before.overview.netWorthPaise);
    expect(after.overview.owedToYouPaise).toBe(5_000_00);
    expect(after.overview.safeToSpendPaise).toBe(before.overview.safeToSpendPaise - 5_000_00);
  });

  it("with cash or untracked records only the debt", async () => {
    const s = await setup();
    const before = await s.figures();
    const res = await s.lend({ accountId: null });
    expect(s.debtOf(res.json)).toMatchObject({ accountName: null, outstandingPaise: 5_000_00 });
    const after = await s.figures();
    expect(after.balance).toBe(before.balance);
    expect(await s.entries("debt_out")).toHaveLength(0);
    expect(after.overview.owedToYouPaise).toBe(5_000_00);
  });

  it("a name seen before is the same person, whatever its case or spacing", async () => {
    const s = await setup();
    await s.lend({ name: "Rahul" });
    await s.lend({ name: "  rahul  ", amountPaise: 1_000_00 });
    const res = (await s.api("GET", "/api/debts")).json;
    expect(res.people).toHaveLength(1);
    expect(res.people[0]).toMatchObject({ name: "Rahul", owedToYouPaise: 6_000_00 });
    expect(res.people[0].debts).toHaveLength(2);
  });

  it("validates what it is given", async () => {
    const s = await setup();
    expect((await s.lend({ amountPaise: 0 })).status).toBe(422);
    expect((await s.lend({ amountPaise: 1.5 })).status).toBe(422);
    expect((await s.lend({ name: "  " })).status).toBe(422);
    expect((await s.lend({ name: "x".repeat(41) })).status).toBe(422);
    expect((await s.lend({ direction: "gave" })).status).toBe(422);
    expect((await s.lend({ extra: 1 })).status).toBe(422);
    expect((await s.lend({ date: "2026-02-30" })).status).toBe(422);
    expect((await s.lend({ date: "2026-12-01" })).status).toBe(422);
    expect((await s.lend({ date: "2026-10-20", dueDate: "2026-10-10" })).status).toBe(422);
    expect((await s.lend({ accountId: s.card.id })).status).toBe(422);
    expect((await s.lend({ accountId: "nope" })).status).toBe(404);
    await s.api("POST", `/api/accounts/${s.bank.id}/archive`);
    expect((await s.lend()).status).toBe(422);
    expect((await makeApp().call("GET", "/api/debts")).status).toBe(401);
  });
});

describe("borrowing", () => {
  it("through a bank account raises the balance as a debt_in entry and shows what you owe", async () => {
    const s = await setup();
    const before = await s.figures();
    const res = await s.borrow();
    expect(res.json).toMatchObject({ name: "Asha", youOwePaise: 8_000_00, owedToYouPaise: 0 });
    const after = await s.figures();
    expect(after.balance).toBe(before.balance + 8_000_00);
    expect((await s.entries("debt_in"))[0]).toMatchObject({ type: "debt_in", amountPaise: 8_000_00, merchant: "Asha" });
    expect(after.overview.youOwePaise).toBe(8_000_00);
    expect(after.overview.netWorthPaise).toBe(before.overview.netWorthPaise);
    expect((await s.api("GET", "/api/dashboard/summary?period=cycle")).json).toMatchObject({ incomePaise: 0, expensePaise: 0 });
  });
});

describe("repayments", () => {
  it("money lent and part-repaid into an account comes back as a debt_in entry", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    const before = await s.figures();
    const res = await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 2_000_00, accountId: s.bank.id, date: "2026-10-26", note: "UPI" });
    expect(res.status).toBe(201);
    expect(s.debtOf(res.json)).toMatchObject({ paidPaise: 2_000_00, outstandingPaise: 3_000_00, status: "open" });
    expect(s.debtOf(res.json).payments).toEqual([expect.objectContaining({ amountPaise: 2_000_00, date: "2026-10-26", accountName: "HDFC", note: "UPI" })]);
    const after = await s.figures();
    expect(after.balance).toBe(before.balance + 2_000_00);
    expect(after.overview.owedToYouPaise).toBe(3_000_00);
    expect(after.overview.netWorthPaise).toBe(before.overview.netWorthPaise);
    expect((await s.entries("debt_in"))[0]).toMatchObject({ amountPaise: 2_000_00, txnDate: "2026-10-26" });
  });

  it("paying the last of it settles the debt in the same step", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 2_000_00 });
    const res = await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 3_000_00 });
    expect(s.debtOf(res.json)).toMatchObject({ status: "settled", outstandingPaise: 0, paidPaise: 5_000_00 });
    expect((await s.api("GET", "/api/debts")).json.people).toEqual([]);
    expect(((await s.api("GET", "/api/debts?status=all")).json.people as Json[])[0]!.debts[0].status).toBe("settled");
    expect((await s.figures()).overview.owedToYouPaise).toBe(0);
    expect((await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 1 })).status).toBe(409);
  });

  it("refuses more than is owed, a card, an archived account and a future date", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    const pay = (extra: object) => s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 100_00, ...extra });
    expect((await pay({ amountPaise: 5_000_01 })).status).toBe(422);
    expect((await pay({ accountId: s.card.id })).status).toBe(422);
    expect((await pay({ date: "2026-12-01" })).status).toBe(422);
    expect((await pay({ extra: 1 })).status).toBe(422);
    expect((await pay({ accountId: "nope" })).status).toBe(404);
    expect(s.debtOf((await s.api("GET", "/api/debts")).json.people[0]).paidPaise).toBe(0);
  });

  it("repaying money you borrowed goes out of the account as a debt_out entry", async () => {
    const s = await setup();
    const d = s.debtOf((await s.borrow()).json);
    const before = await s.figures();
    await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 3_000_00, accountId: s.bank.id });
    const after = await s.figures();
    expect(after.balance).toBe(before.balance - 3_000_00);
    expect(after.overview.youOwePaise).toBe(5_000_00);
    expect((await s.entries("debt_out"))[0]).toMatchObject({ amountPaise: 3_000_00, merchant: "Asha" });
  });

  it("settling in full records whatever is left, through an account if one is given", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 1_000_00 });
    const before = await s.figures();
    const res = await s.api("POST", `/api/debts/${d.id}/settle`, { accountId: s.bank.id });
    expect(s.debtOf(res.json)).toMatchObject({ status: "settled", paidPaise: 5_000_00 });
    expect((await s.figures()).balance).toBe(before.balance + 4_000_00);
    expect((await s.api("POST", `/api/debts/${d.id}/settle`, {})).status).toBe(409);
  });

  it("taking back a repayment removes its bank entry and opens the debt again", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    const paid = s.debtOf((await s.api("POST", `/api/debts/${d.id}/settle`, { accountId: s.bank.id })).json);
    const before = await s.figures();
    const res = await s.api("DELETE", `/api/debts/${d.id}/payments/${paid.payments[0].id}`);
    expect(s.debtOf(res.json)).toMatchObject({ status: "open", paidPaise: 0, outstandingPaise: 5_000_00 });
    expect((await s.figures()).balance).toBe(before.balance - 5_000_00);
    expect(await s.entries("debt_in")).toHaveLength(0);
    expect((await s.api("DELETE", `/api/debts/${d.id}/payments/nope`)).status).toBe(404);
  });
});

describe("writing off, editing and removing", () => {
  it("forgiving closes the debt without moving money, and it stops counting", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    const before = await s.figures();
    const res = await s.api("POST", `/api/debts/${d.id}/forgive`);
    expect(s.debtOf(res.json)).toMatchObject({ status: "settled", forgiven: true, outstandingPaise: 0 });
    const after = await s.figures();
    expect(after.balance).toBe(before.balance);
    expect(after.overview.owedToYouPaise).toBe(0);
    expect(after.overview.netWorthPaise).toBe(before.overview.netWorthPaise - 5_000_00);
    expect((await s.api("POST", `/api/debts/${d.id}/forgive`)).status).toBe(409);
  });

  it("deleting a loan recorded by mistake removes its entries and puts the balance back", async () => {
    const s = await setup();
    const start = await s.figures();
    const d = s.debtOf((await s.lend()).json);
    await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 1_000_00, accountId: s.bank.id });
    expect((await s.api("DELETE", `/api/debts/${d.id}`)).status).toBe(204);
    const after = await s.figures();
    expect(after.balance).toBe(start.balance);
    expect(after.overview.owedToYouPaise).toBe(0);
    expect(await s.entries()).toHaveLength(0);
    expect((await s.api("GET", "/api/debts?status=all")).json.people).toEqual([]);
  });

  it("changes the due date and note, and the follow-up switch", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    const res = await s.api("PATCH", `/api/debts/${d.id}`, { dueDate: "2026-12-01", note: "new plan", followUpStopped: true });
    expect(s.debtOf(res.json)).toMatchObject({ dueDate: "2026-12-01", note: "new plan", followUpStopped: true, nextFollowUp: null });
    const back = await s.api("PATCH", `/api/debts/${d.id}`, { followUpStopped: false });
    expect(s.debtOf(back.json)).toMatchObject({ nextFollowUp: "2026-12-01" });
    expect((await s.api("PATCH", `/api/debts/${d.id}`, { dueDate: "2026-01-01" })).status).toBe(422);
    expect((await s.api("PATCH", `/api/debts/${d.id}`, { extra: 1 })).status).toBe(422);
  });

  it("an overdue loan says so", async () => {
    const s = await setup();
    const res = await s.lend({ date: "2026-09-01", dueDate: "2026-10-01" });
    expect(s.debtOf(res.json)).toMatchObject({ overdue: true });
  });
});

describe("trusted people and following up", () => {
  it("shows when Alfred will next ask, for someone not trusted", async () => {
    const s = await setup();
    const dated = s.debtOf((await s.lend({ dueDate: "2026-11-10" })).json);
    const undated = s.debtOf((await s.lend({ name: "Meera", date: "2026-10-01" })).json);
    expect(dated.nextFollowUp).toBe("2026-11-10");
    expect(undated.nextFollowUp).toBe("2026-10-31");
    expect(s.debtOf((await s.borrow()).json).nextFollowUp).toBeNull();
  });

  it("a trusted person is never followed up with, and can be changed back", async () => {
    const s = await setup();
    const p = (await s.lend({ dueDate: "2026-11-10" })).json;
    const res = await s.api("PATCH", `/api/contacts/${p.contactId}`, { trusted: true });
    expect(res.status).toBe(200);
    expect(res.json.people[0]).toMatchObject({ trusted: true });
    expect(s.debtOf(res.json.people[0]).nextFollowUp).toBeNull();
    const back = await s.api("PATCH", `/api/contacts/${p.contactId}`, { trusted: false });
    expect(s.debtOf(back.json.people[0]).nextFollowUp).toBe("2026-11-10");
    expect((await s.api("PATCH", `/api/contacts/${p.contactId}`, { trusted: "yes" })).status).toBe(422);
    expect((await s.api("PATCH", "/api/contacts/nope", { trusted: true })).status).toBe(404);
  });
});

describe("the entries they make", () => {
  it("cannot be created, changed or deleted from the transactions API", async () => {
    const s = await setup();
    await s.lend();
    const [entry] = await s.entries("debt_out");
    expect((await s.api("POST", "/api/transactions", { type: "debt_out", amountPaise: 100, txnDate: "2026-10-01", accountId: s.bank.id })).status).toBe(422);
    const patch = await s.api("PATCH", `/api/transactions/${entry!.id}`, { amountPaise: 1 });
    expect(patch.status).toBe(409);
    expect(patch.json.error.message).toContain("lent and borrowed");
    expect((await s.api("DELETE", `/api/transactions/${entry!.id}`)).status).toBe(409);
    const plain = (await s.api("POST", "/api/transactions", { type: "expense", amountPaise: 100, txnDate: "2026-10-01", accountId: s.bank.id })).json;
    expect((await s.api("PATCH", `/api/transactions/${plain.id}`, { type: "debt_in" })).status).toBe(409);
  });

  it("never count as income, expense or a needed category", async () => {
    const s = await setup();
    await s.lend();
    await s.borrow();
    expect((await s.api("GET", "/api/dashboard/cashflow?period=cycle")).json).toMatchObject({ incomePaise: 0, expensePaise: 0 });
    expect((await s.api("GET", "/api/dashboard/review")).json.uncategorizedCount).toBe(0);
    expect((await s.api("GET", "/api/transactions")).json.totals).toMatchObject({ incomePaise: 0, expensePaise: 0 });
  });
});

describe("loans and the rest of the app", () => {
  it("an account that took part in a loan cannot be deleted while its entries exist", async () => {
    const s = await setup();
    await s.lend();
    expect((await s.api("DELETE", `/api/accounts/${s.bank.id}`)).status).toBe(409);
  });

  it("merging accounts carries the loans' accounts to the target", async () => {
    const s = await setup();
    const other = (await s.api("POST", "/api/accounts", { kind: "bank", name: "Old", openingBalancePaise: 0 })).json;
    const d = s.debtOf((await s.lend({ accountId: other.id })).json);
    expect((await s.api("POST", `/api/accounts/${other.id}/merge`, { intoId: s.bank.id })).status).toBe(200);
    const res = (await s.api("GET", "/api/debts")).json;
    expect(res.people[0].debts.find((x: Json) => x.id === d.id)).toMatchObject({ accountName: "HDFC" });
  });

  it("the JSON export includes people, loans and repayments, without user ids", async () => {
    const s = await setup();
    const d = s.debtOf((await s.lend()).json);
    await s.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 1_000_00 });
    const body = (await s.api("GET", "/api/export/json")).json;
    expect(body.contacts).toHaveLength(1);
    expect(body.debts).toHaveLength(1);
    expect(body.debtPayments).toHaveLength(1);
    expect(JSON.stringify([body.contacts, body.debts, body.debtPayments])).not.toContain("userId");
  });

  it("never touches another person's loans, people or accounts", async () => {
    const a = await setup();
    const b = await setup();
    const p = (await a.lend()).json;
    const d = a.debtOf(p);
    for (const call of [
      b.api("PATCH", `/api/debts/${d.id}`, { note: "x" }),
      b.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 100 }),
      b.api("POST", `/api/debts/${d.id}/settle`, {}),
      b.api("POST", `/api/debts/${d.id}/forgive`),
      b.api("DELETE", `/api/debts/${d.id}`),
      b.api("PATCH", `/api/contacts/${p.contactId}`, { trusted: true }),
    ]) {
      expect((await call).status).toBe(404);
    }
    expect((await b.lend({ accountId: a.bank.id })).status).toBe(404);
    expect((await b.api("GET", "/api/debts")).json.people).toEqual([]);
    expect(((await a.api("GET", "/api/debts")).json.people as Json[])).toHaveLength(1);
  });
});
