import { Hono } from "hono";
import type { AppEnv } from "../app";
import { getLadder } from "../services/ladder";
import { getTransferSuggestion } from "../services/transfer";
import { requestToday } from "../utils/clock";

export const ladderRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await getLadder(c.var.auth.db, c.var.userId, requestToday(c.var.auth))));

export const transferSuggestionRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await getTransferSuggestion(c.var.auth.db, c.var.userId, requestToday(c.var.auth))));
