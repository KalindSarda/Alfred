import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recurringRules, telegramLinks, transactions, users } from "../src/db/schema";
import { createRule, listRules } from "../src/services/recurring";
import { runRecurring } from "../src/services/recurringJob";
import { newId } from "../src/utils/id";
import { FakeTelegram, linkTelegram } from "./api-helpers";
import { createFixture, db } from "./helpers";

const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`); // 10:30 IST

/** A user with a linked chat and a rule on the HDFC account. */
async function withRule(over: Partial<Parameters<typeof createRule>[2]> = {}, today = "2026-10-27") {
  const f = await createFixture();
  const chat = `chat-${newId()}`;
  await linkTelegram(f.userId, chat);
  const rule = await createRule(
    db,
    f.userId,
    { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: f.hdfc.id, frequency: "monthly", day: 5, mode: "auto", ...over },
    today,
  );
  const tg = new FakeTelegram();
  const run = (iso: string) => runRecurring({ db, telegram: tg, now: at(iso) });
  return { f, chat, rule, tg, run };
}

describe("runRecurring", () => {
  // Every test in a file shares one database, so earlier tests' linked chats would also be messaged.
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it("adds what has come due, once, and says nothing about a confirmed entry", async () => {
    const { f, rule, tg, run } = await withRule();
    expect(await run("2026-11-04")).toEqual({ added: 0, sent: 0 });
    expect(await run("2026-11-05")).toEqual({ added: 1, sent: 0 });
    expect(await run("2026-11-05")).toEqual({ added: 0, sent: 0 });
    expect(tg.messages).toHaveLength(0);
    const made = await db.select().from(transactions).where(and(eq(transactions.userId, f.userId), eq(transactions.recurringRuleId, rule.id)));
    expect(made.map((t) => [t.txnDate, t.status])).toEqual([["2026-11-05", "confirmed"]]);
  });

  it("asks about each draft, with Confirm and Discard buttons", async () => {
    const { f, chat, tg, run } = await withRule({ title: "Electricity", mode: "draft", amountPaise: 3_000_00 });
    expect(await run("2026-11-05")).toEqual({ added: 1, sent: 1 });
    expect(tg.last.chatId).toBe(chat);
    expect(tg.last.text).toBe("Electricity came due. I have added ₹3,000 on HDFC Bank as a draft, since that amount can vary. Is it right? If not, correct it in the app.");
    const [draft] = await db.select().from(transactions).where(and(eq(transactions.userId, f.userId), eq(transactions.status, "draft")));
    expect(tg.last.buttons.flat().map((b) => [b.text, b.data])).toEqual([
      ["Confirm", `r:${draft!.id}:ok`],
      ["Discard", `r:${draft!.id}:no`],
    ]);
  });

  it("still adds the entry when there is no linked chat, and sends nothing", async () => {
    const { f, rule, tg, run } = await withRule({ mode: "draft" });
    await db.delete(telegramLinks).where(eq(telegramLinks.userId, f.userId));
    expect(await run("2026-11-05")).toEqual({ added: 1, sent: 0 });
    expect(tg.messages).toHaveLength(0);
    expect((await listRules(db, f.userId, "2026-11-05"))[0]).toMatchObject({ id: rule.id, entries: 1 });
  });

  it("reminds the chosen number of days ahead, once per occurrence", async () => {
    const { chat, tg, run } = await withRule({ remindDaysBefore: 3 });
    expect(await run("2026-11-01")).toEqual({ added: 0, sent: 0 }); // four days ahead
    expect(await run("2026-11-02")).toEqual({ added: 0, sent: 1 }); // three days ahead
    expect(tg.last.chatId).toBe(chat);
    expect(tg.last.text).toBe("A word ahead of time: Rent, ₹22,000 on HDFC Bank, comes up on 5 Nov, in 3 days.");
    expect(await run("2026-11-02")).toEqual({ added: 0, sent: 0 });
    expect(tg.messages).toHaveLength(1);
    // The next month is reminded about again.
    expect(await run("2026-12-02")).toEqual({ added: 1, sent: 1 });
  });

  it("tries a reminder again when Telegram would not take it", async () => {
    const { tg, run } = await withRule({ remindDaysBefore: 3 });
    tg.failSending = true;
    expect(await run("2026-11-02")).toEqual({ added: 0, sent: 0 });
    tg.failSending = false;
    expect(await run("2026-11-02")).toEqual({ added: 0, sent: 1 });
  });

  it("does not remind about a paused rule, or one whose next date was skipped", async () => {
    const paused = await withRule({ remindDaysBefore: 3 });
    await db.update(recurringRules).set({ pausedAt: new Date().toISOString() }).where(eq(recurringRules.id, paused.rule.id));
    expect(await paused.run("2026-11-02")).toEqual({ added: 0, sent: 0 });

    const skipped = await withRule({ remindDaysBefore: 3 });
    await db.update(recurringRules).set({ skipsJson: JSON.stringify(["2026-11-05"]) }).where(eq(recurringRules.id, skipped.rule.id));
    expect(await skipped.run("2026-11-02")).toEqual({ added: 0, sent: 0 });
  });

  it("skips someone whose access was removed", async () => {
    const { f, run } = await withRule({ remindDaysBefore: 3, mode: "draft" });
    await db.update(users).set({ disabledAt: new Date().toISOString() }).where(eq(users.id, f.userId));
    expect(await run("2026-11-02")).toEqual({ added: 0, sent: 0 });
    expect((await run("2026-11-05")).sent).toBe(0);
  });
});
