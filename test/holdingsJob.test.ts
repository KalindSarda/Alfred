import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { telegramLinks } from "../src/db/schema";
import { runHoldingNudges } from "../src/services/holdingsJob";
import { FakeTelegram, linkTelegram, login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`);

async function person(withHolding = true) {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const chat = `chat-${user.id}`;
  await linkTelegram(user.id, chat);
  if (withHolding) {
    const res = await app.call("POST", "/api/holdings", { cookie, body: { name: "Tata Tech", kind: "stock", investedPaise: 10_000_00, valuePaise: 12_000_00, valueDate: "2026-10-01" } });
    expect(res.status).toBe(201);
  }
  return { user, chat };
}

describe("the monthly nudge to refresh values", () => {
  // Every test in a file shares one database, so earlier tests' linked chats would also be messaged.
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it("asks on the first of the month, listing each investment with its age", async () => {
    const { chat } = await person();
    const tg = new FakeTelegram();
    expect(await runHoldingNudges({ db, telegram: tg, now: at("2026-11-01") })).toEqual({ sent: 1 });
    expect(tg.last.chatId).toBe(chat);
    expect(tg.last.text).toContain("Would you care to refresh what your investments are worth?");
    expect(tg.last.text).toContain("Tata Tech: ₹12,000, valued");
    expect(tg.last.text).toContain("/value tata 15200");
  });

  it("does nothing on any other day", async () => {
    await person();
    const tg = new FakeTelegram();
    for (const day of ["2026-11-02", "2026-11-15", "2026-10-31"]) expect(await runHoldingNudges({ db, telegram: tg, now: at(day) })).toEqual({ sent: 0 });
    expect(tg.messages).toHaveLength(0);
  });

  it("skips people with no investments, or no linked chat", async () => {
    await person(false);
    const unlinked = await person();
    await db.delete(telegramLinks).where(eq(telegramLinks.userId, unlinked.user.id));
    const tg = new FakeTelegram();
    expect(await runHoldingNudges({ db, telegram: tg, now: at("2026-11-01") })).toEqual({ sent: 0 });
  });

  it("skips a closed holding", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    await linkTelegram(user.id, `chat-${user.id}`);
    const made = await app.call("POST", "/api/holdings", { cookie, body: { name: "Old", kind: "stock", valuePaise: 100_00 } });
    const id = JSON.parse(await made.text()).id as string;
    await app.call("POST", `/api/holdings/${id}/close`, { cookie });
    const tg = new FakeTelegram();
    expect(await runHoldingNudges({ db, telegram: tg, now: at("2026-11-01") })).toEqual({ sent: 0 });
  });
});
