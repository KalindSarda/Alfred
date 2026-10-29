import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { type Bindings, type Config, getConfig } from "./config/env";
import { AppError, RateLimitedError } from "./config/errors";
import { getDb } from "./db/client";
import { csrfGuard } from "./middleware/csrf";
import { requestId } from "./middleware/requestId";
import { securityHeaders } from "./middleware/securityHeaders";
import { requireSession } from "./middleware/session";
import { accountRoutes } from "./routes/accounts";
import { alfredRoutes } from "./routes/alfred";
import { budgetRoutes } from "./routes/budgets";
import { authPublic, authSession } from "./routes/auth";
import { categoryRoutes } from "./routes/categories";
import { dashboardRoutes } from "./routes/dashboard";
import { demoRoutes } from "./routes/demo";
import { health } from "./routes/health";
import { exportRoutes } from "./routes/export";
import { me } from "./routes/me";
import { peopleRoutes } from "./routes/people";
import { settingsRoutes } from "./routes/settings";
import { transactionRoutes } from "./routes/transactions";
import type { AuthDeps } from "./services/auth";
import { createTelegramApi, type TelegramApi } from "./bot/telegramApi";
import { telegramLinkRoutes, telegramWebhook } from "./routes/telegram";
import { createNotifiers, type Notifiers } from "./services/notifiers";
import { logger } from "./utils/logger";

export type AppEnv = {
  Bindings: Bindings;
  Variables: { requestId: string; auth: AuthDeps; telegram: TelegramApi; userId: string; sessionId: string };
};

export interface AppOptions {
  /** Test seam: replace the real Telegram/SMTP senders. */
  notifiers?: (config: Config) => Notifiers;
  /** Test seam: replace the real Telegram client. */
  telegram?: (config: Config) => TelegramApi;
  /** Test seam: replace the clock (epoch milliseconds). */
  now?: () => number;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);
  app.use("*", securityHeaders);

  // Builds per-request dependencies once; handlers and middleware read them from context.
  const dependencies = createMiddleware<AppEnv>(async (c, next) => {
    const config = getConfig(c.env);
    c.set("auth", {
      db: getDb(c.env.DB),
      hmacKey: config.AUTH_HMAC_KEY,
      notifiers: (options.notifiers ?? createNotifiers)(config),
      ...(options.now && { now: options.now }),
    });
    c.set("telegram", (options.telegram ?? ((cfg: Config) => createTelegramApi(cfg.TELEGRAM_BOT_TOKEN)))(config));
    await next();
  });
  app.use("/api/*", dependencies);
  app.use("/telegram/*", dependencies);
  app.use("/api/*", csrfGuard);

  // Public routes.
  app.route("/api/health", health);
  // Telegram calls this without a session; it is protected by the webhook secret instead.
  app.route("/telegram", telegramWebhook);
  app.route("/api/auth", authPublic);

  // Everything below requires a session. New resource routers are mounted here.
  app.use("/api/*", requireSession);
  app.route("/api/auth", authSession);
  app.route("/api/me", me);
  app.route("/api/accounts", accountRoutes);
  app.route("/api/transactions", transactionRoutes);
  app.route("/api/categories", categoryRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/demo-data", demoRoutes);
  app.route("/api/dashboard", dashboardRoutes);
  app.route("/api/alfred", alfredRoutes);
  app.route("/api/budgets", budgetRoutes);
  app.route("/api/export", exportRoutes);
  app.route("/api/people", peopleRoutes);
  app.route("/api/telegram", telegramLinkRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  // Single place where errors become the documented envelope (05-api-schema.md).
  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err instanceof RateLimitedError) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) } },
        err.status,
      );
    }
    logger.error("unhandled_error", { requestId: c.get("requestId"), error: String(err) });
    return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
  });

  return app;
}
