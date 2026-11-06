import { botVoice } from "../alfred/botVoice";
import { daysBetween, inDays } from "../alfred/voice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { mandateAlerts } from "../db/schema";
import { shortfalls } from "../domain/commitments";
import { addDays, todayIst } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { collectCommitments } from "./commitments";
import { listAccountsWithFigures } from "./ledger";
import { chatsFor } from "./recurringJob";

export interface MandateJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/** How far ahead a debit is checked: today and the two days after. */
export const MANDATE_DAYS = 2;

/**
 * Looks at the bank debits due today and in the next two days (rent, a loan EMI, a SIP) and tells people when the account
 * would not cover one. Each thing due is warned about once per date. Best effort: a message that cannot be sent is not
 * repeated, and one person failing never stops the others.
 */
export async function runMandateChecks(deps: MandateJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let sent = 0;

  for (const [userId, chat] of chats) {
    try {
      const [items, figures] = await Promise.all([collectCommitments(db, userId, today, addDays(today, MANDATE_DAYS + 1), today), listAccountsWithFigures(db, userId, today)]);
      const available = new Map(figures.flatMap((a) => (a.kind === "bank" ? [[a.id, a.balancePaise - a.blockedPaise] as const] : [])));
      for (const s of shortfalls(items, available)) {
        const c = s.commitment;
        const claimed = await db
          .insert(mandateAlerts)
          .values({ id: newId(), userId, key: c.key, dueDate: c.date, sentAt: nowIso() })
          .onConflictDoNothing()
          .returning({ id: mandateAlerts.id });
        if (claimed.length === 0) continue;
        try {
          await telegram.sendMessage(chat, botVoice.mandateShort(c.title, c.amountPaise, c.accountName ?? "the account", inDays(daysBetween(today, c.date)), s.balancePaise, s.shortByPaise));
          sent += 1;
        } catch (error) {
          logger.error("mandate_alert_send_failed", { error: error instanceof Error ? error.message : "unknown" });
        }
      }
    } catch (error) {
      logger.error("mandate_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}
