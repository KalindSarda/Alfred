import { describe, expect, it } from "vitest";
import { runStatementChecks } from "../src/services/statementJob";
import { buttonNames, world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27. HDFC Millennia: statement on the 23rd, due on the 12th. OneCard: statement 20th, due 7th.
const spend = (w: W, extra: object = {}) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 20_000_00, txnDate: "2026-10-10", accountId: w.millennia.id, categoryId: w.category("Shopping"), ...extra });
const job = (w: W, date: string) => runStatementChecks({ db, telegram: w.tg, now: () => Date.parse(`${date}T05:00:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
const owed = async (w: W) => ((await w.api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === w.millennia.id)!.outstandingPaise as number;

describe("which card to use", () => {
  it("ranks the cards by days until the bill is due", async () => {
    const w = await world();
    const res = await w.api("GET", "/api/cards/float?amountPaise=2000000");
    expect(res.json.items.map((c: Json) => [c.name, c.days, c.statementDate, c.dueDate, c.fits])).toEqual([
      ["HDFC Millennia", 46, "2026-11-23", "2026-12-12", true],
      ["OneCard", 41, "2026-11-20", "2026-12-07", true],
    ]);
  });

  it("puts a card that cannot take the amount last", async () => {
    const w = await world();
    const res = await w.api("GET", "/api/cards/float?amountPaise=10000000");
    expect(res.json.items.map((c: Json) => [c.name, c.fits])).toEqual([["HDFC Millennia", true], ["OneCard", false]]);
    const small = (await w.api("GET", "/api/cards/float?amountPaise=100")).json.items;
    expect(small).toHaveLength(2);
  });

  it("leaves out an archived card, and only your own cards are ranked", async () => {
    const w = await world();
    await w.api("POST", `/api/accounts/${w.onecard.id}/archive`);
    expect((await w.api("GET", "/api/cards/float")).json.items.map((c: Json) => c.name)).toEqual(["HDFC Millennia"]);
    const other = await world();
    expect((await other.api("GET", "/api/cards/float")).json.items).toHaveLength(2);
  });

  it("/swipe answers in words, asks for an amount, and copes with no cards", async () => {
    const w = await world();
    await w.say("/swipe 20000");
    expect(w.tg.last.text).toBe(
      "For ₹20,000, the longest time before the bill first:\nHDFC Millennia: 46 days (statement 23 Nov, bill due 12 Dec)\nOneCard: 41 days (statement 20 Nov, bill due 7 Dec)",
    );
    await w.say("/swipe 100000");
    expect(w.tg.last.text).toContain("OneCard: 41 days (statement 20 Nov, bill due 7 Dec), but only ₹79,000 of credit is left");
    await w.say("/swipe");
    expect(w.tg.last.text).toBe("Tell me the amount, for example /swipe 20000.");
  });
});

describe("checking a statement in the app", () => {
  it("knows what it expects the last statement to total", async () => {
    const w = await world();
    await spend(w);
    await spend(w, { amountPaise: 5_000_00, txnDate: "2026-10-25" });
    const facts = (await w.api("GET", `/api/cards/statement?cardId=${w.millennia.id}`)).json;
    expect(facts).toMatchObject({ cardName: "HDFC Millennia", statementDate: "2026-10-23", dueDate: "2026-11-12", expectedPaise: 20_000_00, previousUnpaidPaise: 0 });
  });

  it("recognises a fee with GST in the gap, and books it dated the statement", async () => {
    const w = await world();
    await spend(w);
    const analysis = (await w.api("POST", "/api/cards/statement", { cardId: w.millennia.id, billedPaise: 20_352_82 })).json;
    expect(analysis).toMatchObject({ kind: "fee_gst", differencePaise: 352_82, bookAs: "fee", billedPaise: 20_352_82 });
    expect(analysis.reason).toContain("exactly ₹299 plus 18% GST");
    const done = await w.api("POST", "/api/cards/statement/settle", { cardId: w.millennia.id, billedPaise: 20_352_82 });
    expect(done.json).toMatchObject({ kind: "fee", bookedPaise: 352_82, cardName: "HDFC Millennia" });
    expect(await owed(w)).toBe(20_352_82);
    const booked = (await w.transactions()).find((t) => t.note === "Statement check")!;
    expect(booked).toMatchObject({ type: "expense", amountPaise: 352_82, txnDate: "2026-10-23", source: "check", accountId: w.millennia.id });
    // Booked once: the same statement now agrees.
    expect((await w.api("POST", "/api/cards/statement/settle", { cardId: w.millennia.id, billedPaise: 20_352_82 })).json.kind).toBeNull();
    expect(await owed(w)).toBe(20_352_82);
  });

  it("says a lower statement may be a missing credit and books it as income", async () => {
    const w = await world();
    await spend(w);
    const analysis = (await w.api("POST", "/api/cards/statement", { cardId: w.millennia.id, billedPaise: 19_500_00 })).json;
    expect(analysis).toMatchObject({ kind: "credit", differencePaise: -500_00 });
    await w.api("POST", "/api/cards/statement/settle", { cardId: w.millennia.id, billedPaise: 19_500_00 });
    expect(await owed(w)).toBe(19_500_00);
    expect((await w.transactions()).find((t) => t.note === "Statement check")).toMatchObject({ type: "income", amountPaise: 500_00 });
  });

  it("recognises interest when last month's bill was left unpaid", async () => {
    const w = await world();
    // September's statement (23 Sep, due 12 Oct) was 40,000 and nothing was paid.
    await spend(w, { amountPaise: 40_000_00, txnDate: "2026-09-10" });
    const analysis = (await w.api("POST", "/api/cards/statement", { cardId: w.millennia.id, billedPaise: 40_000_00 + 1_234_56 })).json;
    expect(analysis.facts.previousUnpaidPaise).toBe(40_000_00);
    expect(analysis.kind).toBe("interest");
  });

  it("refuses a bank, an archived card, and another person's card", async () => {
    const w = await world();
    expect((await w.api("GET", `/api/cards/statement?cardId=${w.hdfc.id}`)).status).toBe(422);
    const other = await world();
    expect((await other.api("GET", `/api/cards/statement?cardId=${w.millennia.id}`)).status).toBe(404);
    await w.api("POST", `/api/accounts/${w.onecard.id}/archive`);
    expect((await w.api("POST", "/api/cards/statement", { cardId: w.onecard.id, billedPaise: 1 })).status).toBe(422);
  });
});

describe("asking about a statement the day after", () => {
  it("asks once, with what Alfred makes it and two answers", async () => {
    const w = await world();
    await spend(w);
    await job(w, "2026-10-24");
    const asks = mine(w).filter((m) => m.text.includes("statement of 23 Oct"));
    expect(asks).toHaveLength(1);
    expect(asks[0]!.text).toBe("HDFC Millennia: your statement of 23 Oct should be out. I make the total ₹20,000. What does it say?");
    expect(buttonNames(asks[0]!)).toEqual(["Yes, it matches", "Different"]);
    await job(w, "2026-10-24");
    await job(w, "2026-10-25");
    expect(mine(w).filter((m) => m.text.includes("statement of 23 Oct"))).toHaveLength(1);
  });

  it("does not ask when there is nothing owed, when the statement is old, or after a check in the app", async () => {
    const w = await world();
    await job(w, "2026-10-24");
    expect(mine(w)).toHaveLength(0);
    await spend(w);
    await job(w, "2026-10-30");
    expect(mine(w)).toHaveLength(0);
    await w.api("POST", "/api/cards/statement/settle", { cardId: w.millennia.id, billedPaise: 20_000_00 });
    await job(w, "2026-10-24");
    expect(mine(w)).toHaveLength(0);
  });

  const asked = async () => {
    const w = await world();
    await spend(w);
    await job(w, "2026-10-24");
    return { w, ask: mine(w).find((m) => m.text.includes("statement of 23 Oct"))! };
  };

  it("Yes just thanks", async () => {
    const { w, ask } = await asked();
    await w.press(w.button(ask, "Yes, it matches"), ask.id);
    expect(ask.text).toBe("Splendid. That matches the statement.");
  });

  it("Different waits for the total, names the gap and books it when asked", async () => {
    const { w, ask } = await asked();
    await w.press(w.button(ask, "Different"), ask.id);
    expect(ask.text).toBe("What is the total amount due on the HDFC Millennia statement? Send the amount, such as 20988.76.");
    await w.say("20352.82");
    const gap = w.tg.last;
    expect(gap.text).toBe(
      "HDFC Millennia: I made the statement ₹20,000 and it says ₹20,352.82. ₹352.82 is exactly ₹299 plus 18% GST, which looks like a fee (processing, annual or late) that I did not know of.",
    );
    expect(buttonNames(gap)).toEqual(["Add ₹352.82 as Fees & Charges", "Leave it"]);
    await w.press(w.button(gap, "Add ₹352.82 as Fees & Charges"), gap.id);
    expect(gap.text).toBe("Booked ₹352.82 as a fee on HDFC Millennia, dated its statement. We agree now.");
    expect(await owed(w)).toBe(20_352_82);
  });

  it("Leave it changes nothing, and a total that matches needs no booking", async () => {
    const { w, ask } = await asked();
    await w.press(w.button(ask, "Different"), ask.id);
    await w.say("20111");
    const gap = w.tg.last;
    await w.press(w.button(gap, "Leave it"), gap.id);
    expect(gap.text).toBe("Very well. I have left it as it is.");
    expect(await owed(w)).toBe(20_000_00);
    const second = await asked();
    await second.w.press(second.w.button(second.ask, "Different"), second.ask.id);
    await second.w.say("20000");
    expect(second.w.tg.last.text).toBe("Splendid. That matches the statement.");
  });

  it("a message that is not an amount carries on as a normal entry, and a forged or stale button changes nothing", async () => {
    const { w, ask } = await asked();
    await w.press(w.button(ask, "Different"), ask.id);
    await w.say("450 food swiggy hdfc");
    expect(w.tg.last.text).toContain("450");
    const other = await asked();
    await other.w.press(other.w.button(other.ask, "Different"), other.ask.id);
    await other.w.say("20352.82");
    const theirs = other.w.button(other.w.tg.last, "Add ₹352.82 as Fees & Charges");
    await w.press(theirs, ask.id);
    expect(ask.text).toContain("superseded or the question has expired");
    expect(await owed(w)).toBe(20_000_00);
    await w.press(`s:${w.millennia.id}:d:2026-09-23`, ask.id);
    expect(ask.text).toContain("superseded or the question has expired");
  });
});
