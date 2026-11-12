import { renewalReminder } from "../alfred/botVoice";
import { daysBetween } from "../alfred/voice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { insuranceReminders } from "../db/schema";
import { todayIst } from "../domain/dates";
import { RENEWAL_LEAD_DAYS } from "../domain/protection";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { listPolicies } from "./protection";
import { chatsFor } from "./recurringJob";

export interface InsuranceJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/**
 * A week before a personal policy's premium or renewal date, and again on the day it is due, tells the person it is coming.
 * Each date is reminded once at each of those points (claimed before sending, so a retried run never doubles it). Cover through
 * work, lapsed policies and people who have not linked Telegram are left out. Best effort.
 */
export async function runInsuranceReminders(deps: InsuranceJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let sent = 0;

  for (const [userId, chat] of chats) {
    try {
      for (const p of await listPolicies(db, userId, today)) {
        if (p.status !== "active" || p.source !== "personal" || p.daysToDue > RENEWAL_LEAD_DAYS) continue;
        // One reminder when it comes within a week, and one on the day itself.
        const stage = p.daysToDue === 0 ? `${p.nextDueDate}:day` : p.nextDueDate;
        const claimed = await db
          .insert(insuranceReminders)
          .values({ id: newId(), userId, policyId: p.id, dueDate: stage, sentAt: nowIso() })
          .onConflictDoNothing()
          .returning({ id: insuranceReminders.id });
        if (claimed.length === 0) continue;
        try {
          await telegram.sendMessage(chat, renewalReminder({ insurer: p.insurer, kind: p.kind, premiumPaise: p.premiumPaise, dueDate: p.nextDueDate, days: daysBetween(today, p.nextDueDate) }));
          sent += 1;
        } catch (error) {
          logger.error("insurance_reminder_send_failed", { error: error instanceof Error ? error.message : "unknown" });
        }
      }
    } catch (error) {
      logger.error("insurance_reminders_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}
