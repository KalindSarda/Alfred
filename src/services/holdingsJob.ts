import { eq } from "drizzle-orm";
import { valueNudge } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { holdings } from "../db/schema";
import { todayIst } from "../domain/dates";
import { logger } from "../utils/logger";
import { listHoldings } from "./holdings";
import { chatsFor } from "./recurringJob";

export interface HoldingsJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/**
 * On the first of the month, asks each person with investments to refresh what they are worth, listing them with how old
 * each value is. On any other day it does nothing, so the daily run needs no memory of having asked. Best effort: a
 * message that cannot be sent is not repeated.
 */
export async function runHoldingNudges(deps: HoldingsJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  if (today.slice(8, 10) !== "01") return { sent: 0 };
  const owners = await db.selectDistinct({ userId: holdings.userId }).from(holdings).where(eq(holdings.status, "active"));
  const chats = await chatsFor(db);
  let sent = 0;
  for (const { userId } of owners) {
    const chat = chats.get(userId);
    if (!chat) continue;
    try {
      const { holdings: active } = await listHoldings(db, userId, today, "active");
      if (active.length === 0) continue;
      await telegram.sendMessage(chat, valueNudge(active));
      sent += 1;
    } catch (error) {
      logger.error("holding_nudge_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}
