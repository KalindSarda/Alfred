import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { botVoice } from "../alfred/botVoice";
import { daysBetween } from "../alfred/voice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { accounts, recurringRules, telegramLinks, users } from "../db/schema";
import { todayIst } from "../domain/dates";
import { logger } from "../utils/logger";
import { materializeAllRules, nextDue } from "./recurring";

export interface RecurringJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

export interface RecurringJobResult {
  /** Entries added. */
  added: number;
  /** Messages sent: drafts to confirm and reminders. */
  sent: number;
}

export async function chatsFor(db: Db): Promise<Map<string, string>> {
  const links = await db
    .select({ userId: telegramLinks.userId, chatId: telegramLinks.chatId })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .where(isNull(users.disabledAt));
  return new Map(links.map((l) => [l.userId, l.chatId]));
}

/**
 * The daily job for recurring rules: adds what has come due, asks about each draft (Confirm or Discard), and tells
 * people a day or more ahead when something is coming up. A message that fails to send is tried again next time:
 * drafts stay waiting in the app regardless, and a reminder is only marked once Telegram accepted it.
 */
export async function runRecurring(deps: RecurringJobDeps): Promise<RecurringJobResult> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const result: RecurringJobResult = { added: 0, sent: 0 };

  const { added, drafts } = await materializeAllRules(db, today, (error) => logger.error("recurring_user_failed", { error: error instanceof Error ? error.message : "unknown" }));
  result.added = added;
  const chats = await chatsFor(db);

  for (const d of drafts) {
    const chat = chats.get(d.userId);
    if (!chat) continue;
    try {
      await telegram.sendMessage(chat, botVoice.recurringDraft(d.title, d.amountPaise, d.accountName), [
        [{ text: "Confirm", data: `r:${d.txnId}:ok` }, { text: "Discard", data: `r:${d.txnId}:no` }],
      ]);
      result.sent += 1;
    } catch (error) {
      logger.error("recurring_draft_message_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }

  const due = await db
    .select({ rule: recurringRules, accountName: accounts.name })
    .from(recurringRules)
    .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .where(and(isNull(recurringRules.pausedAt), isNotNull(recurringRules.remindDaysBefore)));
  for (const { rule, accountName } of due) {
    const chat = chats.get(rule.userId);
    if (!chat || rule.remindDaysBefore === null) continue;
    try {
      const next = await nextDue(db, rule, today);
      if (!next || rule.lastRemindedFor === next || daysBetween(today, next) !== rule.remindDaysBefore) continue;
      await telegram.sendMessage(chat, botVoice.recurringReminder(rule.title, rule.amountPaise, accountName, next, rule.remindDaysBefore));
      await db.update(recurringRules).set({ lastRemindedFor: next }).where(eq(recurringRules.id, rule.id));
      result.sent += 1;
    } catch (error) {
      logger.error("recurring_reminder_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return result;
}
