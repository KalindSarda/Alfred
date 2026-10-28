import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { type BotMessage, linkTelegram, login, makeApp, registeredUser } from "../api-helpers";

type Json = Record<string, any>;
const SECRET = env.TELEGRAM_WEBHOOK_SECRET;

let counter = 1_000_000;
const nextNumber = () => ++counter;

/** A signed-in user with accounts, a linked chat, and helpers to talk to Alfred. */
async function world(options: { link?: boolean } = {}) {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };

  const hdfc = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC Bank", openingBalancePaise: 1_00_000_00 })).json;
  const sbi = (await api("POST", "/api/accounts", { kind: "bank", name: "SBI", openingBalancePaise: 50_000_00 })).json;
  const millennia = (await api("POST", "/api/accounts", { kind: "card", name: "HDFC Millennia", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const onecard = (await api("POST", "/api/accounts", { kind: "card", name: "OneCard", creditLimitPaise: 79_000_00, statementDay: 20, dueDay: 7 })).json;
  const categories = ((await api("GET", "/api/categories")).json.items as Json[]);
  const category = (name: string) => categories.find((c) => c.name === name)!.id as string;

  const chat = nextNumber();
  if (options.link !== false) await linkTelegram(user.id, String(chat));

  let updateId = nextNumber() * 10;
  const post = (update: object, secret = SECRET) =>
    app.call("POST", "/telegram/webhook", { body: update, headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, csrf: false });

  const say = (text: string, from: number = chat, type = "private") => {
    updateId++;
    return post({ update_id: updateId, message: { message_id: updateId, chat: { id: from, type }, text } });
  };
  const press = (data: string, messageId: number, from: number = chat) => {
    updateId++;
    return post({ update_id: updateId, callback_query: { id: `cb${updateId}`, data, message: { message_id: messageId, chat: { id: from } } } });
  };
  const button = (message: BotMessage, text: string) => {
    const found = message.buttons.flat().find((b) => b.text === text);
    if (!found) throw new Error(`No "${text}" button; have ${message.buttons.flat().map((b) => b.text).join(", ")}`);
    return found.data;
  };
  const transactions = async () => ((await api("GET", "/api/transactions?limit=100")).json.items as Json[]);

  return { app, user, cookie, api, tg: app.telegram, hdfc, sbi, millennia, onecard, category, chat, post, say, press, button, transactions, nextId: () => ++updateId };
}

const buttonNames = (m: BotMessage) => m.buttons.flat().map((b) => b.text);

describe("webhook security", () => {
  it("rejects a missing or wrong secret and does nothing", async () => {
    const w = await world();
    expect((await w.post({ update_id: 1, message: { message_id: 1, chat: { id: w.chat }, text: "/help" } }, "")).status).toBe(401);
    expect((await w.post({ update_id: 2, message: { message_id: 2, chat: { id: w.chat }, text: "/help" } }, "not-the-secret")).status).toBe(401);
    expect(w.tg.messages).toHaveLength(0);
  });

  it("answers 200 to the right secret, even for a body it cannot read", async () => {
    const w = await world();
    expect((await w.say("/help")).status).toBe(200);
    const junk = await w.app.call("POST", "/telegram/webhook", { body: "not json", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET }, csrf: false });
    expect(junk.status).toBe(200);
    const odd = await w.post({ hello: "world" });
    expect(odd.status).toBe(200);
  });

  it("answers 200 even when Telegram cannot be reached, so it never retries", async () => {
    const w = await world();
    w.tg.failSending = true;
    expect((await w.say("/help")).status).toBe(200);
  });

  it("handles a repeated update only once", async () => {
    const w = await world();
    const update = { update_id: 777_001, message: { message_id: 5, chat: { id: w.chat, type: "private" }, text: "/add 450 swiggy using sbi" } };
    await w.post(update);
    await w.post(update);
    expect(await w.transactions()).toHaveLength(1);
  });

  it("ignores group chats", async () => {
    const w = await world();
    await w.say("/help", w.chat, "group");
    expect(w.tg.messages).toHaveLength(0);
  });
});

describe("chats that are not linked", () => {
  it("get no reply to anything except a valid link code", async () => {
    const w = await world({ link: false });
    for (const text of ["/help", "/balance", "/add 450 swiggy", "450 swiggy", "hello", "/start"]) await w.say(text);
    expect(w.tg.messages).toHaveLength(0);
    expect(await w.transactions()).toHaveLength(0);
  });

  it("buttons from an unlinked chat do nothing", async () => {
    const w = await world({ link: false });
    await w.press("u:whatever", 1);
    expect(w.tg.messages).toHaveLength(0);
  });
});

describe("linking", () => {
  async function newCode(w: Awaited<ReturnType<typeof world>>) {
    const res = await w.api("POST", "/api/telegram/link-code");
    expect(res.status).toBe(201);
    return res.json.code as string;
  }

  it("a code from the app links the chat and Alfred welcomes you", async () => {
    const w = await world({ link: false });
    const code = await newCode(w);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    await w.say(`/start ${code}`);
    expect(w.tg.last.text).toContain("Alfred here.");
    expect(w.tg.last.text).toMatch(/Good (morning|afternoon|evening), \S+\./);
    expect((await w.api("GET", "/api/me")).json.telegramLinked).toBe(true);
    await w.say("/help");
    expect(w.tg.last.text).toContain("/add");
  });

  it("forgives lower case, spaces and dashes in the code", async () => {
    const w = await world({ link: false });
    const code = await newCode(w);
    await w.say(`/start ${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`);
    expect(w.tg.last.text).toContain("Alfred here.");
  });

  it("a code works once", async () => {
    const w = await world({ link: false });
    const code = await newCode(w);
    await w.say(`/start ${code}`);
    const other = nextNumber();
    await w.say(`/start ${code}`, other);
    expect(w.tg.messages.filter((m) => m.chatId === String(other))[0]?.text).toContain("did not work");
    await w.say("/help", other);
    expect(w.tg.messages.filter((m) => m.chatId === String(other))).toHaveLength(1);
  });

  it("a wrong or expired code does not link", async () => {
    const w = await world({ link: false });
    await w.say("/start ABCD2345");
    expect(w.tg.last.text).toContain("did not work");
    const code = await newCode(w);
    w.app.advance(11 * 60 * 1000);
    await w.say(`/start ${code}`);
    expect(w.tg.last.text).toContain("did not work");
    expect((await w.api("GET", "/api/me")).json.telegramLinked).toBe(false);
  });

  it("asking for a new code cancels the old one", async () => {
    const w = await world({ link: false });
    const first = await newCode(w);
    const second = await newCode(w);
    await w.say(`/start ${first}`);
    expect(w.tg.last.text).toContain("did not work");
    await w.say(`/start ${second}`);
    expect(w.tg.last.text).toContain("Alfred here.");
  });

  it("a new chat replaces the old one", async () => {
    const w = await world();
    const code = await newCode(w);
    const newChat = nextNumber();
    await w.say(`/start ${code}`, newChat);
    await w.say("/help", w.chat);
    expect(w.tg.messages.filter((m) => m.chatId === String(w.chat))).toHaveLength(0);
    await w.say("/help", newChat);
    expect(w.tg.messages.filter((m) => m.chatId === String(newChat)).length).toBeGreaterThan(1);
  });

  it("limits how many codes an unknown chat can try, silently", async () => {
    const w = await world({ link: false });
    for (let i = 0; i < 10; i++) await w.say(`/start ZZZZ${2222 + i}`);
    expect(w.tg.messages).toHaveLength(10);
    await w.say("/start ZZZZ9999");
    expect(w.tg.messages).toHaveLength(10);
  });

  it("unlinking from the app stops Alfred answering that chat", async () => {
    const w = await world();
    expect((await w.api("DELETE", "/api/telegram/link")).status).toBe(204);
    expect((await w.api("GET", "/api/me")).json.telegramLinked).toBe(false);
    await w.say("/help");
    expect(w.tg.messages).toHaveLength(0);
  });

  it("the link routes need a session", async () => {
    const anon = makeApp();
    expect((await anon.call("POST", "/api/telegram/link-code")).status).toBe(401);
    expect((await anon.call("DELETE", "/api/telegram/link")).status).toBe(401);
  });

  it("with a bare /start Alfred greets a linked chat", async () => {
    const w = await world();
    await w.say("/start");
    expect(w.tg.last.text).toContain("At your service");
  });
});

describe("logging with a command", () => {
  it("records a complete expense straight away, with an Undo button", async () => {
    const w = await world();
    await w.say("/add 450 food swiggy using millennia");
    expect(w.tg.last.text).toBe("Noted. ₹450 at Swiggy, under Food & Dining, from HDFC Millennia.");
    expect(buttonNames(w.tg.last)).toEqual(["Undo"]);
    const [t] = await w.transactions();
    expect(t).toMatchObject({ type: "expense", amountPaise: 450_00, merchant: "Swiggy", accountId: w.millennia.id, source: "telegram", categoryId: w.category("Food & Dining") });
  });

  it("asks which account, offering the one you used last first", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-10-26", accountId: w.sbi.id });
    await w.say("/add 450 swiggy");
    const q = w.tg.last;
    expect(q.text).toContain("Which account shall I use?");
    expect(buttonNames(q)[0]).toBe("SBI");
    expect(buttonNames(q)).toContain("Cancel");
    expect(await w.transactions()).toHaveLength(1);
  });

  it("completes the entry when you tap an account, by editing the same message", async () => {
    const w = await world();
    await w.say("/add 450 swiggy");
    const q = w.tg.last;
    await w.press(w.button(q, "HDFC Bank"), q.id);
    expect(q.text).toBe("Noted. ₹450 at Swiggy, under Food & Dining, from HDFC Bank.");
    expect(w.tg.messages).toHaveLength(1);
    expect((await w.transactions())[0]).toMatchObject({ accountId: w.hdfc.id, source: "telegram" });
  });

  it("offers only the accounts that fit when a word is ambiguous", async () => {
    const w = await world();
    await w.say("/add 450 coffee hdfc");
    expect(buttonNames(w.tg.last).filter((n) => n !== "Cancel").sort()).toEqual(["HDFC Bank", "HDFC Millennia"]);
  });

  it("Cancel records nothing and a later tap says it has timed out", async () => {
    const w = await world();
    await w.say("/add 450 swiggy");
    const q = w.tg.last;
    const chooseSbi = w.button(q, "SBI");
    await w.press(w.button(q, "Cancel"), q.id);
    expect(q.text).toContain("Nothing was recorded");
    expect(await w.transactions()).toHaveLength(0);
    await w.press(chooseSbi, q.id);
    expect(q.text).toContain("timed out");
    expect(await w.transactions()).toHaveLength(0);
  });

  it("an unanswered question expires after fifteen minutes", async () => {
    const w = await world();
    await w.say("/add 450 swiggy");
    const q = w.tg.last;
    const data = w.button(q, "SBI");
    w.app.advance(16 * 60 * 1000);
    await w.press(data, q.id);
    expect(q.text).toContain("timed out");
    expect(await w.transactions()).toHaveLength(0);
  });

  it("logs income to the account you name", async () => {
    const w = await world();
    await w.say("/income 90000 salary sbi");
    expect(w.tg.last.text).toBe("Noted. ₹90,000 received in SBI, under Salary.");
    expect((await w.transactions())[0]).toMatchObject({ type: "income", accountId: w.sbi.id, categoryId: w.category("Salary") });
  });

  it("pays a card bill and says what the card owes afterwards", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-10", accountId: w.millennia.id });
    await w.say("/pay 4500 millennia from hdfc");
    expect(w.tg.last.text).toBe("Noted. ₹4,500 paid to HDFC Millennia from HDFC Bank. HDFC Millennia is now settled.");
    const [t] = await w.transactions();
    expect(t).toMatchObject({ type: "bill_payment", accountId: w.hdfc.id, toAccountId: w.millennia.id });
  });

  it("a partial payment reports what is still owed", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-10", accountId: w.millennia.id });
    await w.say("/pay 1000 millennia from hdfc");
    expect(w.tg.last.text).toContain("HDFC Millennia now owes ₹3,500.");
  });

  it("asks for the card, then the bank, when neither is named", async () => {
    const w = await world();
    await w.say("/pay 4500");
    const askCard = w.tg.last;
    expect(askCard.text).toContain("Which card are you paying?");
    expect(buttonNames(askCard).filter((n) => n !== "Cancel").sort()).toEqual(["HDFC Millennia", "OneCard"]);
    await w.press(w.button(askCard, "OneCard"), askCard.id);
    expect(askCard.text).toContain("Which account shall I pay it from?");
    expect(buttonNames(askCard).filter((n) => n !== "Cancel").sort()).toEqual(["HDFC Bank", "SBI"]);
    await w.press(w.button(askCard, "SBI"), askCard.id);
    expect(askCard.text).toContain("₹4,500 paid to OneCard from SBI.");
  });

  it("moves money between two banks, and never offers a card", async () => {
    const w = await world();
    await w.say("/transfer 5000 hdfc sbi");
    expect(w.tg.last.text).toBe("Noted. ₹5,000 moved from HDFC Bank to SBI.");
    await w.say("/transfer 100");
    const q = w.tg.last;
    expect(buttonNames(q).filter((n) => n !== "Cancel").sort()).toEqual(["HDFC Bank", "SBI"]);
  });

  it("uses an earlier date when you give one", async () => {
    const w = await world();
    await w.say("/add 450 swiggy using sbi yesterday");
    expect(w.tg.last.text).toContain("on 26 Oct");
    expect((await w.transactions())[0]!.txnDate).toBe("2026-10-26");
  });

  it("understands amounts like 2k and 1.5L", async () => {
    const w = await world();
    await w.say("/add 2k rent using sbi");
    await w.say("/income 1.5L bonus sbi");
    const amounts = (await w.transactions()).map((t) => t.amountPaise).sort((a, b) => a - b);
    expect(amounts).toEqual([2_000_00, 1_50_000_00]);
  });

  it("learns merchants: next time it offers the account you used for them first", async () => {
    const w = await world();
    await w.say("/add 300 corner store using sbi");
    await w.say("/add 120 corner store");
    expect(buttonNames(w.tg.last)[0]).toBe("SBI");
  });

  it("explains what it could not understand instead of guessing", async () => {
    const w = await world();
    await w.say("/add swiggy");
    expect(w.tg.last.text).toContain("could not find an amount");
    await w.say("/add 450 swiggy 31/02");
    expect(w.tg.last.text).toContain("date does not look right");
    expect(await w.transactions()).toHaveLength(0);
  });
});

