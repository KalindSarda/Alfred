import { describe, expect, it } from "vitest";
import { levelEmi, nextInstalment } from "../../src/domain/loans";
import { runLoanCheckIns } from "../../src/services/loanJob";
import { db } from "../helpers";
import { buttonNames, world } from "./harness";

type W = Awaited<ReturnType<typeof world>>;

// The test clock is 2026-10-27. A loan with due day 5 first falls due on 5 Nov.
const P = 10_00_000_00;
const EMI = levelEmi(P, 900, 120);
const make = (w: W, extra: object = {}) =>
  w.api("POST", "/api/loans", { name: "Home loan", kind: "home", accountId: w.hdfc.id, principalPaise: P, ratePct: 9, months: 120, dueDay: 5, ...extra });
const run = (w: W, iso: string) => runLoanCheckIns({ db, telegram: w.tg, now: () => Date.parse(`${iso}T05:00:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
const loan = async (w: W) => ((await w.api("GET", "/api/loans?status=all")).json.loans as Record<string, any>[])[0]!;

describe("/loans", () => {
  it("says how to start when there are none", async () => {
    const w = await world();
    await w.say("/loans");
    expect(w.tg.last.text).toBe("You have no bank loans recorded. Add one in the app, under Money, then Commitments.");
  });

  it("lists what is owed, the EMI, the next date and the months left, with the total", async () => {
    const w = await world();
    await make(w);
    await w.say("/loans");
    const text = w.tg.last.text;
    expect(text).toContain("You owe ₹10,00,000 on bank loans, with");
    expect(text).toContain("Home loan: ₹10,00,000 owed, EMI");
    expect(text).toContain("next on 5 Nov, about 120 months left");
  });

  it("counts loans in /balance net worth", async () => {
    const w = await world();
    await w.say("/balance");
    const n = (s: string) => Number(s.replace(/,/g, ""));
    const before = n(/Net worth: ₹([\d,.]+)/.exec(w.tg.last.text)![1]!);
    await make(w);
    await w.say("/balance");
    const after = /Net worth: (-?)₹([\d,.]+)/.exec(w.tg.last.text)!;
    expect((after[1] ? -1 : 1) * n(after[2]!)).toBe(before - 10_00_000);
  });
});

describe("asking whether an instalment agrees with the bank", () => {
  it("asks once, when the instalment is added, with the split and two answers", async () => {
    const w = await world();
    await make(w);
    expect(mine(w)).toHaveLength(0);
    expect((await run(w, "2026-11-05")).added).toBeGreaterThanOrEqual(1);
    const [m] = mine(w);
    const split = nextInstalment(P, 900, EMI)!;
    expect(m!.text).toBe(`Home loan: ₹${(split.totalPaise / 100).toLocaleString("en-IN")} was taken from HDFC Bank (interest ₹${(split.interestPaise / 100).toLocaleString("en-IN")}, principal ₹${(split.principalPaise / 100).toLocaleString("en-IN")}). Does that agree with your bank?`);
    expect(buttonNames(m!)).toEqual(["Yes, it agrees", "Different amount"]);
    await run(w, "2026-11-05");
    expect(mine(w)).toHaveLength(1);
  });

  it("does not ask about instalments added when the loan is created", async () => {
    const w = await world();
    await make(w, { asOf: "2026-09-01" });
    expect((await loan(w)).instalments).toHaveLength(2);
    await run(w, "2026-10-27");
    expect(mine(w)).toHaveLength(0);
  });

  it("Yes just thanks", async () => {
    const w = await world();
    await make(w);
    await run(w, "2026-11-05");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Yes, it agrees"), m.id);
    expect(m.text).toBe("Splendid. That matches your bank.");
  });

  it("Different amount waits for the figure, then corrects the instalment and says what is owed", async () => {
    const w = await world();
    await make(w);
    await run(w, "2026-11-05");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Different amount"), m.id);
    expect(m.text).toBe("What did the bank take for Home loan on 5 Nov? Send the full amount, such as 32500.");
    const split = nextInstalment(P, 900, EMI)!;
    await w.say(String((EMI + 500_00) / 100));
    const l = await loan(w);
    expect(w.tg.last.text).toContain("Corrected. Home loan took");
    expect(l.instalments[0]).toMatchObject({ loanOn: "2026-11-05", interestPaise: split.interestPaise, principalPaise: split.principalPaise + 500_00 });
    expect(w.tg.last.text).toContain("is still owed");
  });

  it("a message that is not an amount carries on as a normal entry, and the wait is dropped", async () => {
    const w = await world();
    await make(w);
    await run(w, "2026-11-05");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Different amount"), m.id);
    await w.say("450 food swiggy hdfc");
    expect(w.tg.last.text).toContain("450");
    await w.say("99999");
    expect((await loan(w)).instalments[0]!.totalPaise).toBe(EMI);
  });

  it("forged or stale buttons change nothing", async () => {
    const w = await world();
    const other = await world();
    const theirs = (await make(other)).json;
    await run(other, "2026-11-05");
    await make(w);
    await run(w, "2026-11-05");
    const m = mine(w)[0]!;
    await w.press(`l:${theirs.id}:d:2026-11-05`, m.id);
    expect(m.text).toBe("I cannot find that instalment any more, so there is nothing to correct.");
    await w.say("999");
    expect((await loan(other)).instalments[0]!.totalPaise).toBe(EMI);
    await w.press(`l:${(await loan(w)).id}:d:2030-01-01`, m.id);
    expect(m.text).toBe("I cannot find that instalment any more, so there is nothing to correct.");
  });
});

describe("the menu and the briefing", () => {
  it("/menu offers Loans, and it answers like /loans", async () => {
    const w = await world();
    await make(w);
    await w.say("/menu");
    const m = w.tg.last;
    expect(buttonNames(m)).toContain("Loans");
    await w.press(w.button(m, "Loans"), m.id);
    expect(w.tg.last.text).toContain("You owe ₹10,00,000 on bank loans");
  });

  it("the briefing mentions an instalment due within a week, and not a later one", async () => {
    const w = await world();
    await make(w, { dueDay: 30 });
    const lines = (await w.api("GET", "/api/alfred/briefing")).json.lines as Record<string, any>[];
    const line = lines.find((l) => l.key === "loans")!;
    expect(line.text).toContain("Home loan:");
    expect(line.text).toContain("is due on 30 Oct");
    expect(line.text).toContain("from HDFC Bank");
    expect(line.to).toBe("/accounts?view=commitments#loans");
    const later = await world();
    await make(later, { dueDay: 5 });
    expect(((await later.api("GET", "/api/alfred/briefing")).json.lines as Record<string, any>[]).find((l) => l.key === "loans")).toBeUndefined();
  });
});
