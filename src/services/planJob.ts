import { and, eq, inArray } from "drizzle-orm";
import { botVoice, morningPushLines } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { checkinLog, salaryLog } from "../db/schema";
import { addDays, todayIst } from "../domain/dates";
import { pushLines } from "../domain/salaryPlan";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { getAllowance } from "./allowance";
import { getBriefing } from "./alfred";
import { chatsFor } from "./recurringJob";
import { buildSalaryPlan, unplannedSalaryByUser } from "./salary";
import { getSettings, getSettingsMany } from "./settings";
import { takeUsers } from "./userCap";

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

  // Who has an unplanned salary is found for everyone in two queries, and only those people count against the per-run cap.
  // A salary stays plannable for PLAN_WITHIN_DAYS, so someone left out today is first in line again on the next runs.
  const waiting = await unplannedSalaryByUser(db, [...chats.keys()], addDays(today, -PLAN_WITHIN_DAYS), today);
  for (const [userId, fresh] of takeUsers(db, "salary", [...waiting], ([id]) => id, today)) {
    const chat = chats.get(userId);
    if (!chat) continue;
    try {
      // Claimed before sending, so a retried run never plans twice.
      await db.insert(salaryLog).values(fresh.map((e) => ({ id: newId(), userId, txnId: e.id, sentAt: nowIso() }))).onConflictDoNothing();
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

  // The people with the briefing switched on are found in one query; only they count against the per-run cap. A day's briefing
  // that is left out is not sent late: it is a once-a-day message, and the next day's window moves on to the others.
  const settingsOf = await getSettingsMany(db, [...chats.keys()]);
  const wanting = [...chats].filter(([id]) => settingsOf.get(id)?.morningPush === true);
  for (const [userId, chat] of takeUsers(db, "push", wanting, ([id]) => id, today)) {
    try {
      const briefing = await getBriefing(db, userId, today, now, { compact: false });
      const attention = pushLines(briefing.lines);
      if (attention.length === 0) continue;
      const claimed = await db.insert(checkinLog).values({ id: newId(), userId, kind: "morning", day: today, createdAt: nowIso() }).onConflictDoNothing().returning({ id: checkinLog.id });
      if (claimed.length === 0) continue;
      let safe = briefing.lines.find((l) => l.key === "position")?.text ?? null;
      // The week's allowance rides along, when there is one; a failure here must not stop the briefing.
      try {
        const a = await getAllowance(db, userId, today);
        if (a.week) safe = [safe, botVoice.weekSummary(a.week, a.pace?.aheadPaise ?? null, a.streak.current)].filter(Boolean).join("\n");
      } catch (error) {
        logger.error("morning_allowance_failed", { error: error instanceof Error ? error.message : "unknown" });
      }
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
