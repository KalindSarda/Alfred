import { type Context, Hono } from "hono";
import type { AppEnv } from "../app";
import { requestToday } from "../utils/clock";
import { exportCsv, exportJson } from "../services/exportData";
import { enforceRateLimit } from "../services/rateLimit";
import { getConfig } from "../config/env";

/** Exports read the whole ledger, so they are limited to a handful per hour. */
async function limit(c: Context<AppEnv>) {
  const { db, now } = c.var.auth;
  const seconds = Math.floor((now ?? Date.now)() / 1000);
  await enforceRateLimit(db, getConfig(c.env).AUTH_HMAC_KEY, { bucket: "export", subject: c.var.userId, limit: 10, windowSeconds: 3600 }, seconds);
}

export const exportRoutes = new Hono<AppEnv>()
  .get("/json", async (c) => {
    await limit(c);
    const now = new Date((c.var.auth.now ?? Date.now)());
    const body = await exportJson(c.var.auth.db, c.var.userId, now.toISOString());
    c.header("Content-Disposition", `attachment; filename="alfred-export-${requestToday(c.var.auth)}.json"`);
    return c.json(body);
  })
  .get("/csv", async (c) => {
    await limit(c);
    const body = await exportCsv(c.var.auth.db, c.var.userId);
    c.header("Content-Disposition", `attachment; filename="alfred-transactions-${requestToday(c.var.auth)}.csv"`);
    c.header("Content-Type", "text/csv; charset=utf-8");
    return c.body(body);
  });
