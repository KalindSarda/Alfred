import { and, eq } from "drizzle-orm";
import { cardReminder, type ReminderCard } from "../alfred/botVoice";
import { daysBetween } from "../alfred/voice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { nudgeLog, telegramLinks } from "../db/schema";
import { todayIst } from "../domain/dates";
import { newId } from "../utils/id";
import { logger } from "../utils/logger";
import { balanceOverview } from "./accounts";
import { listAccountsWithFigures } from "./ledger";
import { getSettings } from "./settings";

export interface NudgeDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

export interface NudgeResult {
  /** Messages sent. */
  sent: number;
  /** Card payments announced across those messages. */
  announced: number;
}

/**
 * Tells each linked user about card payments that fall due within their reminder window, once per due date.
 *
 * Safe to run as often as you like: every announcement is logged, so a repeat run says nothing new, and a run that
 * was missed catches up the next day while the payment is still ahead. A message that fails to send is not logged,
 * so it is tried again on the next run. Payments already paid (nothing outstanding) are never mentioned.
 */
export async function runNudges(deps: NudgeDeps): Promise<NudgeResult> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const result: NudgeResult = { sent: 0, announced: 0 };

  const links = await db.select().from(telegramLinks);
  for (const link of links) {
    try {
      const settings = await getSettings(db, link.userId);
      const figures = await listAccountsWithFigures(db, link.userId, today);

      const candidates: ReminderCard[] = [];
      const cardIds: { id: string; dueDate: string }[] = [];
      for (const a of figures) {
        if (a.kind !== "card" || a.summary.statementOutstandingPaise <= 0) continue;
        const daysAway = daysBetween(today, a.summary.nextDueDate);
        if (daysAway < 0 || daysAway > settings.nudgeLeadDays) continue;

        const [already] = await db
          .select({ id: nudgeLog.id })
          .from(nudgeLog)
          .where(and(eq(nudgeLog.userId, link.userId), eq(nudgeLog.cardAccountId, a.id), eq(nudgeLog.dueDate, a.summary.nextDueDate)))
          .limit(1);
        if (already) continue;

        candidates.push({ name: a.name, amountPaise: a.summary.statementOutstandingPaise, dueDate: a.summary.nextDueDate, daysAway });
        cardIds.push({ id: a.id, dueDate: a.summary.nextDueDate });
      }
      if (candidates.length === 0) continue;

      candidates.sort((x, y) => x.dueDate.localeCompare(y.dueDate));
      await telegram.sendMessage(link.chatId, cardReminder(candidates, balanceOverview(figures).countedPaise));

      // Logged only after Telegram accepted the message.
      const sentAt = new Date(deps.now()).toISOString();
      for (const card of cardIds) {
        await db
          .insert(nudgeLog)
          .values({ id: newId(), userId: link.userId, cardAccountId: card.id, dueDate: card.dueDate, sentAt })
          .onConflictDoNothing();
      }
      result.sent += 1;
      result.announced += candidates.length;
    } catch (error) {
      // One user's failure must not stop the others; the unlogged reminder is retried on the next run.
      logger.error("nudge_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return result;
}
