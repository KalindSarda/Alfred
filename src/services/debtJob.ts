import { and, eq } from "drizzle-orm";
import { botVoice } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { paidByDebt } from "../db/debts";
import { contacts, debts } from "../db/schema";
import { todayIst } from "../domain/dates";
import { followUpDue, outstandingPaise, repayReminderStage } from "../domain/debts";
import { logger } from "../utils/logger";
import { chatsFor } from "./recurringJob";

export interface DebtJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/**
 * Follows up on money lent (once the day has come, then every 14 days, never for a trusted person or one stopped), and
 * reminds you about money you borrowed the day before it is due and on the day. A message that fails to send is tried
 * again next time, because the day is only recorded once Telegram accepted it.
 */
export async function runDebtReminders(deps: DebtJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let sent = 0;

  const open = await db
    .select({ debt: debts, name: contacts.name, trusted: contacts.trusted })
    .from(debts)
    .innerJoin(contacts, eq(contacts.id, debts.contactId))
    .where(eq(debts.status, "open"));
  const paidByUser = new Map<string, Map<string, number>>();

  for (const { debt, name, trusted } of open) {
    const chat = chats.get(debt.userId);
    if (!chat) continue;
    try {
      let paid = paidByUser.get(debt.userId);
      if (!paid) paidByUser.set(debt.userId, (paid = await paidByDebt(db, debt.userId)));
      const left = outstandingPaise(debt.amountPaise, paid.get(debt.id) ?? 0);
      if (left <= 0) continue;

      if (debt.direction === "lent") {
        if (!followUpDue({ ...debt, trusted }, today)) continue;
        await telegram.sendMessage(chat, botVoice.followUp(name, left, debt.date, debt.dueDate), [
          [{ text: "Paid in full", data: `f:${debt.id}:p` }, { text: "Later", data: `f:${debt.id}:l` }, { text: "Stop following up", data: `f:${debt.id}:s` }],
        ]);
        await db.update(debts).set({ lastFollowupOn: today }).where(and(eq(debts.id, debt.id), eq(debts.userId, debt.userId)));
        sent += 1;
      } else {
        const stage = repayReminderStage(debt.dueDate, debt.remindStage, today);
        if (!stage || !debt.dueDate) continue;
        await telegram.sendMessage(chat, stage === 1 ? botVoice.repayTomorrow(name, left, debt.dueDate) : botVoice.repayToday(name, left, debt.dueDate, today > debt.dueDate));
        await db.update(debts).set({ remindStage: stage }).where(and(eq(debts.id, debt.id), eq(debts.userId, debt.userId)));
        sent += 1;
      }
    } catch (error) {
      logger.error("debt_reminder_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}
