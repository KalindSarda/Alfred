import { Hono } from "hono";
import type { AppEnv } from "../app";

export const health = new Hono<AppEnv>().get("/", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});
