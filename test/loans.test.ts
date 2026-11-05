import { describe, expect, it } from "vitest";
import { levelEmi, monthsToClear, nextInstalment } from "../src/domain/loans";
import { materializeLoansFor } from "../src/services/loans";
import { login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST).
const P = 10_00_000_00; // outstanding: 10 lakh
const BP = 900; // 9% a year
const MONTHS = 120;
const EMI = levelEmi(P, BP, MONTHS);

async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 50_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const make = (extra: object = {}) =>
    api("POST", "/api/loans", { name: "Home loan", lender: "SBI", kind: "home", accountId: bank.id, principalPaise: P, ratePct: 9, months: MONTHS, dueDay: 5, ...extra });
  const balance = async () => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === bank.id)!.balancePaise as number;
  const overview = async () => (await api("GET", "/api/accounts")).json.overview as Json;
  const loanEntries = async () => ((await api("GET", "/api/transactions?limit=200")).json.items as Json[]).filter((t) => t.source === "loan");
  return { app, user, api, bank, card, make, balance, overview, loanEntries };
}

describe("adding a loan", () => {
  it("works out the EMI from the months left, and adds nothing until the first due date", async () => {
    const s = await setup();
    const res = await s.make();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ name: "Home loan", lender: "SBI", kind: "home", accountName: "HDFC", ratePct: 9, emiPaise: EMI, outstandingPaise: P, status: "active", nextDueDate: "2026-11-05", monthsLeft: MONTHS, repaidPaise: 0 });
    expect(res.json.nextInstalment).toEqual({ interestPaise: 7_500_00, principalPaise: EMI - 7_500_00, totalPaise: EMI });
    expect(await s.loanEntries()).toHaveLength(0);
    expect((await s.api("GET", "/api/loans")).json).toMatchObject({ totalOutstandingPaise: P, monthlyEmiPaise: EMI });
  });

  it("takes the EMI as typed, and refuses one that can never clear the loan", async () => {
    const s = await setup();
    expect((await s.make({ months: undefined, emiPaise: 15_000_00 })).json.emiPaise).toBe(15_000_00);
    expect((await s.make({ months: undefined, emiPaise: 7_000_00 })).status).toBe(422);
    expect((await s.make({ months: undefined })).status).toBe(422);
    expect((await s.make({ months: undefined, emiPaise: undefined })).status).toBe(422);
  });

  it("refuses a card, a future date, extra fields and an unknown account", async () => {
    const s = await setup();
    expect((await s.make({ accountId: s.card.id })).status).toBe(422);
    expect((await s.make({ asOf: "2026-10-28" })).status).toBe(422);
    expect((await s.make({ colour: "red" })).status).toBe(422);
    expect((await s.make({ accountId: "nope" })).status).toBe(404);
    expect((await s.make({ dueDay: 32 })).status).toBe(422);
  });

  it("adds instalments already due when the tracking date is earlier, in order", async () => {
    const s = await setup();
    const before = await s.balance();
    const res = await s.make({ asOf: "2026-09-01" });
    expect(res.json.instalments.map((i: Json) => i.loanOn)).toEqual(["2026-10-05", "2026-09-05"]);
    const first = nextInstalment(P, BP, EMI)!;
    const second = nextInstalment(P - first.principalPaise, BP, EMI)!;
    expect(res.json.instalments[1]).toMatchObject({ interestPaise: first.interestPaise, principalPaise: first.principalPaise, totalPaise: EMI });
    expect(res.json.outstandingPaise).toBe(P - first.principalPaise - second.principalPaise);
    expect(res.json.repaidPaise).toBe(first.principalPaise + second.principalPaise);
    expect(res.json.interestPaidPaise).toBe(first.interestPaise + second.interestPaise);
    expect(await s.balance()).toBe(before - first.totalPaise - second.totalPaise);
  });
});

