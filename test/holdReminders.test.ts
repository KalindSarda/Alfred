import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { holds, telegramLinks, users } from "../src/db/schema";
import { createHold, updateHold } from "../src/services/holds";
import { runHoldReminders } from "../src/services/nudges";
import { newId } from "../src/utils/id";
import { FakeTelegram, linkTelegram } from "./api-helpers";
import { createFixture, db } from "./helpers";

const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`); // 10:30 IST

/** A user with a linked chat and a ₹15,000 application whose outcome is due on 6 Nov 2026. */
async function applying(expectedDate: string | null = "2026-11-06") {
  const f = await createFixture();
  const chat = `chat-${newId()}`;
  await linkTelegram(f.userId, chat);
  const hold = await createHold(db, f.userId, { accountId: f.hdfc.id, title: "Tata Tech IPO", amountPaise: 15_000_00, appliedDate: "2026-11-01", expectedDate }, "2026-11-01");
  const tg = new FakeTelegram();
  const run = (iso: string) => runHoldReminders({ db, telegram: tg, now: at(iso) });
  return { f, chat, hold, tg, run };
}

describe("runHoldReminders", () => {
  // Every test in a file shares one database, so earlier tests' linked chats would also be asked.
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it("asks once, on the day the outcome is due, with the two answers as buttons", async () => {
    const { tg, chat, hold, run } = await applying();
    expect(await run("2026-11-05")).toEqual({ sent: 0 });
    expect(await run("2026-11-06")).toEqual({ sent: 1 });
    expect(tg.messages).toHaveLength(1);
    expect(tg.last.chatId).toBe(chat);
    expect(tg.last.text).toBe("The outcome of Tata Tech IPO is due. ₹15,000 is blocked in HDFC Bank. Was it allotted?");
    expect(tg.last.buttons.flat().map((b) => [b.text, b.data])).toEqual([
      ["Allotted", `h:${hold.id}:a`],
      ["Not allotted", `h:${hold.id}:n`],
    ]);
    expect(await run("2026-11-07")).toEqual({ sent: 0 });
    expect(tg.messages).toHaveLength(1);
  });

  it("catches up when the day was missed", async () => {
    const { tg, run } = await applying();
    expect(await run("2026-11-09")).toEqual({ sent: 1 });
    expect(tg.messages).toHaveLength(1);
  });

  it("says nothing without an outcome date, for a settled application, or without a linked chat", async () => {
    const undated = await applying(null);
    expect(await undated.run("2026-12-01")).toEqual({ sent: 0 });

    const settled = await applying();
    await db.update(holds).set({ status: "released" }).where(eq(holds.id, settled.hold.id));
    expect(await settled.run("2026-11-07")).toEqual({ sent: 0 });

    const unlinked = await applying();
    await db.delete(telegramLinks).where(eq(telegramLinks.userId, unlinked.f.userId));
    expect(await unlinked.run("2026-11-07")).toEqual({ sent: 0 });
  });

  it("tries again next time when Telegram would not take the message", async () => {
    const { tg, run } = await applying();
    tg.failSending = true;
    expect(await run("2026-11-06")).toEqual({ sent: 0 });
    tg.failSending = false;
    expect(await run("2026-11-07")).toEqual({ sent: 1 });
  });

  it("asks again after the outcome date is moved", async () => {
    const { f, hold, tg, run } = await applying();
    await run("2026-11-06");
    await updateHold(db, f.userId, hold.id, { expectedDate: "2026-11-10" }, "2026-11-06");
    expect(await run("2026-11-09")).toEqual({ sent: 0 });
    expect(await run("2026-11-10")).toEqual({ sent: 1 });
    expect(tg.messages).toHaveLength(2);
  });

  it("skips someone whose access was removed", async () => {
    const { f, run } = await applying();
    await db.update(users).set({ disabledAt: new Date().toISOString() }).where(eq(users.id, f.userId));
    expect(await run("2026-11-07")).toEqual({ sent: 0 });
  });
});
