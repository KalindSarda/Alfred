import { describe, expect, it } from "vitest";
import { levelEmi, simulatePrepayment } from "../src/domain/loans";
import { world } from "./bot/harness";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27. HDFC holds ₹1,00,000 and SBI ₹50,000.
const spend = (w: W, category: string, amountPaise: number, txnDate: string, extra: object = {}) =>
  w.api("POST", "/api/transactions", { type: "expense", amountPaise, txnDate, accountId: w.hdfc.id, categoryId: w.category(category), ...extra });
const runway = async (w: W) => (await w.api("GET", "/api/runway")).json as Json;
const categoryDto = async (w: W, name: string) => ((await w.api("GET", "/api/categories")).json.items as Json[]).find((c) => c.name === name)!;

describe("the essential flag on categories", () => {
  it("is on for rent, bills and the like, and off for the rest", async () => {
    const w = await world();
    for (const n of ["Rent", "Groceries", "Bills & Utilities", "Transport", "Health", "Insurance", "Fuel", "Education"]) expect((await categoryDto(w, n)).essential, n).toBe(true);
    for (const n of ["Food & Dining", "Shopping", "Entertainment", "Travel", "Salary"]) expect((await categoryDto(w, n)).essential, n).toBe(false);
  });

  it("can be changed, and means nothing for income", async () => {
    const w = await world();
    const food = await categoryDto(w, "Food & Dining");
    expect((await w.api("PATCH", `/api/categories/${food.id}`, { essential: true })).json.essential).toBe(true);
    const salary = await categoryDto(w, "Salary");
    expect((await w.api("PATCH", `/api/categories/${salary.id}`, { essential: true })).json.essential).toBe(false);
    expect((await w.api("PATCH", `/api/categories/${food.id}`, { essential: false })).json.essential).toBe(false);
  });
});

describe("runway", () => {
  it("says nothing without enough history or essential spending", async () => {
    const w = await world();
    expect(await runway(w)).toMatchObject({ burnPaise: null, months: null, basedOnDays: 0 });
    await spend(w, "Rent", 30_000_00, "2026-10-20");
    expect(await runway(w)).toMatchObject({ burnPaise: null, months: null, basedOnDays: 8 });
  });

  it("is the bank money over a month of essential spending, as an early estimate", async () => {
    const w = await world();
    await spend(w, "Rent", 30_000_00, "2026-10-02");
    await spend(w, "Food & Dining", 10_000_00, "2026-10-05");
    // 26 days of entries; only rent is essential: 30,000 / 26 x 30. The bank holds 1,10,000.
    expect(await runway(w)).toMatchObject({ liquidPaise: 1_10_000_00, burnPaise: 3_461_538, months: 3.1, basedOnDays: 26, solid: false, essentialPaise: 30_000_00 });
  });

  it("follows the essential flag", async () => {
    const w = await world();
    await spend(w, "Rent", 30_000_00, "2026-10-02");
    await spend(w, "Food & Dining", 10_000_00, "2026-10-05");
    await w.api("PATCH", `/api/categories/${(await categoryDto(w, "Food & Dining")).id}`, { essential: true });
    expect((await runway(w)).essentialPaise).toBe(40_000_00);
    await w.api("PATCH", `/api/categories/${(await categoryDto(w, "Rent")).id}`, { essential: false });
    expect((await runway(w)).essentialPaise).toBe(10_000_00);
  });

  it("counts loan instalments, interest and principal, but not a prepayment, and card EMI instalments", async () => {
    const w = await world();
    await spend(w, "Rent", 30_000_00, "2026-10-02");
    const created = await w.api("POST", "/api/loans", { name: "Car loan", kind: "car", accountId: w.hdfc.id, principalPaise: 1_00_000_00, ratePct: 12, months: 12, dueDay: 5, asOf: "2026-09-01" });
    expect(created.status).toBe(201);
    const emi = levelEmi(1_00_000_00, 1200, 12);
    // The 5 Sep and 5 Oct instalments, each an interest entry plus a principal entry, add up to the EMI.
    expect((await runway(w)).essentialPaise).toBe(30_000_00 + 2 * emi);
    await w.api("POST", `/api/loans/${created.json.id}/prepay`, { amountPaise: 10_000_00, effect: "shorten" });
    expect((await runway(w)).essentialPaise).toBe(30_000_00 + 2 * emi);
  });

  it("shows only your own, and /balance says it in words", async () => {
    const w = await world();
    const other = await world();
    await spend(w, "Rent", 30_000_00, "2026-10-02");
    expect((await runway(other)).burnPaise).toBeNull();
    await w.say("/balance");
    expect(w.tg.last.text).toContain("Runway: at ₹34,615.38 a month of essential spending, your bank money would last about 3.4 months (an early estimate, from 26 days of entries).");
    await other.say("/balance");
    expect(other.tg.last.text).not.toContain("Runway");
  });
});