describe("what an instalment looks like in your entries", () => {
  it("is interest as an expense under Loan interest, and principal as a loan payment, from the bank", async () => {
    const s = await setup();
    await s.make({ asOf: "2026-09-01" });
    const entries = await s.loanEntries();
    expect(entries).toHaveLength(4);
    const cats = (await s.api("GET", "/api/categories")).json.items as Json[];
    const interestCat = cats.find((c) => c.name === "Loan interest")!;
    expect(interestCat).toMatchObject({ kind: "expense" });
    const interest = entries.filter((t) => t.type === "expense");
    const principal = entries.filter((t) => t.type === "loan_payment");
    expect(interest).toHaveLength(2);
    expect(principal).toHaveLength(2);
    expect(interest[0]).toMatchObject({ categoryId: interestCat.id, merchant: "Home loan", source: "loan", status: "confirmed" });
    expect(principal[0]).toMatchObject({ categoryId: null, accountId: s.bank.id, merchant: "Home loan" });
  });

  it("only the interest counts as spending, and the principal is never an expense", async () => {
    const s = await setup();
    const res = await s.make({ asOf: "2026-09-01" });
    const summary = (await s.api("GET", "/api/dashboard/summary?period=ytd")).json;
    expect(summary.expensePaise).toBe(res.json.interestPaidPaise);
    expect(summary.incomePaise).toBe(0);
    expect(summary.uncategorizedCount).toBe(0);
  });

  it("is added once however often the job runs, and catches up in order", async () => {
    const s = await setup();
    await s.make();
    expect(await materializeLoansFor(db, s.user.id, "2026-11-04")).toHaveLength(0);
    expect((await materializeLoansFor(db, s.user.id, "2026-11-05")).map((i) => i.loanOn)).toEqual(["2026-11-05"]);
    expect(await materializeLoansFor(db, s.user.id, "2026-11-05")).toHaveLength(0);
    expect((await materializeLoansFor(db, s.user.id, "2027-02-10")).map((i) => i.loanOn)).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
    expect((await s.api("GET", "/api/loans")).json.loans[0].outstandingPaise).toBeLessThan(P);
  });

  it("clears the loan, closes it, and stops", async () => {
    const s = await setup();
    await s.make({ principalPaise: 30_000_00, months: undefined, emiPaise: 12_000_00, asOf: "2026-06-01" });
    const loan = (await s.api("GET", "/api/loans?status=all")).json.loans[0];
    expect(loan).toMatchObject({ status: "closed", outstandingPaise: 0, nextDueDate: null, monthsLeft: 0 });
    expect(loan.instalments).toHaveLength(3);
    expect((await s.api("GET", "/api/loans")).json.loans).toEqual([]);
    expect(await materializeLoansFor(db, s.user.id, "2027-12-01")).toHaveLength(0);
  });
});

