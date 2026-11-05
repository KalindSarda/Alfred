import { Hono } from "hono";
import type { AppEnv } from "../app";
import { BuyHolding, CreateHolding, ListHoldingsQuery, SellHolding, SetHoldingValue, UpdateHolding } from "../schemas/holding";
import { buy, closeHolding, createHolding, deleteHolding, listHoldings, reopenHolding, sell, setValue, updateHolding } from "../services/holdings";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const holdingRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { status } = parseQuery(c, ListHoldingsQuery);
    return c.json(await listHoldings(c.var.auth.db, c.var.userId, requestToday(c.var.auth), status));
  })
  .post("/", async (c) => c.json(await createHolding(c.var.auth.db, c.var.userId, await parseJson(c, CreateHolding), requestToday(c.var.auth)), 201))
  .patch("/:id", async (c) => c.json(await updateHolding(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateHolding), requestToday(c.var.auth))))
  .post("/:id/value", async (c) => c.json(await setValue(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, SetHoldingValue), requestToday(c.var.auth))))
  .post("/:id/buy", async (c) => c.json(await buy(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, BuyHolding), requestToday(c.var.auth)), 201))
  .post("/:id/sell", async (c) => c.json(await sell(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, SellHolding), requestToday(c.var.auth)), 201))
  .post("/:id/close", async (c) => c.json(await closeHolding(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .post("/:id/reopen", async (c) => c.json(await reopenHolding(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .delete("/:id", async (c) => {
    await deleteHolding(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
