import { Hono } from "hono";
import type { AppEnv } from "../app";
import { loadEntryHints } from "../db/hints";

/** What the New-entry form can suggest from the past: usual category and account per merchant, recent accounts. */
export const hintRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await loadEntryHints(c.var.auth.db, c.var.userId)));
