import { and, eq, isNull } from "drizzle-orm";
import { valueNudge } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { holdingKinds, holdings, transactions } from "../db/schema";
import { todayIst } from "../domain/dates";
import { logger } from "../utils/logger";
import { botVoice } from "../alfred/botVoice";
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

/** What a unit is called when asking about a quantity: "g" is spoken as grams. */
export const unitWord = (unit: string | null): string => (unit === "g" ? "grams" : unit === "kg" ? "kilograms" : (unit ?? "units"));

/**
 * The question to ask about a confirmed purchase into a holding counted by quantity that has no quantity yet, with the
 * word for its unit; null when there is nothing to ask (another kind of holding, a quantity already given, a draft).
 */
export async function unitsQuestionFor(db: Db, userId: string, txnId: string): Promise<{ text: string; word: string } | null> {
  const [row] = await db
    .select({ amountPaise: transactions.amountPaise, name: holdings.name, unit: holdingKinds.unit })
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .leftJoin(holdingKinds, and(eq(holdingKinds.userId, holdings.userId), eq(holdingKinds.key, holdings.kind)))
    .where(
      and(
        eq(transactions.id, txnId),
        eq(transactions.userId, userId),
        eq(transactions.type, "investment"),
        eq(transactions.status, "confirmed"),
        isNull(transactions.deletedAt),
        isNull(transactions.unitsE4),
        eq(holdings.tracking, "units"),
        eq(holdings.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const word = unitWord(row.unit);
  return { text: botVoice.unitsAsk(row.name, row.amountPaise, word), word };
}

/**
 * A SIP or other recurring purchase that went into a holding counted by quantity on its own, today, has no quantity.
 * Asks once, on the day, with a button; the person's next message is then read as the quantity. A draft is asked about
 * when it is confirmed instead.
 */
export async function runUnitsCheckIns(deps: HoldingsJobDeps): Promise<{ asked: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  const due = await db
    .select({ id: transactions.id, userId: transactions.userId })
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(and(eq(transactions.source, "recurring"), eq(transactions.txnDate, today), eq(holdings.tracking, "units")));
  const chats = await chatsFor(db);
  let asked = 0;
  for (const t of due) {
    const chat = chats.get(t.userId);
    if (!chat) continue;
    try {
      const question = await unitsQuestionFor(db, t.userId, t.id);
      if (!question) continue;
      await telegram.sendMessage(chat, question.text, [[{ text: "Tell me", data: `q:${t.id}` }]]);
      asked += 1;
    } catch (error) {
      logger.error("units_check_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { asked };
}
