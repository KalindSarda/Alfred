import { and, eq, inArray } from "drizzle-orm";
import { morningPushLines } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { checkinLog, salaryLog } from "../db/schema";
import { addDays, todayIst } from "../domain/dates";
import { pushLines } from "../domain/salaryPlan";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { getBriefing } from "./alfred";
import { chatsFor } from "./recurringJob";
import { buildSalaryPlan, salaryEntries } from "./salary";
import { getSettings } from "./settings";

export interface PlanJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/** A salary credit is planned for if it is dated within this many days. */
export const PLAN_WITHIN_DAYS = 3;

/**
 * When a salary credit has arrived that has not been planned for, sends the salary day plan: what is still to leave before
 * the next salary, what is free to spend, and goals that want money. Once per credit; older ones are marked without a
 * message so a long-ago salary is never planned late. Best effort: a message that cannot be sent is not repeated.
 */
export async function runSalaryPlans(deps: PlanJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let sent = 0;

  for (const [userId, chat] of chats) {
    try {
      const entries = await salaryEntries(db, userId, addDays(today, -PLAN_WITHIN_DAYS), today);
      if (entries.length === 0) continue;
      const done = await db.select({ txnId: salaryLog.txnId }).from(salaryLog).where(and(eq(salaryLog.userId, userId), inArray(salaryLog.txnId, entries.map((e) => e.id))));
      const seen = new Set(done.map((d) => d.txnId));
      const fresh = entries.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) continue;
      // Claimed before sending, so a retried run never plans twice.
      for (const e of fresh) await db.insert(salaryLog).values({ id: newId(), userId, txnId: e.id, sentAt: nowIso() }).onConflictDoNothing();
      const plan = await buildSalaryPlan(db, userId, today, fresh[0] ?? null, { chatId: chat, nowMs: deps.now() });
      try {
        await telegram.sendMessage(chat, plan.text, plan.buttons.length > 0 ? plan.buttons : undefined);
        sent += 1;
      } catch (error) {
        logger.error("salary_plan_send_failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    } catch (error) {
      logger.error("salary_plan_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}

/**
 * The morning briefing on Telegram, for people who switched it on: the greeting, what is available, and the things that
 * need attention. On a quiet day there is nothing to say, so nothing is sent. Once a day, best effort.
 */
export async function runMorningPush(deps: PlanJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const now = new Date(deps.now());
  const today = todayIst(now);
  const chats = await chatsFor(db);
  let sent = 0;

  for (const [userId, chat] of chats) {
    try {
      const settings = await getSettings(db, userId);
      if (!settings.morningPush) continue;
      const briefing = await getBriefing(db, userId, today, now, { compact: false });
      const attention = pushLines(briefing.lines);
      if (attention.length === 0) continue;
      const claimed = await db.insert(checkinLog).values({ id: newId(), userId, kind: "morning", day: today, createdAt: nowIso() }).onConflictDoNothing().returning({ id: checkinLog.id });
      if (claimed.length === 0) continue;
      const safe = briefing.lines.find((l) => l.key === "position")?.text ?? null;
      try {
        await telegram.sendMessage(chat, morningPushLines(briefing.greeting, safe, attention.map((l) => l.text)).join("\n"));
        sent += 1;
      } catch (error) {
        logger.error("morning_push_send_failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    } catch (error) {
      logger.error("morning_push_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}