describe("logging in plain words", () => {
  it("asks for confirmation before recording", async () => {
    const w = await world();
    await w.say("450 swiggy using sbi");
    const q = w.tg.last;
    expect(q.text).toBe("₹450 at Swiggy, under Food & Dining, from SBI. Shall I record it?");
    expect(buttonNames(q)).toEqual(["Record it", "Cancel"]);
    expect(await w.transactions()).toHaveLength(0);
    await w.press(w.button(q, "Record it"), q.id);
    expect(q.text).toBe("Noted. ₹450 at Swiggy, under Food & Dining, from SBI.");
    expect(await w.transactions()).toHaveLength(1);
  });

  it("asks for the account first, then for confirmation", async () => {
    const w = await world();
    await w.say("spent 450 on dinner");
    const q = w.tg.last;
    expect(q.text).toContain("Which account shall I use?");
    await w.press(w.button(q, "SBI"), q.id);
    expect(q.text).toContain("Shall I record it?");
    expect(await w.transactions()).toHaveLength(0);
    await w.press(w.button(q, "Record it"), q.id);
    expect(q.text).toContain("Noted.");
    expect(await w.transactions()).toHaveLength(1);
  });

  it("Cancel at the confirmation records nothing", async () => {
    const w = await world();
    await w.say("450 swiggy using sbi");
    const q = w.tg.last;
    await w.press(w.button(q, "Cancel"), q.id);
    expect(q.text).toContain("Nothing was recorded");
    expect(await w.transactions()).toHaveLength(0);
  });

  it("reads income from the words used", async () => {
    const w = await world();
    await w.say("received 90000 salary sbi");
    expect(w.tg.last.text).toBe("₹90,000 received in SBI, under Salary. Shall I record it?");
  });

  it("says so when it cannot make sense of a message", async () => {
    const w = await world();
    await w.say("hello there");
    expect(w.tg.last.text).toContain("could not find an amount");
    expect(await w.transactions()).toHaveLength(0);
  });
});

