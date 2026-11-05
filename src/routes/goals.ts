import { Hono } from "hono";
import type { AppEnv } from "../app";
import { AddContribution, CreateGoal, ListGoalsQuery, UpdateGoal } from "../schemas/goal";
import { addContribution, archiveGoal, createGoal, deleteGoal, listGoals, markAchieved, removeContribution, updateGoal } from "../services/goals";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const goalRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { status } = parseQuery(c, ListGoalsQuery);
    return c.json(await listGoals(c.var.auth.db, c.var.userId, requestToday(c.var.auth), status));
  })
  .post("/", async (c) => c.json(await createGoal(c.var.auth.db, c.var.userId, await parseJson(c, CreateGoal), requestToday(c.var.auth)), 201))
  .patch("/:id", async (c) => c.json(await updateGoal(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateGoal), requestToday(c.var.auth))))
  .post("/:id/contributions", async (c) =>
    c.json(await addContribution(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, AddContribution), requestToday(c.var.auth)), 201),
  )
  .delete("/:id/contributions/:contributionId", async (c) =>
    c.json(await removeContribution(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("contributionId"), requestToday(c.var.auth))),
  )
  .post("/:id/achieve", async (c) => c.json(await markAchieved(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .post("/:id/archive", async (c) => c.json(await archiveGoal(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .delete("/:id", async (c) => {
    await deleteGoal(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
