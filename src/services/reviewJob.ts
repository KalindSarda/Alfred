import { monthlyReviewLines } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { and, eq, gte, inArray } from "drizzle-orm";
import { checkinLog } from "../db/schema";
import { addDays, cycleRange, todayIst } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { getEmergencyFund } from "./emergency";
import { getFire } from "./fire";
import { getLadder, type LadderView } from "./ladder";
import { getHealth } from "./health";
import { chatsFor } from "./recurringJob";
import { getSettingsMany } from "./settings";
import { takeUsers } from "./userCap";

import type { FireView } from "./fire";

/** What the review message needs from the FIRE view. */
export function fireFacts(v: FireView) {
  return { numberPaise: v.numberPaise, progressPct: v.progressPct, corpusPaise: v.corpus.totalPaise, projection: v.projection };
}

/** The foundation that needs attention, for the review message. */
export function focusFacts(l: LadderView): { title: string; detail: string } | null {
  return l.attention ? { title: l.attention.title, detail: l.attention.detail } : null;
}

export interface ReviewJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/** A review the cap left for later can still be sent for this many days after the month-start day. */
export const REVIEW_CATCH_UP_DAYS = 2;

/**
 * On the first morning of each of the person's months (their month-start day, usually payday), one message about the month
 * that has just ended: what came in, what went out, what was saved and a few ratios. Nothing is sent for a month with no
 * income and no spending, or to someone who switched it off. Once per month, claimed before sending. Best effort.
 *
 * The review is heavy, so only USER_CAP.review people get one per run. Who is due is worked out for everyone first, from one
 * read of their settings. People left out by the cap get a `review_pending` mark for their month-start day, and the daily
 * run sends them their review on one of the next REVIEW_CATCH_UP_DAYS days (the claim is on the month-start day, so it is
 * still once per month). Only a marked person is ever sent late: an empty month stays unsent as before.
 */
export async function runMonthlyReview(deps: ReviewJobDeps): Promise<{ sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const chats = await chatsFor(db);
  let sent = 0;

  const settingsOf = await getSettingsMany(db, [...chats.keys()]);
  const candidates: { userId: string; chat: string; day: string }[] = [];
  const maybeLate: string[] = [];
  for (const [userId, chat] of chats) {
    const s = settingsOf.get(userId);
    if (!s || !s.monthlyReview) continue;
    const from = cycleRange(today, s.periodStartDay).from;
    if (from === today) candidates.push({ userId, chat, day: today });
    else if (from >= addDays(today, -REVIEW_CATCH_UP_DAYS)) maybeLate.push(userId);
  }
  if (maybeLate.length > 0) {
    // Marked people whose review has not gone yet. Only looked for in the first days of someone's month.
    const marked = await db
      .select({ userId: checkinLog.userId, day: checkinLog.day })
      .from(checkinLog)
      .where(and(eq(checkinLog.kind, "review_pending"), inArray(checkinLog.userId, maybeLate.slice(0, 90)), gte(checkinLog.day, addDays(today, -REVIEW_CATCH_UP_DAYS))));
    const sentAlready = marked.length === 0 ? [] : await db.select({ userId: checkinLog.userId, day: checkinLog.day }).from(checkinLog).where(and(eq(checkinLog.kind, "review"), inArray(checkinLog.userId, marked.map((m) => m.userId)), gte(checkinLog.day, addDays(today, -REVIEW_CATCH_UP_DAYS))));
    const gone = new Set(sentAlready.map((r) => `${r.userId}|${r.day}`));
    for (const m of marked) {
      const chat = chats.get(m.userId);
      if (chat && !gone.has(`${m.userId}|${m.day}`)) candidates.push({ userId: m.userId, chat, day: m.day });
    }
  }

  const chosen = takeUsers(db, "review", candidates, (c) => c.userId, today);
  const left = candidates.filter((c) => c.day === today && !chosen.includes(c));
  if (left.length > 0) {
    await db.insert(checkinLog).values(left.map((c) => ({ id: newId(), userId: c.userId, kind: "review_pending" as const, day: c.day, createdAt: nowIso() }))).onConflictDoNothing();
  }

  for (const { userId, chat, day } of chosen) {
    try {
      const view = await getHealth(db, userId, today, "last");
      if (view.empty) continue;
      const claimed = await db.insert(checkinLog).values({ id: newId(), userId, kind: "review", day, createdAt: nowIso() }).onConflictDoNothing().returning({ id: checkinLog.id });
      if (claimed.length === 0) continue;
      try {
        await telegram.sendMessage(chat, monthlyReviewLines({ ...view, from: view.period.from, to: view.period.to, emergency: await getEmergencyFund(db, userId, today), fire: fireFacts(await getFire(db, userId, today)), focus: focusFacts(await getLadder(db, userId, today)) }).join("\n"));
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
