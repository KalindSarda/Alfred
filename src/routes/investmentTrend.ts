import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { getInvestmentTrend } from "../services/investmentTrend";
import { requestToday } from "../utils/clock";
import { parseQuery } from "../utils/validate";

const TrendQuery = z.object({ range: z.enum(["3m", "1y", "all"]).default("1y") });

export const investmentTrendRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { range } = parseQuery(c, TrendQuery);
  return c.json(await getInvestmentTrend(c.var.auth.db, c.var.userId, requestToday(c.var.auth), range));
});
