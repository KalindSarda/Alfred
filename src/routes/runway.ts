import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getRunway } from "../services/runway";
import { requestToday } from "../utils/clock";

export const runwayRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await getRunway(c.var.auth.db, c.var.userId, requestToday(c.var.auth))));