describe("undo and categories", () => {
  it("the Undo button removes the entry", async () => {
    const w = await world();
    await w.say("/add 450 swiggy using sbi");
    const receipt = w.tg.last;
    await w.press(w.button(receipt, "Undo"), receipt.id);
    expect(receipt.text).toContain("Removed.");
    expect(await w.transactions()).toHaveLength(0);
    await w.press(receipt.buttons.flat()[0]?.data ?? "u:none", receipt.id);
  });

  it("/undo asks first, then removes the last entry Alfred logged", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 999_00, txnDate: "2026-10-20", accountId: w.sbi.id });
    await w.say("/add 450 swiggy using sbi");
    await w.say("/undo");
    const q = w.tg.last;
    expect(q.text).toBe("Shall I remove ₹450 at Swiggy, under Food & Dining, from SBI?");
    expect(await w.transactions()).toHaveLength(2);
    await w.press(w.button(q, "Remove it"), q.id);
    expect(q.text).toContain("Removed.");
    const left = await w.transactions();
    expect(left).toHaveLength(1);
    expect(left[0]!.amountPaise).toBe(999_00);
  });

  it("/undo can be declined, and says so when there is nothing to undo", async () => {
    const w = await world();
    await w.say("/undo");
    expect(w.tg.last.text).toContain("have not logged anything");
    await w.say("/add 450 swiggy using sbi");
    await w.say("/undo");
    const q = w.tg.last;
    await w.press(w.button(q, "Keep it"), q.id);
    expect(q.text).toContain("Nothing was recorded");
    expect(await w.transactions()).toHaveLength(1);
  });

  it("only removes entries logged through the bot", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 999_00, txnDate: "2026-10-20", accountId: w.sbi.id });
    await w.say("/undo");
    expect(w.tg.last.text).toContain("have not logged anything");
    expect(await w.transactions()).toHaveLength(1);
  });

  it("offers to set a category on an entry that has none, and files it", async () => {
    const w = await world();
    await w.say("/add 450 randomshop using sbi");
    const receipt = w.tg.last;
    expect(receipt.text).toBe("Noted. ₹450 at Randomshop, from SBI. It has no category yet.");
    expect(buttonNames(receipt)).toEqual(["Undo", "Set category"]);
    await w.press(w.button(receipt, "Set category"), receipt.id);
    expect(receipt.text).toContain("Which category");
    expect(buttonNames(receipt)).toContain("Groceries");
    expect(buttonNames(receipt)).not.toContain("Salary");
    await w.press(w.button(receipt, "Groceries"), receipt.id);
    expect(receipt.text).toBe("Filed. ₹450 at Randomshop, under Groceries, from SBI.");
    expect((await w.transactions())[0]!.categoryId).toBe(w.category("Groceries"));
    expect((await w.api("GET", "/api/dashboard/review")).json.uncategorizedCount).toBe(0);
  });
});

