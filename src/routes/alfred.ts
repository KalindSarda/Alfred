import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getBriefing } from "../services/alfred";
import { requestToday } from "../utils/clock";

export const alfredRoutes = new Hono<AppEnv>().get("/briefing", async (c) => {
  const now = new Date((c.var.auth.now ?? Date.now)());
  return c.json(await getBriefing(c.var.auth.db, c.var.userId, requestToday(c.var.auth), now));
});
