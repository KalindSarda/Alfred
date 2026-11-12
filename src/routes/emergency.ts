import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getEmergencyFund } from "../services/emergency";
import { requestToday } from "../utils/clock";

export const emergencyRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await getEmergencyFund(c.var.auth.db, c.var.userId, requestToday(c.var.auth))));
