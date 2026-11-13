import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateInvestmentAccount, UpdateInvestmentAccount } from "../schemas/investmentAccount";
import { createInvestmentAccount, listInvestmentAccounts, setInvestmentAccountArchived, updateInvestmentAccount } from "../services/investmentAccounts";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

/** Broker and demat accounts that hold investments, with what each holds. */
export const investmentAccountRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listInvestmentAccounts(c.var.auth.db, c.var.userId, requestToday(c.var.auth), { includeArchived: c.req.query("includeArchived") === "true" })))
  .post("/", async (c) => {
    const row = await createInvestmentAccount(c.var.auth.db, c.var.userId, await parseJson(c, CreateInvestmentAccount));
    return c.json({ id: row.id, name: row.name, purpose: row.purpose }, 201);
  })
  .patch("/:id", async (c) => {
    const row = await updateInvestmentAccount(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateInvestmentAccount));
    return c.json({ id: row.id, name: row.name, purpose: row.purpose });
  })
  .post("/:id/archive", async (c) => {
    const row = await setInvestmentAccountArchived(c.var.auth.db, c.var.userId, c.req.param("id"), true);
    return c.json({ id: row.id, archived: true });
  })
  .post("/:id/unarchive", async (c) => {
    const row = await setInvestmentAccountArchived(c.var.auth.db, c.var.userId, c.req.param("id"), false);
    return c.json({ id: row.id, archived: false });
  });
