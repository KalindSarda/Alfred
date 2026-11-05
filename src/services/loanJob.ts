import { eq, inArray } from "drizzle-orm";
import { botVoice } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { accounts, loans } from "../db/schema";
import { todayIst } from "../domain/dates";
import { logger } from "../utils/logger";
import { materializeLoansFor } from "./loans";
import { chatsFor } from "./recurringJob";

export interface LoanJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/**
 * Adds every loan instalment whose due date has come, for everyone, then asks each person whether the new ones agree
 * with the bank. Only instalments this run added are asked about, so a loan created with earlier months does not
 * produce a flurry of questions. The question is best effort: a message that cannot be sent is not repeated.
 */
export async function runLoanCheckIns(deps: LoanJobDeps): Promise<{ added: number; asked: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const owners = await db.selectDistinct({ userId: loans.userId }).from(loans).where(eq(loans.status, "active"));
  const chats = await chatsFor(db);
  let added = 0;
  let asked = 0;

  for (const { userId } of owners) {
    try {
      const made = await materializeLoansFor(db, userId, today);
      added += made.length;
      const chat = chats.get(userId);
      if (!chat || made.length === 0) continue;
      const ids = [...new Set(made.map((m) => m.loanId))];
      const info = await db
        .select({ id: loans.id, name: loans.name, accountName: accounts.name })
        .from(loans)
        .innerJoin(accounts, eq(accounts.id, loans.accountId))
        .where(inArray(loans.id, ids));
      const byId = new Map(info.map((i) => [i.id, i]));
      for (const m of made) {
        const loan = byId.get(m.loanId);
        if (!loan) continue;
        try {
          await telegram.sendMessage(chat, botVoice.loanCheck(loan.name, m.totalPaise, m.interestPaise, m.principalPaise, loan.accountName), [
            [{ text: "Yes, it agrees", data: `l:${m.loanId}:y:${m.loanOn}` }, { text: "Different amount", data: `l:${m.loanId}:d:${m.loanOn}` }],
          ]);
          asked += 1;
        } catch (error) {
          logger.error("loan_check_send_failed", { error: error instanceof Error ? error.message : "unknown" });
        }
      }
    } catch (error) {
      logger.error("loan_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { added, asked };
}
