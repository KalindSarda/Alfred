import { env } from "cloudflare:workers";
import { type BotMessage, linkTelegram, login, makeApp, registeredUser } from "../api-helpers";

export type Json = Record<string, any>;
export const SECRET = env.TELEGRAM_WEBHOOK_SECRET;

let counter = 1_000_000;
export const nextNumber = () => ++counter;

/** A signed-in user with accounts, a linked chat, and helpers to talk to Alfred. */
export async function world(options: { link?: boolean } = {}) {
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


export const buttonNames = (m: BotMessage) => m.buttons.flat().map((b) => b.text);
