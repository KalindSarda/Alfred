import { Hono } from "hono";
import type { AppEnv } from "../app";
import { UpdateSettings } from "../schemas/settings";
import { getSettings, updateSettings } from "../services/settings";
import { parseJson } from "../utils/validate";

export const settingsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getSettings(c.var.auth.db, c.var.userId)))
  .patch("/", async (c) => {
    const body = await parseJson(c, UpdateSettings);
    return c.json(await updateSettings(c.var.auth.db, c.var.userId, body));
  });
