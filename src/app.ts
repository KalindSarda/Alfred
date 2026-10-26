import { Hono } from "hono";
import type { Bindings } from "./config/env";
import { AppError, RateLimitedError } from "./config/errors";
import { requestId } from "./middleware/requestId";
import { health } from "./routes/health";
import { logger } from "./utils/logger";

export type AppEnv = { Bindings: Bindings; Variables: { requestId: string } };

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);
  app.route("/api/health", health);

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
