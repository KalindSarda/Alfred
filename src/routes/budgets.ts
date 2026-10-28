import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { deleteBudget, listBudgets, setBudget } from "../services/budgets";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

const SetBudgetBody = z.object({ limitPaise: z.number().int().positive().max(100_000_000_000_00) }).strict();

export const budgetRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listBudgets(c.var.auth.db, c.var.userId, requestToday(c.var.auth))))
  .put("/:categoryId", async (c) => {
    const { limitPaise } = await parseJson(c, SetBudgetBody);
    await setBudget(c.var.auth.db, c.var.userId, c.req.param("categoryId"), limitPaise);
    return c.json(await listBudgets(c.var.auth.db, c.var.userId, requestToday(c.var.auth)));
  })
  .delete("/:categoryId", async (c) => {
    await deleteBudget(c.var.auth.db, c.var.userId, c.req.param("categoryId"));
    return c.body(null, 204);
  });
