import { eq, inArray } from "drizzle-orm";
import { botVoice } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { accounts, emiPlans, transactions } from "../db/schema";
import { todayIst } from "../domain/dates";
import { logger } from "../utils/logger";
import { materializeEmiEntries } from "./emi";
import { chatsFor } from "./recurringJob";

export interface EmiJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/**
 * Adds every instalment whose statement date has come, for everyone, then asks each person whether the new ones agree
 * with the statement. Only instalments added by this run are asked about, so a plan created with past months does not
 * produce a flurry of questions. The question is best effort: a message that cannot be sent is not repeated.
 */
export async function runEmiCheckIns(deps: EmiJobDeps): Promise<{ added: number; asked: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const owners = await db.selectDistinct({ userId: emiPlans.userId }).from(emiPlans);
  const chats = await chatsFor(db);
  let added = 0;
  let asked = 0;

  for (const { userId } of owners) {
    try {
      const ids = await materializeEmiEntries(db, userId, today);
      added += ids.length;
      const chat = chats.get(userId);
      if (!chat || ids.length === 0) continue;
      const rows = await db
        .select({ id: transactions.id, amountPaise: transactions.amountPaise, n: transactions.emiInstalment, title: emiPlans.title, months: emiPlans.months, cardName: accounts.name })
        .from(transactions)
        .innerJoin(emiPlans, eq(emiPlans.id, transactions.emiPlanId))
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(inArray(transactions.id, ids.slice(0, 50)));
      for (const r of rows) {
        if (r.n === null) continue;
        try {
          await telegram.sendMessage(chat, botVoice.emiCheck(r.title, r.n, r.months, r.amountPaise, r.cardName), [
            [{ text: "Yes, it agrees", data: `e:${r.id}:y` }, { text: "Different amount", data: `e:${r.id}:d` }],
          ]);
          asked += 1;
        } catch (error) {
          logger.error("emi_check_send_failed", { error: error instanceof Error ? error.message : "unknown" });
        }
      }
    } catch (error) {
      logger.error("emi_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { added, asked };
}
