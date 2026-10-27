import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app";
import { ForbiddenError } from "../config/errors";

export const CSRF_HEADER = "X-Requested-With";
export const CSRF_VALUE = "fin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Defence in depth on top of SameSite=Lax: a cross-site form post cannot set a custom header or a JSON
 * content type, so every state-changing request must carry both.
 */
export const csrfGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const header = c.req.header(CSRF_HEADER);
    const contentType = c.req.header("Content-Type") ?? "";
    if (header !== CSRF_VALUE || !contentType.toLowerCase().startsWith("application/json")) {
      throw new ForbiddenError("Missing or invalid CSRF headers", "csrf_failed");
    }
  }
  await next();
});
