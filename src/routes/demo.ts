import { Hono } from "hono";
import type { AppEnv } from "../app";
import { clearDemoData, createDemoData } from "../services/demo";
import { requestToday } from "../utils/clock";

export const demoRoutes = new Hono<AppEnv>()
  .post("/", async (c) => c.json(await createDemoData(c.var.auth.db, c.var.userId, requestToday(c.var.auth)), 201))
  .delete("/", async (c) => c.json(await clearDemoData(c.var.auth.db, c.var.userId)));
