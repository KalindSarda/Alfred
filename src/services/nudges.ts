import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { botVoice, cardReminder, type ReminderCard } from "../alfred/botVoice";
import { daysBetween } from "../alfred/voice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { accounts, holds, nudgeLog, telegramLinks, users } from "../db/schema";
import { todayIst } from "../domain/dates";
import { newId } from "../utils/id";
import { logger } from "../utils/logger";
import { balanceOverview } from "./accounts";
import { listAccountsWithFigures } from "./ledger";
import { getSettings } from "./settings";

/** What the counted accounts could pay a card with right now: their balances less any blocked amounts. */
function availableToPay(figures: Parameters<typeof balanceOverview>[0]): number {
  const o = balanceOverview(figures);
  return o.countedPaise - o.blockedPaise;
}

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

  const links = await db
    .select({ userId: telegramLinks.userId, chatId: telegramLinks.chatId })
    .from(telegramLinks)
    .innerJoin(users, eq(users.id, telegramLinks.userId))
    .where(isNull(users.disabledAt));
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
      await telegram.sendMessage(link.chatId, cardReminder(candidates, availableToPay(figures)));

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

export interface HoldReminderResult {
  /** Messages sent. */
  sent: number;
}

/**
 * Asks about each blocked application whose outcome has come due: "Was it allotted?", with the two answers as
 * buttons. One message per application, once. A message that fails to send is not marked, so it is tried again.
 */
export async function runHoldReminders(deps: NudgeDeps): Promise<HoldReminderResult> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const result: HoldReminderResult = { sent: 0 };

  const due = await db
    .select({ hold: holds, accountName: accounts.name, chatId: telegramLinks.chatId })
    .from(holds)
    .innerJoin(accounts, eq(accounts.id, holds.accountId))
    .innerJoin(telegramLinks, eq(telegramLinks.userId, holds.userId))
    .innerJoin(users, eq(users.id, holds.userId))
    .where(and(eq(holds.status, "active"), isNull(holds.remindedOn), isNotNull(holds.expectedDate), lte(holds.expectedDate, today), isNull(users.disabledAt)));

  for (const { hold, accountName, chatId } of due) {
    try {
      await telegram.sendMessage(chatId, botVoice.holdDue(hold.title, hold.amountPaise, accountName), [
        [{ text: "Allotted", data: `h:${hold.id}:a` }, { text: "Not allotted", data: `h:${hold.id}:n` }],
      ]);
      await db.update(holds).set({ remindedOn: today }).where(eq(holds.id, hold.id));
      result.sent += 1;
    } catch (error) {
      logger.error("hold_reminder_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return result;
}
