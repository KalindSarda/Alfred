import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { type Bindings, type Config, getConfig } from "./config/env";
import { AppError, RateLimitedError } from "./config/errors";
import { getDb } from "./db/client";
import { csrfGuard } from "./middleware/csrf";
import { requestId } from "./middleware/requestId";
import { requireSession } from "./middleware/session";
import { accountRoutes } from "./routes/accounts";
import { alfredRoutes } from "./routes/alfred";
import { authPublic, authSession } from "./routes/auth";
import { categoryRoutes } from "./routes/categories";
import { dashboardRoutes } from "./routes/dashboard";
import { demoRoutes } from "./routes/demo";
import { health } from "./routes/health";
import { me } from "./routes/me";
import { settingsRoutes } from "./routes/settings";
import { transactionRoutes } from "./routes/transactions";
import type { AuthDeps } from "./services/auth";
import { createNotifiers, type Notifiers } from "./services/notifiers";
import { logger } from "./utils/logger";

export type AppEnv = {
  Bindings: Bindings;
  Variables: { requestId: string; auth: AuthDeps; userId: string; sessionId: string };
};

export interface AppOptions {
  /** Test seam: replace the real Telegram/SMTP senders. */
  notifiers?: (config: Config) => Notifiers;
  /** Test seam: replace the clock (epoch milliseconds). */
  now?: () => number;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);

  // Builds per-request dependencies once; handlers and middleware read them from context.
  app.use(
    "/api/*",
    createMiddleware<AppEnv>(async (c, next) => {
      const config = getConfig(c.env);
      c.set("auth", {
        db: getDb(c.env.DB),
        hmacKey: config.AUTH_HMAC_KEY,
        notifiers: (options.notifiers ?? createNotifiers)(config),
        ...(options.now && { now: options.now }),
      });
      await next();
    }),
  );
  app.use("/api/*", csrfGuard);

  // Public routes.
  app.route("/api/health", health);
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
