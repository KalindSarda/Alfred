import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { getHealth } from "../services/health";
import { requestToday } from "../utils/clock";
import { parseQuery } from "../utils/validate";

const Query = z.object({ period: z.enum(["last", "current"]).default("last") });

/** How a month looked: income, needs, wants, savings and a few ratios. */
export const moneyHealthRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { period } = parseQuery(c, Query);
  return c.json(await getHealth(c.var.auth.db, c.var.userId, requestToday(c.var.auth), period));
});
