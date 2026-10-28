import { Hono } from "hono";
import type { AppEnv } from "../app";
import { handleUpdate } from "../bot/handlers";
import { TelegramUpdate } from "../bot/update";
import { getConfig } from "../config/env";
import { UnauthenticatedError } from "../config/errors";
import { createLinkCode, unlinkChat } from "../services/telegramLink";
import { timingSafeEqual } from "../utils/crypto";
import { logger } from "../utils/logger";

/**
 * Telegram's webhook. Not under /api: it has no session, and is protected by the secret token Telegram echoes back
 * in a header. After that check it always answers 200, so Telegram never retries (and never floods us).
 */
export const telegramWebhook = new Hono<AppEnv>().post("/webhook", async (c) => {
  const config = getConfig(c.env);
  const given = c.req.header("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!timingSafeEqual(given, config.TELEGRAM_WEBHOOK_SECRET)) {
    // Lengths only, never the secret itself: enough to tell "header missing" from "app has a different secret".
    logger.warn("telegram_webhook_rejected", {
      reason: given === "" ? "header missing" : "does not match this app's configured value",
      receivedChars: given.length,
      expectedChars: config.TELEGRAM_WEBHOOK_SECRET.length,
    });
    throw new UnauthenticatedError("Invalid secret");
  }

  const body: unknown = await c.req.json().catch(() => null);
  const parsed = TelegramUpdate.safeParse(body);
  if (!parsed.success) return c.json({});

  const { db, hmacKey, now } = c.var.auth;
  try {
    await handleUpdate({ db, hmacKey, telegram: c.var.telegram, now: now ?? Date.now }, parsed.data);
  } catch (error) {
    logger.error("telegram_update_failed", { requestId: c.get("requestId"), error: error instanceof Error ? error.message : "unknown" });
  }
  return c.json({});
});

/** Routes for the signed-in web app: link or unlink your Telegram chat. */
export const telegramLinkRoutes = new Hono<AppEnv>()
  .post("/link-code", async (c) => {
    const { db, hmacKey, now } = c.var.auth;
    const nowMs = (now ?? Date.now)();
    const { code, expiresAt } = await createLinkCode(db, hmacKey, c.var.userId, nowMs);
    return c.json({ code, expiresAt }, 201);
  })
  .delete("/link", async (c) => {
    await unlinkChat(c.var.auth.db, c.var.userId);
    return c.body(null, 204);
  });
