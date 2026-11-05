import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { getCashflow } from "../services/cashflow";
import { getSummary, reviewCounts } from "../services/dashboard";
import { getNetWorthTrend } from "../services/networth";
import { requestToday } from "../utils/clock";
import { parseQuery } from "../utils/validate";

const Period = z.enum(["7d", "30d", "90d", "this_month", "last_month", "ytd", "cycle"]).default("30d");

export const PeriodQuery = z.object({ period: Period });
export const CashflowQuery = z.object({ period: Period, groupBy: z.enum(["category", "merchant"]).default("category") });

export const NetWorthQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(12) });

export const dashboardRoutes = new Hono<AppEnv>()
  .get("/summary", async (c) => {
    const { period } = parseQuery(c, PeriodQuery);
    return c.json(await getSummary(c.var.auth.db, c.var.userId, period, requestToday(c.var.auth)));
  })
  .get("/cashflow", async (c) => {
    const { period, groupBy } = parseQuery(c, CashflowQuery);
    return c.json(await getCashflow(c.var.auth.db, c.var.userId, period, groupBy, requestToday(c.var.auth)));
  })
  .get("/networth", async (c) => {
    const { months } = parseQuery(c, NetWorthQuery);
    return c.json(await getNetWorthTrend(c.var.auth.db, c.var.userId, requestToday(c.var.auth), months));
  })
  // Small and cheap: drives the badge on the Transactions item in the navigation.
  .get("/review", async (c) => c.json(await reviewCounts(c.var.auth.db, c.var.userId)));