describe("what if you part-pay a loan", () => {
  const P = 10_00_000_00;
  const make = async (w: W, extra: object = {}) => (await w.api("POST", "/api/loans", { name: "Home loan", kind: "home", accountId: w.hdfc.id, principalPaise: P, ratePct: 9, months: 120, dueDay: 5, ...extra })).json;

  it("shows both ways without recording anything", async () => {
    const w = await world();
    const loan = await make(w);
    const before = (await w.api("GET", "/api/loans")).json;
    const sim = await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1_00_000_00, effect: "shorten" });
    const expected = simulatePrepayment({ outstandingPaise: P, ratePctBp: 900, emiPaise: loan.emiPaise, firstDue: loan.nextDueDate, dueDay: 5, amountPaise: 1_00_000_00, effect: "shorten" });
    expect(sim.status).toBe(200);
    expect(sim.json).toMatchObject({ loanName: "Home loan", amountPaise: 1_00_000_00, effect: "shorten", monthsSaved: expected.monthsSaved, interestSavedPaise: expected.interestSavedPaise, invest: null });
    expect(sim.json.before.months).toBe(120);
    const lower = (await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1_00_000_00, effect: "lower" })).json;
    expect(lower.monthsSaved).toBe(0);
    expect(lower.after.emiPaise).toBeLessThan(loan.emiPaise);
    expect((await w.api("GET", "/api/loans")).json).toEqual(before);
  });

  it("matches what the real part-payment then does", async () => {
    const w = await world();
    const loan = await make(w);
    const sim = (await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1_00_000_00, effect: "lower" })).json;
    const done = (await w.api("POST", `/api/loans/${loan.id}/prepay`, { amountPaise: 1_00_000_00, effect: "lower" })).json;
    expect(done.emiPaise).toBe(sim.after.emiPaise);
    expect(done.monthsLeft).toBe(sim.after.months);
  });

  it("compares the same money invested at a stated return", async () => {
    const w = await world();
    const loan = await make(w);
    const sim = (await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1_00_000_00, effect: "shorten", returnPct: 12 })).json;
    expect(sim.invest).toMatchObject({ returnPct: 12, months: 120 });
    expect(sim.invest.gainPaise).toBeGreaterThan(2_20_000_00);
    expect((await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1, effect: "shorten", returnPct: 60 })).status).toBe(422);
  });

  it("refuses more than is owed, a loan that is not yours, and extra fields", async () => {
    const w = await world();
    const loan = await make(w);
    expect((await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: P + 1, effect: "shorten" })).status).toBe(422);
    expect((await w.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1, effect: "shorten", extra: 1 })).status).toBe(422);
    const other = await world();
    expect((await other.api("POST", `/api/loans/${loan.id}/simulate`, { amountPaise: 1_000_00, effect: "shorten" })).status).toBe(404);
  });

  it("/whatif answers in words, with the investing comparison when a return is given", async () => {
    const w = await world();
    await make(w);
    await w.say("/whatif 100000 home");
    const text = w.tg.last.text;
    expect(text).toContain("Home loan: part-paying ₹1,00,000 now.");
    expect(text).toMatch(/Keeping the EMI at ₹[\d,.]+: it ends \d+ months sooner, around [A-Z][a-z]{2} \d{4} instead of [A-Z][a-z]{2} \d{4}, and saves ₹[\d,.]+ of interest\./);
    expect(text).toMatch(/Lowering the EMI: it falls from ₹[\d,.]+ to ₹[\d,.]+ a month, ending as planned, and saves ₹[\d,.]+ of interest\./);
    expect(text).not.toContain("For comparison");
    await w.say("/whatif prepay 100000 home 12%");
    expect(w.tg.last.text).toMatch(/For comparison, ₹1,00,000 invested at 12% a year might grow by about ₹[\d,.]+ over the 120 months the loan has left, before tax and with no guarantee\./);
  });

  it("/whatif asks for an amount, says when there is no loan, and asks which when it cannot tell", async () => {
    const w = await world();
    await w.say("/whatif");
    expect(w.tg.last.text).toBe("Tell me the amount, for example /whatif 25000 home.");
    await w.say("/whatif 25000");
    expect(w.tg.last.text).toBe("You have no bank loans recorded.");
    await make(w);
    await make(w, { name: "Car loan", kind: "car" });
    await w.say("/whatif 25000");
    expect(w.tg.last.text).toBe("Which loan would the 25000 go toward? Name it, for example /whatif 25000 home.");
    await w.say("/whatif 25000 boat");
    expect(w.tg.last.text).toBe("I cannot tell which loan you mean. Use part of its name.");
  });
});
