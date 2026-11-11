import { botVoice } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { addDays, todayIst } from "../domain/dates";
import { cardCycle } from "../domain/cards";
import { logger } from "../utils/logger";
import { hasCheck, recordCheck, statementFacts } from "./cardTools";
import { listAccountsWithFigures, toLedgerAccount } from "./ledger";
import { chatsFor } from "./recurringJob";

export interface StatementJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/** A statement is asked about for this many days after it is generated, and never later, so an old one is not dug up. */
export const ASK_WITHIN_DAYS = 5;

/**
 * The day after a card's statement is generated, asks what it says, giving what Alfred made it. Once per card and
 * statement: a check made in the app counts too. Best effort: a message that cannot be sent is not repeated.
 */
export async function runStatementChecks(deps: StatementJobDeps): Promise<{ asked: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let asked = 0;

  for (const [userId, chat] of chats) {
    try {
      const figures = await listAccountsWithFigures(db, userId, today);
      for (const a of figures) {
        if (a.kind !== "card" || a.archivedAt) continue;
        const { lastStatementDate } = cardCycle(toLedgerAccount(a) as Parameters<typeof cardCycle>[0], today);
        if (lastStatementDate >= today || lastStatementDate < addDays(today, -ASK_WITHIN_DAYS)) continue;
        if (await hasCheck(db, userId, a.id, lastStatementDate)) continue;
        const facts = await statementFacts(db, userId, a.id, today);
        if (facts.expectedPaise <= 0) continue;
        // Claimed before sending, so a retried run never asks twice.
        await recordCheck(db, userId, a.id, lastStatementDate, facts.expectedPaise, null, "asked");
        try {
          await telegram.sendMessage(chat, botVoice.statementAsk(a.name, lastStatementDate, facts.expectedPaise), [
            [{ text: "Yes, it matches", data: `s:${a.id}:y:${lastStatementDate}` }, { text: "Different", data: `s:${a.id}:d:${lastStatementDate}` }],
          ]);
          asked += 1;
        } catch (error) {
          logger.error("statement_ask_send_failed", { error: error instanceof Error ? error.message : "unknown" });
        }
      }
    } catch (error) {
      logger.error("statement_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { asked };
}
