import { Hono } from "hono";
import type { AppEnv } from "../app";
import { listPartners } from "../services/holdingPartners";
import { requestToday } from "../utils/clock";

/** The other people in your shared investments, with what you hold with each. */
export const partnerRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await listPartners(c.var.auth.db, c.var.userId, requestToday(c.var.auth))));
