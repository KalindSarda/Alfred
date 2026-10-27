import { deleteCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { SESSION_COOKIE } from "../middleware/session";
import { RequestCodeBody, VerifyCodeBody } from "../schemas/auth";
import { getMe, logout, logoutEverywhere, requestLoginCode, verifyLoginCode } from "../services/auth";
import { parseJson } from "../utils/validate";

const clientIp = (headers: Headers) => headers.get("CF-Connecting-IP") ?? "unknown";

const cookieOptions = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

/** Routes reachable without a session. */
export const authPublic = new Hono<AppEnv>()
  .post("/request-code", async (c) => {
    const body = await parseJson(c, RequestCodeBody);
    await requestLoginCode(c.var.auth, { ...body, ip: clientIp(c.req.raw.headers) });
    return c.json({ ok: true }, 202);
  })
  .post("/verify-code", async (c) => {
    const body = await parseJson(c, VerifyCodeBody);
    const { userId, session } = await verifyLoginCode(c.var.auth, { ...body, ip: clientIp(c.req.raw.headers) });
    setCookie(c, SESSION_COOKIE, session.token, { ...cookieOptions, maxAge: session.maxAgeSeconds });
    return c.json({ user: await getMe(c.var.auth.db, userId) });
  });

/** Routes that require a session; mounted after the session middleware. */
export const authSession = new Hono<AppEnv>()
  .post("/logout", async (c) => {
    await logout(c.var.auth.db, c.var.sessionId);
    deleteCookie(c, SESSION_COOKIE, cookieOptions);
    return c.json({ ok: true });
  })
  .post("/logout-all", async (c) => {
    await logoutEverywhere(c.var.auth.db, c.var.userId);
    deleteCookie(c, SESSION_COOKIE, cookieOptions);
    return c.json({ ok: true });
  });
