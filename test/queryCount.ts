import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/index";
import type { Bindings } from "../src/config/env";
import { createDemoData } from "../src/services/demo";
import { FakeTelegram, linkTelegram } from "./api-helpers";
import { createUser, db } from "./helpers";
import { getDb } from "../src/db/client";

/**
 * Counting harness for the Workers Free query budget (50 D1 queries per invocation).
 *
 * It wraps the D1 binding and counts queries the way Cloudflare's D1 limits page describes them (confirmed from the docs on
 * 2026-11-26): each `prepare()` that is run on its own is one query, and a whole `batch()` call is ONE query however many
 * statements it holds. `strict` counts every statement, a batch's too, for comparison: a run that is under the limit on
 * `strict` is under it however the plan counts a batch.
 */
export interface QueryLog {
  /** Queries as Cloudflare counts them: a batch is one. */
  count: number;
  /** Every statement prepared, a batch's included. */
  strict: number;
  /** The SQL of every counted statement, in order (parameters are never recorded). */
  sql: string[];
}

export function countingD1(real: D1Database): { d1: D1Database; log: QueryLog } {
  const log: QueryLog = { count: 0, strict: 0, sql: [] };
  const d1 = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (query: string) => {
          log.count += 1;
          log.strict += 1;
          log.sql.push(query);
          return target.prepare(query);
        };
      }
      if (prop === "batch") {
        // The statements in a batch were counted when prepared; the batch itself is one query.
        return (statements: D1PreparedStatement[]) => {
          log.count -= Math.max(0, statements.length - 1);
          log.sql.push(`-- batch of ${statements.length}`);
          return target.batch(statements);
        };
      }
      if (prop === "exec") {
        return (query: string) => {
          log.count += 1;
          log.strict += 1;
          log.sql.push(query);
          return target.exec(query);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { d1, log };
}

/** A Db over the counting binding, for running one job on its own. */
export function countingDb(): { db: ReturnType<typeof getDb>; log: QueryLog } {
  const { d1, log } = countingD1(env.DB);
  return { db: getDb(d1), log };
}

/** Throwaway values: only used to satisfy the secrets check; nothing is ever sent anywhere. */
const TEST_SECRETS = {
  AUTH_HMAC_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef",
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  SMTP_HOST: "localhost",
  SMTP_PORT: "465",
  SMTP_USER: "test",
  SMTP_PASSWORD: "test",
  SMTP_FROM: "test@example.com",
  EMAIL_TRANSPORT: "console",
};

export interface ScheduledRun {
  /** D1 statements prepared by this one invocation. */
  queries: number;
  /** Every statement counted, a batch's too. */
  strict: number;
  sql: string[];
  /** Outbound fetches made (Telegram sends and price feeds), by host. */
  fetches: string[];
  /** Text of the messages Telegram was asked to send. */
  messages: string[];
}

/** Runs the Worker's `scheduled()` for one cron expression at the given instant and reports what it cost. */
export async function runScheduledCounted(cron: string, iso: string, hour = "05:00:00"): Promise<ScheduledRun> {
  const { d1, log } = countingD1(env.DB);
  const fetches: string[] = [];
  const messages: string[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetches.push(new URL(url).host);
    if (url.includes("api.telegram.org")) {
      try {
        messages.push((JSON.parse(String(init?.body)) as { text: string }).text);
      } catch {
        /* not a message */
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    // Price feeds: an empty answer, so a refresh counts its fetches and finds nothing to update.
    return new Response("", { status: 404 });
  });
  vi.stubGlobal("fetch", stub);
  const realNow = Date.now;
  Date.now = () => Date.parse(`${iso}T${hour}Z`);
  try {
    await worker.scheduled({ cron, scheduledTime: Date.now(), noRetry() {} } as ScheduledController, { ...(env as unknown as Bindings), ...TEST_SECRETS, DB: d1 } as Bindings);
  } finally {
    Date.now = realNow;
    vi.unstubAllGlobals();
  }
  return { queries: log.count, strict: log.strict, sql: log.sql, fetches, messages };
}

/** A user with the sample life loaded (accounts, rules, EMI, loan, holdings, debts, policies, goals) and a linked chat. */
export async function realisticUser(today: string): Promise<string> {
  const userId = await createUser();
  await createDemoData(db, userId, today);
  await linkTelegram(userId);
  return userId;
}

export { FakeTelegram };
