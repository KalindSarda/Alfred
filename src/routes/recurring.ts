import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateRecurring, UpdateRecurring } from "../schemas/recurring";
import { createRule, deleteRule, listRules, pauseRule, resumeRule, skipNext, updateRule } from "../services/recurring";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

export const recurringRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listRules(c.var.auth.db, c.var.userId, requestToday(c.var.auth)) }))
  .post("/", async (c) => {
    const body = await parseJson(c, CreateRecurring);
    return c.json(await createRule(c.var.auth.db, c.var.userId, body, requestToday(c.var.auth)), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateRecurring);
    return c.json(await updateRule(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .post("/:id/pause", async (c) => c.json(await pauseRule(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .post("/:id/resume", async (c) => c.json(await resumeRule(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .post("/:id/skip", async (c) => c.json(await skipNext(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .delete("/:id", async (c) => {
    await deleteRule(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
