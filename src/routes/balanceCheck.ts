import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { previewBalance, settleBalance } from "../services/balanceCheck";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

const Body = z.object({ accountId: z.string().min(1).max(64), typedPaise: z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00) }).strict();

export const balanceCheckRoutes = new Hono<AppEnv>()
  .post("/", async (c) => {
    const b = await parseJson(c, Body);
    return c.json(await previewBalance(c.var.auth.db, c.var.userId, b.accountId, b.typedPaise, requestToday(c.var.auth)));
  })
  .post("/settle", async (c) => {
    const b = await parseJson(c, Body);
    return c.json(await settleBalance(c.var.auth.db, c.var.userId, b.accountId, b.typedPaise, requestToday(c.var.auth)));
  });
