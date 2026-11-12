import { monthlyReviewLines } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { checkinLog } from "../db/schema";
import { cycleRange, todayIst } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { getEmergencyFund } from "./emergency";
import { getFire } from "./fire";
import { getHealth } from "./health";
import { chatsFor } from "./recurringJob";
import { getSettings } from "./settings";

import type { FireView } from "./fire";

/** What the review message needs from the FIRE view. */
export function fireFacts(v: FireView) {
  return { numberPaise: v.numberPaise, progressPct: v.progressPct, corpusPaise: v.corpus.totalPaise, projection: v.projection };
}

export interface ReviewJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/**
 * On the first morning of each of the person's months (their month-start day, usually payday), one message about the month
 * that has just ended: what came in, what went out, what was saved and a few ratios. Nothing is sent for a month with no
 * income and no spending, or to someone who switched it off. Once per month, claimed before sending. Best effort.
 */
export async function runMonthlyReview(deps: ReviewJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let sent = 0;

  for (const [userId, chat] of chats) {
    try {
      const settings = await getSettings(db, userId);
      if (!settings.monthlyReview || cycleRange(today, settings.periodStartDay).from !== today) continue;
      const view = await getHealth(db, userId, today, "last");
      if (view.empty) continue;
      const claimed = await db.insert(checkinLog).values({ id: newId(), userId, kind: "review", day: today, createdAt: nowIso() }).onConflictDoNothing().returning({ id: checkinLog.id });
      if (claimed.length === 0) continue;
      try {
        await telegram.sendMessage(chat, monthlyReviewLines({ ...view, from: view.period.from, to: view.period.to, emergency: await getEmergencyFund(db, userId, today), fire: fireFacts(await getFire(db, userId, today)) }).join("\n"));
        sent += 1;
      } catch (error) {
        logger.error("monthly_review_send_failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    } catch (error) {
      logger.error("monthly_review_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent };
}
