import { env } from "cloudflare:workers";
import { createApp } from "../src/app";
import { telegramLinks } from "../src/db/schema";
import type { Button, TelegramApi } from "../src/bot/telegramApi";
import type { Notifiers } from "../src/services/notifiers";
import { newId } from "../src/utils/id";
import { createUser, db } from "./helpers";

export const START = Date.parse("2026-10-27T10:00:00Z");

export interface BotMessage {
  id: number;
  chatId: string;
  text: string;
  buttons: Button[][];
  /** Set when a later edit replaced this message's text. */
  edited: boolean;
}

/** Stands in for Telegram: records what Alfred sends and edits so tests can read the conversation. */
export class FakeTelegram implements TelegramApi {
  messages: BotMessage[] = [];
  answered: string[] = [];
  failSending = false;
  private nextId = 100;

  async sendMessage(chatId: string, text: string, buttons: Button[][] = []): Promise<number> {
    if (this.failSending) throw new Error("telegram down");
    const id = this.nextId++;
    this.messages.push({ id, chatId, text, buttons, edited: false });
    return id;
  }

  async editMessage(chatId: string, messageId: number, text: string, buttons: Button[][] = []): Promise<void> {
    const found = this.messages.find((m) => m.id === messageId && m.chatId === chatId);
    if (!found) throw new Error(`No message ${messageId} to edit`);
    found.text = text;
    found.buttons = buttons;
    found.edited = true;
  }

  async answerCallback(callbackId: string): Promise<void> {
    this.answered.push(callbackId);
  }

  get last(): BotMessage {
    const m = this.messages.at(-1);
    if (!m) throw new Error("Alfred has said nothing");
    return m;
  }
}

export interface TestApp {
  call: (method: string, path: string, options?: CallOptions) => Promise<Response>;
  sentEmails: { to: string; subject: string; text: string; html?: string }[];
  sentTelegram: { chatId: string; text: string }[];
  advance: (ms: number) => void;
  failTelegram: () => void;
  telegram: FakeTelegram;
}

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  ip?: string;
  csrf?: boolean;
  contentType?: string;
  headers?: Record<string, string>;
}

/** App with fake senders and a controllable clock. Each instance gets its own IP so rate limits do not collide. */
export function makeApp(): TestApp {
  let nowMs = START;
  let telegramFails = false;
  const telegram = new FakeTelegram();
  const sentEmails: TestApp["sentEmails"] = [];
  const sentTelegram: TestApp["sentTelegram"] = [];
  const notifiers: Notifiers = {
    async sendEmail(to, subject, text, html) {
      sentEmails.push({ to, subject, text, ...(html && { html }) });
    },
    async sendTelegram(chatId, text) {
      if (telegramFails) throw new Error("telegram down");
      sentTelegram.push({ chatId, text });
    },
  };
  const app = createApp({ notifiers: () => notifiers, telegram: () => telegram, now: () => nowMs });
  const defaultIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  return {
    sentEmails,
    sentTelegram,
    telegram,
    advance: (ms) => {
      nowMs += ms;
    },
    failTelegram: () => {
      telegramFails = true;
    },
    call: (method, path, options = {}) => {
      const headers: Record<string, string> = { "CF-Connecting-IP": options.ip ?? defaultIp };
      if (options.csrf !== false) headers["X-Requested-With"] = "fin";
      if (options.body !== undefined || method !== "GET") headers["Content-Type"] = options.contentType ?? "application/json";
      if (options.cookie) headers.Cookie = options.cookie;
      Object.assign(headers, options.headers);
      const init: RequestInit = { method, headers };
      if (options.body !== undefined) {
        init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
      }
      return Promise.resolve(app.request(path, init, env));
    },
  };
}

export const uniqueEmail = () => `${newId().toLowerCase()}@example.com`;

export async function registeredUser(email = uniqueEmail()): Promise<{ id: string; email: string }> {
  return { id: await createUser(email), email };
}

export async function linkTelegram(userId: string, chatId = `chat-${newId()}`): Promise<string> {
  await db.insert(telegramLinks).values({ userId, chatId, linkedAt: new Date().toISOString() });
  return chatId;
}

export const extractCode = (text: string): string => {
  const match = /\b(\d{6})\b/.exec(text);
  if (!match?.[1]) throw new Error(`No code in message: ${text}`);
  return match[1];
};

export const cookieFrom = (res: Response): string => {
  const header = res.headers.get("set-cookie") ?? "";
  const match = /(sid=[^;]*)/.exec(header);
  if (!match?.[1]) throw new Error(`No session cookie in: ${header}`);
  return match[1];
};

/** Requests a code by email and verifies it; returns the session cookie. */
export async function login(app: TestApp, email: string): Promise<string> {
  await app.call("POST", "/api/auth/request-code", { body: { email, channel: "email" } });
  const last = app.sentEmails.at(-1);
  if (!last) throw new Error("No email sent");
  const res = await app.call("POST", "/api/auth/verify-code", { body: { email, code: extractCode(last.text) } });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  return cookieFrom(res);
}