describe("net worth", () => {
  it("subtracts what is owed, falls as it is repaid, and leaves safe-to-spend alone", async () => {
    const s = await setup();
    const before = await s.overview();
    await s.make();
    const after = await s.overview();
    expect(after.loansPaise).toBe(P);
    expect(after.netWorthPaise).toBe(before.netWorthPaise - P);
    expect(after.safeToSpendPaise).toBe(before.safeToSpendPaise);

    // Tracked from earlier: two instalments were paid out of the bank, so only their interest has cost net worth.
    const other = await setup();
    const start = await other.overview();
    const made = (await other.make({ asOf: "2026-09-01" })).json;
    const later = await other.overview();
    expect(later.loansPaise).toBe(made.outstandingPaise);
    expect(later.loansPaise).toBeLessThan(P);
    expect(later.netWorthPaise).toBe(start.netWorthPaise - P - made.interestPaidPaise);
  });

  it("is in the trend as it stood at each month end, ending on the headline figure", async () => {
    const s = await setup();
    await s.api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-08-10", accountId: s.bank.id, merchant: "Shop" });
    await s.make({ asOf: "2026-08-20" });
    const points = (await s.api("GET", "/api/dashboard/networth")).json.points as Json[];
    expect(points.map((p) => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(points[0]!.loansPaise).toBe(P);
    expect(points[2]!.loansPaise).toBeLessThan(points[1]!.loansPaise);
    expect(points[2]!.netWorthPaise).toBe((await s.overview()).netWorthPaise);
  });
});

describe("part-prepayment", () => {
  it("shortening keeps the EMI, lowers what is owed, and the loan ends sooner", async () => {
    const s = await setup();
    const before = await s.balance();
    const res = await s.api("POST", `/api/loans/${(await s.make()).json.id}/prepay`, { amountPaise: 2_00_000_00, effect: "shorten", date: "2026-10-20" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ emiPaise: EMI, outstandingPaise: P - 2_00_000_00 });
    expect(res.json.monthsLeft).toBeLessThan(MONTHS);
    expect(await s.balance()).toBe(before - 2_00_000_00);
    const entry = (await s.loanEntries())[0]!;
    expect(entry).toMatchObject({ type: "loan_payment", amountPaise: 2_00_000_00, note: "Prepayment" });
  });

  it("lowering recalculates the EMI over the months that were left", async () => {
    const s = await setup();
    const res = await s.api("POST", `/api/loans/${(await s.make()).json.id}/prepay`, { amountPaise: 2_00_000_00, effect: "lower" });
    expect(res.json.emiPaise).toBeLessThan(EMI);
    expect(res.json.monthsLeft).toBe(MONTHS);
  });

  it("refuses more than is owed, a future date, a closed loan, and an unknown effect", async () => {
    const s = await setup();
    const id = (await s.make()).json.id;
    expect((await s.api("POST", `/api/loans/${id}/prepay`, { amountPaise: P + 1, effect: "shorten" })).status).toBe(422);
    expect((await s.api("POST", `/api/loans/${id}/prepay`, { amountPaise: 1_000_00, effect: "shorten", date: "2026-10-28" })).status).toBe(422);
    expect((await s.api("POST", `/api/loans/${id}/prepay`, { amountPaise: 1_000_00, effect: "never" })).status).toBe(422);
    await s.api("POST", `/api/loans/${id}/foreclose`, {});
    expect((await s.api("POST", `/api/loans/${id}/prepay`, { amountPaise: 1_000_00, effect: "shorten" })).status).toBe(409);
  });

  it("paying all of it closes the loan", async () => {
    const s = await setup();
    const res = await s.api("POST", `/api/loans/${(await s.make()).json.id}/prepay`, { amountPaise: P, effect: "shorten" });
    expect(res.json).toMatchObject({ status: "closed", outstandingPaise: 0 });
  });
});

describe("changing the rate", () => {
  it("keeping the EMI lets the end date move", async () => {
    const s = await setup();
    const res = await s.api("POST", `/api/loans/${(await s.make()).json.id}/rate`, { ratePct: 11, keep: "emi" });
    expect(res.json).toMatchObject({ ratePct: 11, emiPaise: EMI });
    expect(res.json.monthsLeft).toBeGreaterThan(MONTHS);
  });

  it("keeping the end date changes the EMI", async () => {
    const s = await setup();
    const res = await s.api("POST", `/api/loans/${(await s.make()).json.id}/rate`, { ratePct: 11, keep: "tenure" });
    expect(res.json.emiPaise).toBeGreaterThan(EMI);
    expect(res.json.monthsLeft).toBe(MONTHS);
    expect(monthsToClear(P, 1100, res.json.emiPaise)).toBe(MONTHS);
  });

  it("refuses a rate the EMI cannot cover when keeping it", async () => {
    const s = await setup();
    const id = (await s.make({ months: undefined, emiPaise: 8_000_00 })).json.id;
    expect((await s.api("POST", `/api/loans/${id}/rate`, { ratePct: 12, keep: "emi" })).status).toBe(422);
  });
});

describe("foreclosure", () => {
  it("pays what is left, adds charges as an expense, and closes the loan", async () => {
    const s = await setup();
    const id = (await s.make()).json.id;
    const before = await s.balance();
    const res = await s.api("POST", `/api/loans/${id}/foreclose`, { chargesPaise: 25_000_00, date: "2026-10-26" });
    expect(res.json).toMatchObject({ status: "closed", outstandingPaise: 0, monthsLeft: 0 });
    expect(await s.balance()).toBe(before - P - 25_000_00);
    const entries = await s.loanEntries();
    expect(entries.find((t) => t.type === "loan_payment")).toMatchObject({ amountPaise: P, note: "Foreclosure" });
    const charge = entries.find((t) => t.note === "Foreclosure charges")!;
    expect(charge).toMatchObject({ type: "expense", amountPaise: 25_000_00 });
    expect((await s.overview()).loansPaise).toBe(0);
    expect((await s.api("POST", `/api/loans/${id}/foreclose`, {})).status).toBe(409);
  });
});

describe("correcting and removing an instalment", () => {
  it("sets what the bank took: interest stays, principal takes the rest", async () => {
    const s = await setup();
    const made = (await s.make({ asOf: "2026-09-01" })).json;
    const on = "2026-09-05";
    const first = nextInstalment(P, BP, EMI)!;
    const res = await s.api("PATCH", `/api/loans/${made.id}/instalments/${on}`, { totalPaise: EMI + 500_00 });
    const inst = res.json.instalments.find((i: Json) => i.loanOn === on);
    expect(inst).toMatchObject({ interestPaise: first.interestPaise, principalPaise: first.principalPaise + 500_00, totalPaise: EMI + 500_00 });
    expect(res.json.repaidPaise).toBeGreaterThan(made.repaidPaise);
  });

  it("a total below the interest leaves only interest", async () => {
    const s = await setup();
    const made = (await s.make({ asOf: "2026-09-01" })).json;
    const res = await s.api("PATCH", `/api/loans/${made.id}/instalments/2026-09-05`, { totalPaise: 1_000_00 });
    expect(res.json.instalments.find((i: Json) => i.loanOn === "2026-09-05")).toMatchObject({ interestPaise: 1_000_00, principalPaise: 0, totalPaise: 1_000_00 });
  });

  it("removing one deletes both entries and is not made again", async () => {
    const s = await setup();
    const made = (await s.make({ asOf: "2026-09-01" })).json;
    const res = await s.api("DELETE", `/api/loans/${made.id}/instalments/2026-10-05`);
    expect(res.json.instalments.map((i: Json) => i.loanOn)).toEqual(["2026-09-05"]);
    expect(await materializeLoansFor(db, s.user.id, "2026-10-27")).toHaveLength(0);
    expect((await s.loanEntries())).toHaveLength(2);
    expect((await s.api("DELETE", `/api/loans/${made.id}/instalments/2026-10-05`)).status).toBe(404);
    expect((await s.api("PATCH", `/api/loans/${made.id}/instalments/2026-12-05`, { totalPaise: 5 })).status).toBe(404);
  });
});

describe("editing and deleting a loan", () => {
  it("changes the name, due day and EMI, and refuses an EMI that cannot clear it", async () => {
    const s = await setup();
    const id = (await s.make()).json.id;
    const res = await s.api("PATCH", `/api/loans/${id}`, { name: "House", dueDay: 10, emiPaise: 15_000_00 });
    expect(res.json).toMatchObject({ name: "House", dueDay: 10, emiPaise: 15_000_00, nextDueDate: "2026-11-05" });
    expect((await s.api("PATCH", `/api/loans/${id}`, { emiPaise: 5_000_00 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/loans/${id}`, { accountId: s.card.id })).status).toBe(422);
  });

  it("deletes only a loan with nothing recorded", async () => {
    const s = await setup();
    const empty = (await s.make()).json.id;
    const used = (await s.make({ name: "Used", asOf: "2026-09-01" })).json.id;
    expect((await s.api("DELETE", `/api/loans/${used}`)).status).toBe(409);
    expect((await s.api("DELETE", `/api/loans/${empty}`)).status).toBe(204);
    expect((await s.api("DELETE", `/api/loans/${empty}`)).status).toBe(404);
  });

  it("shows the schedule still to run", async () => {
    const s = await setup();
    const id = (await s.make({ months: 12 })).json.id;
    const rows = (await s.api("GET", `/api/loans/${id}/schedule`)).json.rows as Json[];
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ n: 1, date: "2026-11-05" });
    expect(rows.at(-1)!.balancePaise).toBe(0);
  });
});

describe("loan entries and the ordinary entry routes", () => {
  it("cannot be created, edited or deleted there", async () => {
    const s = await setup();
    await s.make({ asOf: "2026-09-01" });
    expect((await s.api("POST", "/api/transactions", { type: "loan_payment", amountPaise: 100_00, txnDate: "2026-10-20", accountId: s.bank.id })).status).toBe(422);
    const entries = await s.loanEntries();
    for (const e of entries) {
      expect((await s.api("PATCH", `/api/transactions/${e.id}`, { amountPaise: 5 })).status).toBe(409);
      expect((await s.api("DELETE", `/api/transactions/${e.id}`)).status).toBe(409);
    }
    expect(await s.loanEntries()).toHaveLength(4);
  });
});

describe("loans and other people", () => {
  it("are private, need a session, and go into the export", async () => {
    const a = await setup();
    const b = await setup();
    const id = (await a.make()).json.id;
    expect((await b.api("GET", "/api/loans")).json.loans).toEqual([]);
    expect((await b.api("POST", `/api/loans/${id}/prepay`, { amountPaise: 100, effect: "shorten" })).status).toBe(404);
    expect((await b.api("DELETE", `/api/loans/${id}`)).status).toBe(404);
    expect((await b.api("GET", `/api/loans/${id}/schedule`)).status).toBe(404);
    expect((await a.app.call("GET", "/api/loans", {})).status).toBe(401);
    const data = (await a.api("GET", "/api/export/json")).json;
    expect(data.loans).toHaveLength(1);
    expect(data.loans[0]).not.toHaveProperty("userId");
  });
});
