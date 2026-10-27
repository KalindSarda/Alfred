import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getMe } from "../services/auth";

export const me = new Hono<AppEnv>().get("/", async (c) => c.json(await getMe(c.var.auth.db, c.var.userId)));
