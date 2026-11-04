import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { contacts, debts, telegramLinks, users } from "../src/db/schema";
import { addPayment, createDebt } from "../src/services/debts";
import { runDebtReminders } from "../src/services/debtJob";
import { newId } from "../src/utils/id";
import { FakeTelegram, linkTelegram } from "./api-helpers";
import { createFixture, db } from "./helpers";

const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`); // 10:30 IST

/** A user with a linked chat and, optionally, a loan made on 2026-10-01. */
async function person(over: Partial<Parameters<typeof createDebt>[2]> = {}) {
  const f = await createFixture();
  const chat = `chat-${newId()}`;
  await linkTelegram(f.userId, chat);
  const made = await createDebt(
    db,
    f.userId,
    { name: "Rahul", direction: "lent", amountPaise: 5_000_00, date: "2026-10-01", dueDate: "2026-11-10", accountId: f.hdfc.id, ...over },
    "web",
    "2026-10-27",
  );
  const tg = new FakeTelegram();
  const run = (iso: string) => runDebtReminders({ db, telegram: tg, now: at(iso) });
  return { f, chat, tg, run, made };
}

describe("following up on money lent", () => {
  // Every test in a file shares one database, so earlier tests' linked chats would also be messaged.
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it("asks on the due date, with three answers, and not before", async () => {
    const { chat, made, tg, run } = await person();
    expect(await run("2026-11-09")).toEqual({ sent: 0 });
    expect(await run("2026-11-10")).toEqual({ sent: 1 });
    expect(tg.last.chatId).toBe(chat);
    expect(tg.last.text).toBe("Rahul still owes you ₹5,000, lent on 1 Oct, due 10 Nov. Has it been paid?");
    const id = made.person.debts[0]!.id;
    expect(tg.last.buttons.flat().map((b) => [b.text, b.data])).toEqual([
      ["Paid in full", `f:${id}:p`],
      ["Later", `f:${id}:l`],
      ["Stop following up", `f:${id}:s`],
    ]);
  });

  it("asks again every fourteen days until it is dealt with, and not in between", async () => {
    const { tg, run } = await person();
    await run("2026-11-10");
    expect(await run("2026-11-11")).toEqual({ sent: 0 });
    expect(await run("2026-11-23")).toEqual({ sent: 0 });
    expect(await run("2026-11-24")).toEqual({ sent: 1 });
    expect(await run("2026-12-08")).toEqual({ sent: 1 });
    expect(tg.messages).toHaveLength(3);
  });

  it("with no due date, first asks thirty days after it was lent", async () => {
    const { run } = await person({ dueDate: null });
    expect(await run("2026-10-30")).toEqual({ sent: 0 });
    expect(await run("2026-10-31")).toEqual({ sent: 1 });
  });

  it("never asks about a trusted person", async () => {
    const { f, run } = await person();
    await db.update(contacts).set({ trusted: true }).where(eq(contacts.userId, f.userId));
    expect(await run("2027-03-01")).toEqual({ sent: 0 });
  });

  it("stops when told to, and when it is paid or written off", async () => {
    const stopped = await person();
    await db.update(debts).set({ followUpStopped: true }).where(eq(debts.userId, stopped.f.userId));
    expect(await stopped.run("2026-12-01")).toEqual({ sent: 0 });

    const paid = await person();
    await addPayment(db, paid.f.userId, paid.made.person.debts[0]!.id, { amountPaise: 5_000_00 }, "web", "2026-10-28");
    expect(await paid.run("2026-12-01")).toEqual({ sent: 0 });

    const forgiven = await person();
    await db.update(debts).set({ status: "settled", forgiven: true }).where(eq(debts.userId, forgiven.f.userId));
    expect(await forgiven.run("2026-12-01")).toEqual({ sent: 0 });
  });

  it("asks about what is still owed, not the original amount", async () => {
    const { f, made, tg, run } = await person();
    await addPayment(db, f.userId, made.person.debts[0]!.id, { amountPaise: 2_000_00 }, "web", "2026-10-28");
    await run("2026-11-10");
    expect(tg.last.text).toContain("still owes you ₹3,000");
  });

  it("tries again next time when Telegram would not take the message", async () => {
    const { tg, run } = await person();
    tg.failSending = true;
    expect(await run("2026-11-10")).toEqual({ sent: 0 });
    tg.failSending = false;
    expect(await run("2026-11-11")).toEqual({ sent: 1 });
  });

  it("says nothing without a linked chat, or to someone whose access was removed", async () => {
    const unlinked = await person();
    await db.delete(telegramLinks).where(eq(telegramLinks.userId, unlinked.f.userId));
    expect(await unlinked.run("2026-11-10")).toEqual({ sent: 0 });

    const removed = await person();
    await db.update(users).set({ disabledAt: new Date().toISOString() }).where(eq(users.id, removed.f.userId));
    expect(await removed.run("2026-11-10")).toEqual({ sent: 0 });
  });
});

describe("reminding about money you borrowed", () => {
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  const borrowed = (extra: object = {}) => person({ name: "Asha", direction: "borrowed", amountPaise: 8_000_00, dueDate: "2026-11-10", ...extra });

  it("reminds the day before and on the day, once each", async () => {
    const { tg, run } = await borrowed();
    expect(await run("2026-11-08")).toEqual({ sent: 0 });
    expect(await run("2026-11-09")).toEqual({ sent: 1 });
    expect(tg.last.text).toBe("A reminder: you owe Asha ₹8,000, due tomorrow, 10 Nov.");
    expect(await run("2026-11-09")).toEqual({ sent: 0 });
    expect(await run("2026-11-10")).toEqual({ sent: 1 });
    expect(tg.last.text).toBe("You owe Asha ₹8,000, due today.");
    expect(await run("2026-11-11")).toEqual({ sent: 0 });
    expect(tg.messages).toHaveLength(2);
    expect(tg.last.buttons).toEqual([]);
  });

  it("sends only the later message when both days were missed", async () => {
    const { tg, run } = await borrowed();
    expect(await run("2026-11-14")).toEqual({ sent: 1 });
    expect(tg.last.text).toBe("You owe Asha ₹8,000, which was due on 10 Nov.");
    expect(await run("2026-11-15")).toEqual({ sent: 0 });
  });

  it("says nothing without a due date, or once it is repaid", async () => {
    const undated = await borrowed({ dueDate: null });
    expect(await undated.run("2026-11-10")).toEqual({ sent: 0 });

    const repaid = await borrowed();
    await addPayment(db, repaid.f.userId, repaid.made.person.debts[0]!.id, { amountPaise: 8_000_00 }, "web", "2026-10-28");
    expect(await repaid.run("2026-11-10")).toEqual({ sent: 0 });
  });

  it("a changed due date starts the reminders over", async () => {
    const { f, made, run } = await borrowed();
    await run("2026-11-10");
    const { updateDebt } = await import("../src/services/debts");
    await updateDebt(db, f.userId, made.person.debts[0]!.id, { dueDate: "2026-12-20" }, "2026-11-10");
    expect(await run("2026-12-19")).toEqual({ sent: 1 });
  });
});
