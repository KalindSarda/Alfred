import { Hono } from "hono";
import type { AppEnv } from "../app";
import { UpdateFirePlan } from "../schemas/fire";
import { getFire, updateFirePlan } from "../services/fire";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

export const fireRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getFire(c.var.auth.db, c.var.userId, requestToday(c.var.auth))))
  .put("/", async (c) => {
    const body = await parseJson(c, UpdateFirePlan);
    await updateFirePlan(c.var.auth.db, c.var.userId, body);
    return c.json(await getFire(c.var.auth.db, c.var.userId, requestToday(c.var.auth)));
  });
