import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateReserve, SetMoved, UpdateReserve } from "../schemas/reserve";
import { getAllowance, markNothingToday } from "../services/allowance";
import { createReserve, deleteReserve, setMoved, updateReserve } from "../services/reserves";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

/** The weekly allowance, the "nothing today" answer, and the money to move first. */
export const allowanceRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getAllowance(c.var.auth.db, c.var.userId, requestToday(c.var.auth))))
  .post("/nothing-today", async (c) => {
    const today = requestToday(c.var.auth);
    await markNothingToday(c.var.auth.db, c.var.userId, today);
    return c.json(await getAllowance(c.var.auth.db, c.var.userId, today));
  })
  .post("/reserves", async (c) => c.json(await createReserve(c.var.auth.db, c.var.userId, await parseJson(c, CreateReserve), requestToday(c.var.auth)), 201))
  .patch("/reserves/:id", async (c) => c.json(await updateReserve(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateReserve), requestToday(c.var.auth))))
  .delete("/reserves/:id", async (c) => {
    await deleteReserve(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/reserves/:id/moved", async (c) => c.json(await setMoved(c.var.auth.db, c.var.userId, c.req.param("id"), (await parseJson(c, SetMoved)).moved ?? true, requestToday(c.var.auth))));