describe("questions", () => {
  it("/balance lists accounts, cards, safe-to-spend and net worth", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 2_000_00, txnDate: "2026-10-20", accountId: w.millennia.id });
    await w.say("/balance");
    const text = w.tg.last.text;
    expect(text).toContain("HDFC Bank: ₹1,00,000");
    expect(text).toContain("SBI: ₹50,000");
    expect(text).toContain("HDFC Millennia: owes ₹2,000");
    expect(text).toContain("Safe to spend: ₹1,48,000, as recorded.");
    expect(text).toContain("Net worth: ₹1,48,000 (banks minus cards).");
  });

  it("/balance marks accounts that are set aside", async () => {
    const w = await world();
    await w.api("PATCH", `/api/accounts/${w.sbi.id}`, { countsTowardSafeToSpend: false });
    await w.say("/balance");
    expect(w.tg.last.text).toContain("SBI: ₹50,000 (set aside)");
    expect(w.tg.last.text).toContain("Set aside, not counted: ₹50,000.");
  });

  it("/due lists card payments with how soon", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-10", accountId: w.millennia.id });
    await w.say("/due");
    expect(w.tg.last.text).toContain("HDFC Millennia: ₹4,500 due 12 Nov (in 16 days)");
    expect(w.tg.last.text).not.toContain("OneCard");
  });

  it("/due says so when nothing is pending", async () => {
    const w = await world();
    await w.say("/due");
    expect(w.tg.last.text).toBe("No card payments are pending.");
  });

  it("/upcoming is the same as /due", async () => {
    const w = await world();
    await w.say("/upcoming");
    expect(w.tg.last.text).toBe("No card payments are pending.");
  });

  it("/today totals today's spending", async () => {
    const w = await world();
    await w.say("/today");
    expect(w.tg.last.text).toContain("Nothing recorded for today");
    await w.say("/add 450 swiggy using sbi");
    await w.say("/add 120 cab using sbi");
    await w.say("/today");
    expect(w.tg.last.text).toContain("Today, 27 Oct: ₹570 spent across 2 entries.");
    expect(w.tg.last.text).toContain("Swiggy: ₹450");
  });

  it("/summary reports the month and where it went", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 90_000_00, txnDate: "2026-10-01", accountId: w.sbi.id, categoryId: w.category("Salary") });
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 22_000_00, txnDate: "2026-10-03", accountId: w.hdfc.id, categoryId: w.category("Rent") });
    await w.say("/summary");
    const text = w.tg.last.text;
    expect(text).toContain("For your month so far (1 Oct to 31 Oct):");
    expect(text).toContain("Income ₹90,000, expenses ₹22,000, net ₹68,000.");
    expect(text).toContain("Rent: ₹22,000 (24.4% of income)");
  });

  it("/summary accepts week, lastmonth and year", async () => {
    const w = await world();
    for (const [arg, label] of [["week", "the last seven days"], ["lastmonth", "last month"], ["year", "this year so far"]] as const) {
      await w.say(`/summary ${arg}`);
      expect(w.tg.last.text).toContain(`For ${label}`);
    }
  });

  it("/settings shows your preferences and where to change them", async () => {
    const w = await world();
    await w.api("PATCH", "/api/settings", { periodStartDay: 30, displayName: "Kalind" });
    await w.say("/settings");
    expect(w.tg.last.text).toContain("I call you Kalind.");
    expect(w.tg.last.text).toContain("3 days before a card payment is due");
    expect(w.tg.last.text).toContain("starts on day 30");
    expect(w.tg.last.text).toContain("under More");
  });

  it("/help lists the commands and unknown ones are acknowledged", async () => {
    const w = await world();
    await w.say("/help");
    for (const c of ["/add", "/income", "/pay", "/transfer", "/undo", "/today", "/balance", "/due", "/summary", "/settings"]) {
      expect(w.tg.last.text).toContain(c);
    }
    await w.say("/frobnicate");
    expect(w.tg.last.text).toContain("do not know that one");
  });

  it("accepts commands addressed to the bot by name", async () => {
    const w = await world();
    await w.say("/help@AlfredBot");
    expect(w.tg.last.text).toContain("/add");
  });
});

