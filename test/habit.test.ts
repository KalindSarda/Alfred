import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkinLog, transactions } from "../src/db/schema";
import { lastLoggedDate } from "../src/services/habit";
import { runEveningCheckIns } from "../src/services/habitJob";
import { newId, nowIso } from "../src/utils/id";
import { buttonNames, world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27 (a Tuesday); 25 Oct and 1 Nov are Sundays.
const night = (w: W, date: string) => runEveningCheckIns({ db, telegram: w.tg, now: () => Date.parse(`${date}T17:15:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
const expense = (w: W, extra: object = {}) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 5_000, txnDate: "2026-10-20", accountId: w.hdfc.id, categoryId: w.category("Transport"), merchant: "Rapido", ...extra });
/** Pins when the person's entries were made, since "last logged" goes by that. */
const loggedOn = (w: W, date: string) => db.update(transactions).set({ createdAt: `${date}T05:00:00.000Z` }).where(eq(transactions.userId, w.user.id));
const balanceOf = async (w: W, id: string) => ((await w.api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === id)!.balancePaise as number;

describe("the last day something was logged", () => {
  it("is the day the latest entry was made, and counts a 'nothing today' answer", async () => {
    const w = await world();
    expect(await lastLoggedDate(db, w.user.id)).toBeNull();
    await expense(w);
    await loggedOn(w, "2026-10-23");
    expect(await lastLoggedDate(db, w.user.id)).toBe("2026-10-23");
    await db.insert(checkinLog).values({ id: newId(), userId: w.user.id, kind: "none_today", day: "2026-10-25", createdAt: nowIso() });
    expect(await lastLoggedDate(db, w.user.id)).toBe("2026-10-25");
  });

  it("ignores rent and other automatic entries, drafts and deleted entries", async () => {
    const w = await world();
    await w.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: w.hdfc.id, categoryId: w.category("Rent"), frequency: "monthly", day: 27 });
    expect(await lastLoggedDate(db, w.user.id)).toBeNull();
    const draft = await expense(w, { status: "draft" });
    expect(draft.status).toBe(201);
    expect(await lastLoggedDate(db, w.user.id)).toBeNull();
  });
});

describe("the briefing", () => {
  it("says how long it has been, from two days, and says nothing before", async () => {
    const w = await world();
    await expense(w);
    const lines = async () => ((await w.api("GET", "/api/alfred/briefing")).json.lines as Json[]).filter((l) => l.key === "habit").map((l) => l.text);
    await loggedOn(w, "2026-10-26");
    expect(await lines()).toEqual([]);
    await loggedOn(w, "2026-10-23");
    expect(await lines()).toEqual(["Nothing logged since 23 Oct, 4 days. Shall we catch up?"]);
  });
});

describe("the evening check-in", () => {
  it("speaks gently after one quiet day, with the usual spends, Nothing today and Pause as buttons", async () => {
    const w = await world();
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]) await expense(w, { txnDate: d });
    await loggedOn(w, "2026-10-26");
    await night(w, "2026-10-27");
    const m = mine(w).at(-1)!;
    expect(m.text).toBe("Good evening. Nothing has been logged today. Anything to add?");
    expect(buttonNames(m)).toEqual(["Rapido ₹50", "Nothing today", "Pause a week"]);
  });

  it("is firmer after two quiet days, and asks only once a night", async () => {
    const w = await world();
    await expense(w);
    await loggedOn(w, "2026-10-25");
    await night(w, "2026-10-27");
    expect(mine(w).at(-1)!.text).toBe("Good evening. 2 days have passed since your last entry, on 25 Oct. A moment now keeps the books honest. What went out today?");
    const sent = mine(w).length;
    await night(w, "2026-10-27");
    expect(mine(w)).toHaveLength(sent);
  });

  it("says nothing when something was logged today, nothing was ever logged, or it is paused or switched off", async () => {
    const w = await world();
    await night(w, "2026-10-27");
    expect(mine(w)).toHaveLength(0);
    await expense(w);
    await loggedOn(w, "2026-10-27");
    await night(w, "2026-10-27");
    expect(mine(w)).toHaveLength(0);
    await loggedOn(w, "2026-10-25");
    await w.api("PATCH", "/api/settings", { logNudgeUntil: "2026-10-27" });
    await night(w, "2026-10-27");
    expect(mine(w)).toHaveLength(0);
    await w.api("PATCH", "/api/settings", { logNudgeUntil: null, logNudge: false });
    await night(w, "2026-10-27");
    expect(mine(w)).toHaveLength(0);
    await w.api("PATCH", "/api/settings", { logNudge: true });
    await night(w, "2026-10-27");
    expect(mine(w)).toHaveLength(1);
  });

  it("eases off: nightly for four days, then every third, and not at all after a month", async () => {
    const w = await world();
    await expense(w);
    await loggedOn(w, "2026-09-20");
    const asked = async (date: string) => {
      const before = mine(w).length;
      await night(w, date);
      return mine(w).length > before;
    };
    expect(await asked("2026-09-24")).toBe(true); // 4 days
    expect(await asked("2026-09-25")).toBe(false); // 5
    expect(await asked("2026-09-26")).toBe(false); // 6
    expect(await asked("2026-09-27")).toBe(true); // 7
    expect(await asked("2026-10-20")).toBe(false); // 30 days: not a third day
    expect(await asked("2026-10-21")).toBe(false); // 31 days
  });

  it("Nothing today counts as logging, and Pause a week keeps it quiet", async () => {
    const w = await world();
    await expense(w);
    await loggedOn(w, "2026-10-24");
    await night(w, "2026-10-26");
    const m = mine(w).at(-1)!;
    await w.press(w.button(m, "Nothing today"), m.id);
    expect(m.text).toBe("Understood. A quiet day, noted. I shall not ask again tonight.");
    expect(await lastLoggedDate(db, w.user.id)).toBe("2026-10-27");
    const m2 = mine(w).at(-1)!;
    await w.press("z:p", m2.id);
    expect((await w.api("GET", "/api/settings")).json.logNudgeUntil).toBe("2026-11-03");
    const sent = mine(w).length;
    await night(w, "2026-10-30");
    expect(mine(w)).toHaveLength(sent);
    await night(w, "2026-11-06");
    expect(mine(w).length).toBe(sent + 1);
  });

  it("the Sunday balance check replaces the evening check-in", async () => {
    const w = await world();
    await expense(w, { txnDate: "2026-10-26" });
    await loggedOn(w, "2026-10-20");
    await night(w, "2026-11-01");
    const texts = mine(w).map((m) => m.text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("Weekly check. I have HDFC Bank at ₹99,950. Does your bank say the same?");
    await night(w, "2026-11-01");
    expect(mine(w)).toHaveLength(1);
  });

  it("with the weekly check switched off, a Sunday gets the evening check-in", async () => {
    const w = await world();
    await expense(w);
    await loggedOn(w, "2026-10-25");
    await w.api("PATCH", "/api/settings", { balanceCheck: false });
    await night(w, "2026-11-01");
    expect(mine(w).at(-1)!.text).toContain("have passed since your last entry");
  });
});

describe("a usual spend as one tap", () => {
  const usual = async () => {
    const w = await world();
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]) await expense(w, { txnDate: d });
    await loggedOn(w, "2026-10-26");
    await night(w, "2026-10-27");
    return { w, m: mine(w).at(-1)! };
  };

  it("records it again for today with an Undo button", async () => {
    const { w, m } = await usual();
    const before = (await w.transactions()).length;
    await w.press(w.button(m, "Rapido ₹50"), m.id);
    const entries = await w.transactions();
    expect(entries).toHaveLength(before + 1);
    expect(entries[0]).toMatchObject({ amountPaise: 5_000, merchant: "Rapido", accountId: w.hdfc.id, txnDate: "2026-10-27", source: "telegram" });
    const reply = mine(w).at(-1)!;
    expect(reply.text).toContain("₹50");
    expect(buttonNames(reply)).toEqual(["Undo"]);
  });

  it("will not copy someone else's entry, or an entry that is not a spend of yours", async () => {
    const { w, m } = await usual();
    const other = await world();
    const theirs = (await expense(other)).json;
    const before = (await w.transactions()).length;
    await w.press(`y:${theirs.id}`, m.id);
    await w.press("y:nonsense", m.id);
    expect(await w.transactions()).toHaveLength(before);
  });
});

describe("the weekly balance check", () => {
  const sunday = async (extra: (w: W) => Promise<unknown> = async () => undefined) => {
    const w = await world();
    await expense(w, { txnDate: "2026-10-26" });
    await loggedOn(w, "2026-10-20");
    await extra(w);
    await night(w, "2026-11-01");
    return { w, ask: mine(w).at(-1)! };
  };

  it("asks about the banks you used, and Yes just thanks", async () => {
    const { w, ask } = await sunday();
    expect(buttonNames(ask)).toEqual(["Yes, it matches", "Different"]);
    await w.press(w.button(ask, "Yes, it matches"), ask.id);
    expect(ask.text).toBe("Splendid. That matches your bank.");
  });

  it("books a lower balance as unlogged spending, and leaves the account at what the bank says", async () => {
    const { w, ask } = await sunday();
    await w.press(w.button(ask, "Different"), ask.id);
    expect(ask.text).toBe("What does your bank show for HDFC Bank? Send the balance, such as 100284.52.");
    await w.say("99000");
    const proposal = w.tg.last;
    expect(proposal.text).toBe("HDFC Bank: I have ₹99,950 and your bank shows ₹99,000. That is ₹950 less than I know of, so some spending was not logged.");
    expect(buttonNames(proposal)).toEqual(["Book ₹950 as unlogged spending", "Leave it"]);
    await w.press(w.button(proposal, "Book ₹950 as unlogged spending"), proposal.id);
    expect(proposal.text).toBe("Booked ₹950 as unlogged spending. HDFC Bank now stands at ₹99,000, as your bank says.");
    expect(await balanceOf(w, w.hdfc.id)).toBe(99_000_00);
    const booked = (await w.transactions()).find((t) => t.note === "Balance check")!;
    expect(booked).toMatchObject({ type: "expense", amountPaise: 950_00, source: "check", txnDate: "2026-10-27" });
    // It is not logging: the person is still as quiet as before.
    expect(await lastLoggedDate(db, w.user.id)).toBe("2026-10-20");
  });

  it("books a higher balance as unrecorded income", async () => {
    const { w, ask } = await sunday();
    await w.press(w.button(ask, "Different"), ask.id);
    await w.say("1,00,500");
    const proposal = w.tg.last;
    expect(buttonNames(proposal)[0]).toBe("Book ₹550 as unrecorded income");
    await w.press(w.button(proposal, "Book ₹550 as unrecorded income"), proposal.id);
    expect(await balanceOf(w, w.hdfc.id)).toBe(1_00_500_00);
    expect((await w.transactions()).find((t) => t.note === "Balance check")).toMatchObject({ type: "income", amountPaise: 550_00 });
  });

  it("a typed balance that matches needs no booking, and Leave it changes nothing", async () => {
    const { w, ask } = await sunday();
    await w.press(w.button(ask, "Different"), ask.id);
    await w.say("99950");
    expect(w.tg.last.text).toBe("Splendid. That matches your bank.");
    const { w: w2, ask: ask2 } = await sunday();
    await w2.press(w2.button(ask2, "Different"), ask2.id);
    await w2.say("99000");
    const p = w2.tg.last;
    await w2.press(w2.button(p, "Leave it"), p.id);
    expect(p.text).toBe("Very well. I have left it as it is.");
    expect(await balanceOf(w2, w2.hdfc.id)).toBe(99_950_00);
  });

  it("a message that is not a balance carries on as a normal entry, and a forged button changes nothing", async () => {
    const { w, ask } = await sunday();
    await w.press(w.button(ask, "Different"), ask.id);
    await w.say("450 food swiggy hdfc");
    expect(w.tg.last.text).toContain("450");
    const other = await sunday();
    await other.w.press(other.w.button(other.ask, "Different"), other.ask.id);
    await other.w.say("90000");
    const theirs = other.w.button(other.w.tg.last, "Book ₹9,950 as unlogged spending");
    await w.press(theirs, ask.id);
    expect(await balanceOf(w, w.hdfc.id)).toBe(99_950_00);
    expect(await balanceOf(other.w, other.w.hdfc.id)).toBe(99_950_00);
  });
});

describe("checking a balance in the app", () => {
  it("previews the gap and books it, for a bank only and only your own", async () => {
    const w = await world();
    const preview = await w.api("POST", "/api/balance-check", { accountId: w.hdfc.id, typedPaise: 90_000_00 });
    expect(preview.json).toMatchObject({ accountName: "HDFC Bank", alfredPaise: 1_00_000_00, typedPaise: 90_000_00, differencePaise: -10_000_00 });
    expect((await w.api("POST", "/api/balance-check", { accountId: w.millennia.id, typedPaise: 1 })).status).toBe(422);
    const other = await world();
    expect((await other.api("POST", "/api/balance-check", { accountId: w.hdfc.id, typedPaise: 1 })).status).toBe(404);
    const settled = await w.api("POST", "/api/balance-check/settle", { accountId: w.hdfc.id, typedPaise: 90_000_00 });
    expect(settled.json).toMatchObject({ kind: "spending", bookedPaise: 10_000_00, balancePaise: 90_000_00 });
    expect(await balanceOf(w, w.hdfc.id)).toBe(90_000_00);
    expect((await w.api("POST", "/api/balance-check/settle", { accountId: w.hdfc.id, typedPaise: 90_000_00 })).json.kind).toBe("none");
  });
});
