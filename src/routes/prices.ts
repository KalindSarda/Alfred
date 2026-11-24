import { and, count, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ConflictError } from "../config/errors";
import { appSettings, holdingKinds, priceLinks } from "../db/schema";
import { LinkPrice, PreviewQuery, SuggestQuery } from "../schemas/price";
import { enforceRateLimit } from "../services/rateLimit";
import { FeedError } from "../services/prices/feeds";
import { linkPrice, previewKindFeed, refreshPrices, suggestMatches, unlinkPrice } from "../services/prices/refresh";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

/** A price feed that failed is the feed's trouble, not a bad request: say so plainly. */
async function viaFeed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FeedError) throw new ConflictError(`Could not get the price: ${error.message}`);
    throw error;
  }
}

export const priceRoutes = new Hono<AppEnv>()
  /** When prices were last fetched, and how many investments or kinds follow a feed. */
  .get("/status", async (c) => {
    const { db } = c.var.auth;
    const userId = c.var.userId;
    const [settings] = await db.select({ checkedAt: appSettings.pricesCheckedAt }).from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
    const [links] = await db.select({ n: count() }).from(priceLinks).where(eq(priceLinks.userId, userId));
    const [fed] = await db.select({ n: count() }).from(holdingKinds).where(and(eq(holdingKinds.userId, userId), isNotNull(holdingKinds.feed)));
    return c.json({ checkedAt: settings?.checkedAt ?? null, linked: Number(links?.n ?? 0), kinds: Number(fed?.n ?? 0) });
  })
  /** Fetches every price now. Limited, because each call goes out to other sites. */
  .post("/refresh", async (c) => {
    const { db, hmacKey } = c.var.auth;
    const nowMs = (c.var.auth.now ?? Date.now)();
    await enforceRateLimit(db, hmacKey, { bucket: "prices-refresh", subject: c.var.userId, limit: 6, windowSeconds: 3600 }, Math.floor(nowMs / 1000));
    return c.json(await viaFeed(() => refreshPrices(db, c.var.userId, requestToday(c.var.auth), c.var.priceFetch)));
  })
  /** Matches for a name, for the person to confirm. */
  .get("/suggest", async (c) => {
    const { q, kind } = parseQuery(c, SuggestQuery);
    return c.json({ items: await viaFeed(() => suggestMatches(c.var.priceFetch, kind, q)) });
  })
  .put("/links/:holdingId", async (c) => c.json(await viaFeed(async () => linkPrice(c.var.auth.db, c.var.userId, c.req.param("holdingId"), await parseJson(c, LinkPrice), requestToday(c.var.auth), c.var.priceFetch))))
  .delete("/links/:holdingId", async (c) => {
    await unlinkPrice(c.var.auth.db, c.var.userId, c.req.param("holdingId"));
    return c.body(null, 204);
  })
  /** What IBJA shows now for a kind (gold or silver), beside the rate last typed, to choose an adjustment from. */
  .get("/kinds/:kindId/preview", async (c) => {
    const { feed } = parseQuery(c, PreviewQuery);
    return c.json(await viaFeed(() => previewKindFeed(c.var.auth.db, c.var.userId, c.req.param("kindId"), feed, requestToday(c.var.auth), c.var.priceFetch)));
  });