describe("safety", () => {
  it("one user's buttons cannot act on another user's pending entry or transactions", async () => {
    const a = await world();
    await a.say("/add 450 swiggy");
    const pending = a.tg.last;
    const choose = a.button(pending, "SBI");

    // a second user, linked to a different chat, sharing the same bot
    const bUser = await registeredUser();
    const bChat = nextNumber();
    await linkTelegram(bUser.id, String(bChat));
    await a.say("/help", bChat);
    const bMessage = a.tg.messages.filter((m) => m.chatId === String(bChat)).at(-1)!;
    await a.press(choose, bMessage.id, bChat);
    expect(bMessage.text).toContain("timed out");
    expect(await a.transactions()).toHaveLength(0);

    // and a's pending entry is still usable by a
    await a.press(choose, pending.id);
    expect(pending.text).toContain("Noted.");
    const created = (await a.transactions())[0]!;

    // b cannot remove a's transaction either
    await a.press(`u:${created.id}`, bMessage.id, bChat);
    expect(bMessage.text).toContain("already been removed");
    expect(await a.transactions()).toHaveLength(1);
  });

  it("an account archived mid-conversation is not offered or accepted", async () => {
    const w = await world();
    await w.say("/add 450 swiggy");
    const q = w.tg.last;
    const data = w.button(q, "SBI");
    await w.api("POST", `/api/accounts/${w.sbi.id}/archive`);
    await w.press(data, q.id);
    expect(q.text).toContain("do not have an account that fits");
    expect(await w.transactions()).toHaveLength(0);
  });

  it("a forged account id in a button is refused", async () => {
    const w = await world();
    await w.say("/add 450 swiggy");
    const q = w.tg.last;
    const pendingId = w.button(q, "SBI").split(":")[1]!;
    await w.press(`p:${pendingId}:a:someone-elses-account`, q.id);
    expect(q.text).toContain("do not have an account that fits");
    expect(await w.transactions()).toHaveLength(0);
  });

  it("never claims success when the ledger refuses", async () => {
    const w = await world();
    await w.say("450 swiggy using sbi");
    const confirm = w.tg.last;
    // the category is archived after Alfred asked but before you confirmed
    await w.api("PATCH", `/api/categories/${w.category("Food & Dining")}`, { archived: true });
    await w.press(w.button(confirm, "Record it"), confirm.id);
    expect(confirm.text).toContain("did not go through");
    expect(confirm.text).toContain("nothing was recorded");
    expect(confirm.text).not.toContain("Noted.");
    expect(await w.transactions()).toHaveLength(0);
  });

  it("every message sounds like Alfred: no exclamation marks and no emoji", async () => {
    const w = await world();
    for (const text of ["/help", "/add 450 swiggy using sbi", "/add 450 swiggy", "/today", "/balance", "/due", "/summary", "/settings", "/undo", "/add swiggy", "/nonsense"]) {
      await w.say(text);
    }
    const all = w.tg.messages.map((m) => m.text).join("\n");
    expect(all).not.toContain("!");
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
