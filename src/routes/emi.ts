import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateEmiPlan, UpdateEmiPlan } from "../schemas/emi";
import { cancelPlan, createPlan, deletePlan, listPlans, reopenPlan, updatePlan } from "../services/emi";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

export const emiRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listPlans(c.var.auth.db, c.var.userId, requestToday(c.var.auth)) }))
  .post("/", async (c) => {
    const body = await parseJson(c, CreateEmiPlan);
    return c.json(await createPlan(c.var.auth.db, c.var.userId, body, requestToday(c.var.auth)), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateEmiPlan);
    return c.json(await updatePlan(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .post("/:id/cancel", async (c) => c.json(await cancelPlan(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .post("/:id/reopen", async (c) => c.json(await reopenPlan(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .delete("/:id", async (c) => {
    await deletePlan(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.query("instalments") === "remove");
    return c.body(null, 204);
  });
