import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { getSummary, reviewCounts } from "../services/dashboard";
import { requestToday } from "../utils/clock";
import { parseQuery } from "../utils/validate";

export const PeriodQuery = z.object({
  period: z.enum(["7d", "30d", "90d", "this_month", "last_month", "ytd"]).default("30d"),
});

export const dashboardRoutes = new Hono<AppEnv>()
  .get("/summary", async (c) => {
    const { period } = parseQuery(c, PeriodQuery);
    return c.json(await getSummary(c.var.auth.db, c.var.userId, period, requestToday(c.var.auth)));
  })
  // Small and cheap: drives the badge on the Transactions item in the navigation.
  .get("/review", async (c) => c.json(await reviewCounts(c.var.auth.db, c.var.userId)));
