import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getMe, markOnboarded } from "../services/auth";

export const me = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getMe(c.var.auth.db, c.var.userId)))
  // The setup guide was finished or skipped.
  .post("/onboarded", async (c) => {
    await markOnboarded(c.var.auth.db, c.var.userId, new Date((c.var.auth.now ?? Date.now)()).toISOString());
    return c.json(await getMe(c.var.auth.db, c.var.userId));
  });
