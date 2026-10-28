import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app";

/**
 * Headers for every response the Worker itself produces (the API and the webhook). The static app gets its own
 * set from web/public/_headers, which also carries the Content-Security-Policy.
 */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  // Responses carry personal money data, so nothing may be kept by a shared cache or the back/forward cache.
  c.header("Cache-Control", "no-store");
  // The API only returns data; a stricter policy than the app's, in case a response is ever opened directly.
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
});
