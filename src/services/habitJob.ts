import { and, eq, gte, isNull } from "drizzle-orm";
import { botVoice, usualLabel } from "../alfred/botVoice";
import { daysBetween } from "../alfred/voice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { checkinLog, transactions } from "../db/schema";
import { addDays, todayIst } from "../domain/dates";
import { shouldNudge, silentDaysSince, usualItems } from "../domain/habits";
import { weekdayOf } from "../domain/recurring";
import { newId, nowIso } from "../utils/id";
import { logger } from "../utils/logger";
import { lastLoggedDate, recentManualEntries } from "./habit";
import { listAccountsWithFigures } from "./ledger";
import { chatsFor } from "./recurringJob";
import { getSettings } from "./settings";

/** 17:15 UTC is 22:45 in India: late enough that the day's spending is done. */
export const EVENING_CRON = "15 17 * * *";

export interface HabitJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

/** Claims a night for a kind of message; false when it was already sent (a retried run). */
async function claim(db: Db, userId: string, kind: "evening" | "balance", day: string): Promise<boolean> {
  const rows = await db.insert(checkinLog).values({ id: newId(), userId, kind, day, createdAt: nowIso() }).onConflictDoNothing().returning({ id: checkinLog.id });
  return rows.length > 0;
}

/** The weekly check: one message per bank account that has been used in the last two weeks. */
async function askBalances(deps: HabitJobDeps, userId: string, chat: string, today: string): Promise<number> {
  const { db, telegram } = deps;
  const since = addDays(today, -14);
  const [figures, active] = await Promise.all([
    listAccountsWithFigures(db, userId, today),
    db
      .select({ a: transactions.accountId, b: transactions.toAccountId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed"), gte(transactions.txnDate, since))),
  ]);
  const used = new Set(active.flatMap((r) => [r.a, r.b].filter((x): x is string => x !== null)));
  let asked = 0;
  for (const a of figures) {
    if (a.kind !== "bank" || a.archivedAt || !used.has(a.id)) continue;
    try {
      await telegram.sendMessage(chat, botVoice.balanceAsk(a.name, a.balancePaise), [[{ text: "Yes, it matches", data: `b:${a.id}:y` }, { text: "Different", data: `b:${a.id}:d` }]]);
      asked += 1;
    } catch (error) {
      logger.error("balance_check_send_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return asked;
}

/**
 * The late-evening job (about 22:45 IST). Sundays: the weekly balance check. Other nights: when nothing has been logged
 * today, a gentle check-in with the person's usual spends as buttons; firmer after two silent days, and eased off
 * after four (see `shouldNudge`). Best effort: one person failing never stops the others, and a message that cannot be
 * sent is not repeated.
 */
export async function runEveningCheckIns(deps: HabitJobDeps): Promise<{ nudged: number; balanceAsks: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const sunday = weekdayOf(today) === 7;
  const chats = await chatsFor(db);
  let nudged = 0;
  let balanceAsks = 0;

  for (const [userId, chat] of chats) {
    try {
      const settings = await getSettings(db, userId);
      if (sunday && settings.balanceCheck) {
        if (await claim(db, userId, "balance", today)) balanceAsks += await askBalances(deps, userId, chat, today);
        continue;
      }
      if (!settings.logNudge) continue;
      if (settings.logNudgeUntil && today <= settings.logNudgeUntil) continue;
      const last = await lastLoggedDate(db, userId);
      const silent = silentDaysSince(last, today);
      if (last === null || silent === null || !shouldNudge(silent)) continue;
      if (!(await claim(db, userId, "evening", today))) continue;

      const usual = usualItems(await recentManualEntries(db, userId, today), today);
      const buttons = [...usual.map((u) => [{ text: usualLabel(u.name, u.amountPaise), data: `y:${u.templateId}` }]), [{ text: "Nothing today", data: "z:n" }, { text: "Pause a week", data: "z:p" }]];
      const text = silent >= 2 ? botVoice.eveningSilent(daysBetween(last, today), last) : botVoice.eveningNone;
      try {
        await telegram.sendMessage(chat, text, buttons);
        nudged += 1;
      } catch (error) {
        logger.error("evening_nudge_send_failed", { error: error instanceof Error ? error.message : "unknown" });
      }
    } catch (error) {
      logger.error("evening_user_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { nudged, balanceAsks };
}
