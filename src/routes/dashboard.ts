import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { getSummary } from "../services/dashboard";
import { requestToday } from "../utils/clock";
import { parseQuery } from "../utils/validate";

export const PeriodQuery = z.object({
  period: z.enum(["7d", "30d", "90d", "this_month", "last_month", "ytd"]).default("30d"),
});

export const dashboardRoutes = new Hono<AppEnv>().get("/summary", async (c) => {
  const { period } = parseQuery(c, PeriodQuery);
  return c.json(await getSummary(c.var.auth.db, c.var.userId, period, requestToday(c.var.auth)));
});
