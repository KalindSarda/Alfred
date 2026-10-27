import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app";
import { authenticateSession } from "../services/auth";

export const SESSION_COOKIE = "sid";

/** The only place that decides who the caller is. Handlers read userId from context, never from input. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await authenticateSession(c.var.auth, getCookie(c, SESSION_COOKIE));
  c.set("userId", session.userId);
  c.set("sessionId", session.sessionId);
  await next();
});
