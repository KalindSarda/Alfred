import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../app";
import { SESSION_COOKIE } from "../middleware/session";
import { getMe, markOnboarded } from "../services/auth";
import { deleteOwnAccount } from "../services/people";
import { enforceRateLimit } from "../services/rateLimit";
import { parseJson } from "../utils/validate";

const DeleteBody = z.object({ email: z.string().trim().max(254) }).strict();

export const me = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getMe(c.var.auth.db, c.var.userId)))
  // The setup guide was finished or skipped.
  .post("/onboarded", async (c) => {
    await markOnboarded(c.var.auth.db, c.var.userId, new Date((c.var.auth.now ?? Date.now)()).toISOString());
    return c.json(await getMe(c.var.auth.db, c.var.userId));
  })
  // People delete their own account by typing their email. Everything they recorded goes with it.
  .delete("/", async (c) => {
    const { email } = await parseJson(c, DeleteBody);
    const { db, hmacKey, now } = c.var.auth;
    await enforceRateLimit(db, hmacKey, { bucket: "delete-account", subject: c.var.userId, limit: 5, windowSeconds: 3600 }, Math.floor((now ?? Date.now)() / 1000));
    await deleteOwnAccount(db, c.var.userId, email);
    deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    return c.body(null, 204);
  });
