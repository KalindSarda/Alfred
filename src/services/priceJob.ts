import { isNotNull } from "drizzle-orm";
import { priceRefreshText } from "../alfred/botVoice";
import type { TelegramApi } from "../bot/telegramApi";
import type { Db } from "../db/client";
import { checkinLog, holdingKinds, priceLinks } from "../db/schema";
import { todayIst } from "../domain/dates";
import { logger } from "../utils/logger";
import { newId, nowIso } from "../utils/id";
import type { FetchFn } from "./prices/feeds";
import { refreshPrices } from "./prices/refresh";
import { chatsFor } from "./recurringJob";
import { getSettings } from "./settings";
import { takeUsers } from "./userCap";

export interface PriceJobDeps {
  db: Db;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
  /** Where prices are fetched from; injectable so tests give it saved answers. */
  fetch: FetchFn;
}

/** Saturday, so the prices are Friday's close; the daily run only acts on that day. */
const SATURDAY = 6;

/**
 * Once a week, fetches the prices of everything a person has linked to a feed and, when they have Telegram linked, tells them what
 * changed. A person who turned it off in Settings is skipped. The week's claim is made first, so a second run the same day does
 * nothing; a failure for one person never stops the others.
 */
export async function runPriceRefresh(deps: PriceJobDeps): Promise<{ refreshed: number; sent: number }> {
  const { db, telegram } = deps;
  const today = todayIst(new Date(deps.now()));
  if (new Date(`${today}T00:00:00Z`).getUTCDay() !== SATURDAY) return { refreshed: 0, sent: 0 };

  const linked = await db.selectDistinct({ userId: priceLinks.userId }).from(priceLinks);
  const fed = await db.selectDistinct({ userId: holdingKinds.userId }).from(holdingKinds).where(isNotNull(holdingKinds.feed));
  // One person a run (USER_CAP.price): a refresh makes up to ~42 outside fetches, and Workers Free allows 50 an invocation. Someone left
  // out is refreshed on a later Saturday run: the weekly claim below is only made for the person actually refreshed.
  const owners = takeUsers(db, "price", [...new Set([...linked, ...fed].map((o) => o.userId))], (id) => id, today, 7);
  const chats = await chatsFor(db);
  let refreshed = 0;
  let sent = 0;
  for (const userId of owners) {
    try {
      if (!(await getSettings(db, userId)).priceRefresh) continue;
      const claimed = await db.insert(checkinLog).values({ id: newId(), userId, kind: "prices", day: today, createdAt: nowIso() }).onConflictDoNothing().returning({ id: checkinLog.id });
      if (claimed.length === 0) continue;
      const result = await refreshPrices(db, userId, today, deps.fetch);
      refreshed += 1;
      const chat = chats.get(userId);
      const text = priceRefreshText(result);
      if (chat && text) {
        await telegram.sendMessage(chat, text);
        sent += 1;
      }
    } catch (error) {
      logger.error("price_refresh_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { refreshed, sent };
}
