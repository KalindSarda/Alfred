import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cardReminder } from "../src/alfred/botVoice";
import { insertAccount } from "../src/db/accounts";
import { appSettings, botPending, nudgeLog, sessions, telegramLinks, telegramUpdates } from "../src/db/schema";
import { createTransaction } from "../src/services/ledger";
import { runMaintenance } from "../src/services/maintenance";
import { runNudges } from "../src/services/nudges";
import { newId } from "../src/utils/id";
import { FakeTelegram, linkTelegram } from "./api-helpers";
import { createFixture, createUser, db } from "./helpers";

const web = { source: "web" as const };
// Millennia: statement on the 23rd, due on the 12th of the next month.
const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`); // 10:30 IST

/** A fixture user with a linked chat and ₹4,500 outstanding on the HDFC Millennia statement of 23 Oct. */
async function owing() {
  const f = await createFixture();
  const chat = `chat-${newId()}`;
  await linkTelegram(f.userId, chat);
  await createTransaction(db, f.userId, { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-10", accountId: f.millennia.id }, web);
  const tg = new FakeTelegram();
  const run = (iso: string) => runNudges({ db, telegram: tg, now: at(iso) });
  return { f, chat, tg, run };
}

describe("runNudges", () => {
  // Every test in a file shares one database, so earlier tests' linked chats would also be reminded.
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it("reminds you once when a card payment enters the reminder window", async () => {
    const { tg, chat, run } = await owing();
    const result = await run("2026-11-09"); // due 12 Nov, three days away
    expect(result).toEqual({ sent: 1, announced: 1 });
    expect(tg.messages).toHaveLength(1);
    expect(tg.last.chatId).toBe(chat);
    expect(tg.last.text).toBe(
      "A quick reminder: HDFC Millennia has ₹4,500 due on 12 Nov, in 3 days. Your tracked balances cover it, assuming nothing else is pending.",
    );
  });

  it("does not repeat itself however often it runs", async () => {
    const { tg, f, run } = await owing();
    await run("2026-11-09");
    await run("2026-11-09");
    await run("2026-11-10");
    await run("2026-11-12");
    expect(tg.messages).toHaveLength(1);
    expect(await db.select().from(nudgeLog).where(eq(nudgeLog.userId, f.userId))).toHaveLength(1);
  });

  it("stays quiet while the due date is further away than your reminder window", async () => {
    const { tg, run } = await owing();
    expect(await run("2026-11-08")).toEqual({ sent: 0, announced: 0 }); // 4 days away, window is 3
    expect(tg.messages).toHaveLength(0);
    await run("2026-11-09");
    expect(tg.messages).toHaveLength(1);
  });

  it("catches up on a missed day while the payment is still ahead", async () => {
    const { tg, run } = await owing();
    // nothing ran on the 9th or 10th; the job runs on the 11th, one day before it is due
    await run("2026-11-11");
    expect(tg.messages).toHaveLength(1);
    expect(tg.last.text).toContain("tomorrow");
  });

  it("says today on the due date, and says nothing once it has passed", async () => {
    const a = await owing();
    await a.run("2026-11-12");
    expect(a.tg.last.text).toContain("due on 12 Nov, today.");
    const b = await owing();
    expect(await b.run("2026-11-13")).toEqual({ sent: 0, announced: 0 });
  });

  it("respects the reminder window you chose", async () => {
    const { f, tg, run } = await owing();
    await db.insert(appSettings).values({ userId: f.userId, nudgeLeadDays: 1 });
    await run("2026-11-09");
    expect(tg.messages).toHaveLength(0);
    await run("2026-11-11");
    expect(tg.messages).toHaveLength(1);
  });

  it("never mentions a card with nothing outstanding", async () => {
    const { f, tg, run } = await owing();
    await createTransaction(db, f.userId, { type: "bill_payment", amountPaise: 4_500_00, txnDate: "2026-11-05", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    expect(await run("2026-11-09")).toEqual({ sent: 0, announced: 0 });
    expect(tg.messages).toHaveLength(0);
  });

  it("a partial payment still reminds you, for what is left", async () => {
    const { f, tg, run } = await owing();
    await createTransaction(db, f.userId, { type: "bill_payment", amountPaise: 1_500_00, txnDate: "2026-11-05", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    await run("2026-11-09");
    expect(tg.last.text).toContain("₹3,000 due on 12 Nov");
  });

  it("announces the next due date separately, a month later", async () => {
    const { f, tg, run } = await owing();
    await run("2026-11-09");
    // a purchase before the 23 Nov statement makes the December payment due
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 2_000_00, txnDate: "2026-11-15", accountId: f.millennia.id }, web);
    await createTransaction(db, f.userId, { type: "bill_payment", amountPaise: 4_500_00, txnDate: "2026-11-12", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    await run("2026-12-09");
    expect(tg.messages).toHaveLength(2);
    expect(tg.last.text).toContain("due on 12 Dec");
  });

  it("lists every card in one note when several fall due together", async () => {
    const f = await createFixture();
    await linkTelegram(f.userId, `chat-${newId()}`);
    const second = await insertAccount(db, f.userId, { kind: "card", name: "Amazon Pay ICICI", creditLimitPaise: 3_10_000_00, statementDay: 20, dueDay: 12 });
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-10", accountId: f.millennia.id }, web);
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 2_500_00, txnDate: "2026-10-12", accountId: second.id }, web);
    const tg = new FakeTelegram();
    const result = await runNudges({ db, telegram: tg, now: at("2026-11-10") });
    expect(result).toEqual({ sent: 1, announced: 2 });
    expect(tg.last.text).toContain("several card payments");
    expect(tg.last.text).toContain("Together that is ₹7,000.");
  });

  it("says when the balances it can see fall short, and does not count set-aside accounts", async () => {
    const { f, tg, run } = await owing();
    // main spendable money is ₹15,000 (HDFC 10,000 + SBI 5,000); raise the bill above that
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 20_000_00, txnDate: "2026-10-11", accountId: f.millennia.id }, web);
    await run("2026-11-09");
    expect(tg.last.text).toContain("₹24,500 due on 12 Nov");
    expect(tg.last.text).toContain("Your tracked balances are ₹9,500 short of it, so a transfer may be needed.");
    expect(tg.last.text).not.toContain("cover it");
  });

  it("does nothing for a user who has not linked Telegram, then reminds them once they do", async () => {
    const f = await createFixture();
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-10", accountId: f.millennia.id }, web);
    const tg = new FakeTelegram();
    const run = () => runNudges({ db, telegram: tg, now: at("2026-11-09") });
    expect(await run()).toEqual({ sent: 0, announced: 0 });
    expect(await db.select().from(nudgeLog).where(eq(nudgeLog.userId, f.userId))).toHaveLength(0);
    await linkTelegram(f.userId, `chat-${newId()}`);
    expect(await run()).toEqual({ sent: 1, announced: 1 });
  });

  it("tries again next time when Telegram would not take the message", async () => {
    const { tg, f, run } = await owing();
    tg.failSending = true;
    expect(await run("2026-11-09")).toEqual({ sent: 0, announced: 0 });
    expect(await db.select().from(nudgeLog).where(eq(nudgeLog.userId, f.userId))).toHaveLength(0);
    tg.failSending = false;
    expect(await run("2026-11-10")).toEqual({ sent: 1, announced: 1 });
  });

  it("ignores archived cards", async () => {
    const { f, tg, run } = await owing();
    await createTransaction(db, f.userId, { type: "bill_payment", amountPaise: 4_500_00, txnDate: "2026-11-01", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    const { accounts } = await import("../src/db/schema");
    await db.update(accounts).set({ archivedAt: new Date().toISOString() }).where(eq(accounts.id, f.millennia.id));
    await run("2026-11-09");
    expect(tg.messages).toHaveLength(0);
  });

  it("each user is told only about their own cards", async () => {
    const a = await owing();
    const b = await owing();
    const tg = new FakeTelegram();
    const result = await runNudges({ db, telegram: tg, now: at("2026-11-09") });
    // other tests' users share the database, so only check these two
    const chats = tg.messages.map((m) => m.chatId);
    expect(chats).toContain(a.chat);
    expect(chats).toContain(b.chat);
    expect(chats.filter((c) => c === a.chat)).toHaveLength(1);
    expect(result.sent).toBeGreaterThanOrEqual(2);
  });

  it("one user's delivery failure does not stop the others", async () => {
    const a = await owing();
    const b = await owing();
    const picky = new (class extends FakeTelegram {
      override async sendMessage(chatId: string, text: string, buttons?: Parameters<FakeTelegram["sendMessage"]>[2]) {
        if (chatId === a.chat) throw new Error("blocked");
        return super.sendMessage(chatId, text, buttons);
      }
    })();
    await runNudges({ db, telegram: picky, now: at("2026-11-09") });
    expect(picky.messages.some((m) => m.chatId === b.chat)).toBe(true);
    expect(picky.messages.some((m) => m.chatId === a.chat)).toBe(false);
  });
});

describe("cardReminder wording", () => {
  const card = { name: "HDFC Millennia", amountPaise: 10_108_00, dueDate: "2026-11-07", daysAway: 11 };

  it("sounds like Alfred: composed, no exclamation marks, no emoji", () => {
    for (const text of [cardReminder([card], 1_00_000_00), cardReminder([card], 0), cardReminder([card, { ...card, name: "OneCard", daysAway: 2 }], 5_000_00)]) {
      expect(text).not.toContain("!");
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text.startsWith("A quick reminder:")).toBe(true);
    }
  });

  it("never claims to know more than it has been told", () => {
    expect(cardReminder([card], 1_00_000_00)).toContain("tracked balances");
    expect(cardReminder([card], 1_00_000_00)).toContain("assuming nothing else is pending");
  });
});

describe("runMaintenance", () => {
  it("removes expired rows and leaves live ones", async () => {
    const user = await createUser();
    const now = Date.parse("2026-11-10T00:00:00Z");
    const old = new Date(now - 10 * 86_400_000).toISOString();
    const future = new Date(now + 86_400_000).toISOString();
    await db.insert(sessions).values([
      { id: newId(), userId: user, tokenHash: `old-${newId()}`, expiresAt: old, createdAt: old, lastSeenAt: old },
      { id: newId(), userId: user, tokenHash: `new-${newId()}`, expiresAt: future, createdAt: old, lastSeenAt: old },
    ]);
    await db.insert(botPending).values([
      { id: `old${newId()}`.slice(0, 10), userId: user, chatId: "1", payload: "{}", expiresAt: old, createdAt: old },
      { id: `new${newId()}`.slice(0, 10), userId: user, chatId: "1", payload: "{}", expiresAt: future, createdAt: old },
    ]);
    await db.insert(telegramUpdates).values([
      { updateId: 9_000_001, receivedAt: old },
      { updateId: 9_000_002, receivedAt: new Date(now).toISOString() },
    ]);
    await runMaintenance(db, now);
    const live = await db.select().from(sessions).where(eq(sessions.userId, user));
    expect(live).toHaveLength(1);
    expect(live[0]!.expiresAt).toBe(future);
    expect((await db.select().from(botPending).where(eq(botPending.userId, user))).map((p) => p.expiresAt)).toEqual([future]);
    const updates = (await db.select().from(telegramUpdates)).map((u) => u.updateId);
    expect(updates).not.toContain(9_000_001);
    expect(updates).toContain(9_000_002);
  });
});
