import { Hono } from "hono";
import type { AppEnv } from "../app";
import { AllotHold, CreateHold, ListHoldsQuery, UpdateHold } from "../schemas/hold";
import { allotHold, createHold, deleteHold, listHolds, releaseHold, updateHold } from "../services/holds";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const holdRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { status } = parseQuery(c, ListHoldsQuery);
    return c.json({ items: await listHolds(c.var.auth.db, c.var.userId, requestToday(c.var.auth), status) });
  })
  .post("/", async (c) => {
    const body = await parseJson(c, CreateHold);
    return c.json(await createHold(c.var.auth.db, c.var.userId, body, requestToday(c.var.auth)), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateHold);
    return c.json(await updateHold(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .post("/:id/release", async (c) =>
    c.json(await releaseHold(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))),
  )
  .post("/:id/allot", async (c) => {
    const body = await parseJson(c, AllotHold);
    return c.json(await allotHold(c.var.auth.db, c.var.userId, c.req.param("id"), body, "web", requestToday(c.var.auth)));
  })
  .delete("/:id", async (c) => {
    await deleteHold(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
