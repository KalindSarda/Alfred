import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { getCommitments } from "../services/commitments";
import { requestToday } from "../utils/clock";
import { parseQuery } from "../utils/validate";

const Query = z.object({ days: z.coerce.number().int().min(1).max(120).optional() });

export const commitmentRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const { days } = parseQuery(c, Query);
  return c.json(await getCommitments(c.var.auth.db, c.var.userId, requestToday(c.var.auth), { days }));
});
