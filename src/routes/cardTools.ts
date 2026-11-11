import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { analyseStatement, rankCardsForToday, settleStatement, statementFacts } from "../services/cardTools";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

const FloatQuery = z.object({ amountPaise: z.coerce.number().int().min(1).max(1_000_000_000_00).default(1) });
const CardQuery = z.object({ cardId: z.string().min(1).max(64) });
const Billed = z.object({ cardId: z.string().min(1).max(64), billedPaise: z.number().int().min(0).max(1_000_000_000_00) }).strict();

/** Which card to use today, and checking a card statement against what Alfred expected. */
export const cardToolRoutes = new Hono<AppEnv>()
  .get("/float", async (c) => {
    const { amountPaise } = parseQuery(c, FloatQuery);
    return c.json({ items: await rankCardsForToday(c.var.auth.db, c.var.userId, requestToday(c.var.auth), amountPaise) });
  })
  .get("/statement", async (c) => {
    const { cardId } = parseQuery(c, CardQuery);
    return c.json(await statementFacts(c.var.auth.db, c.var.userId, cardId, requestToday(c.var.auth)));
  })
  .post("/statement", async (c) => {
    const b = await parseJson(c, Billed);
    return c.json(await analyseStatement(c.var.auth.db, c.var.userId, b.cardId, b.billedPaise, requestToday(c.var.auth)));
  })
  .post("/statement/settle", async (c) => {
    const b = await parseJson(c, Billed);
    return c.json(await settleStatement(c.var.auth.db, c.var.userId, b.cardId, b.billedPaise, requestToday(c.var.auth)));
  });
