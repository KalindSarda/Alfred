import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateAccount, ListAccountsQuery, UpdateAccount } from "../schemas/account";
import { createAccount, listAccountDtos, setArchived, updateAccount } from "../services/accounts";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const accountRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { includeArchived } = parseQuery(c, ListAccountsQuery);
    const items = await listAccountDtos(c.var.auth.db, c.var.userId, requestToday(c.var.auth), { includeArchived });
    return c.json({ items });
  })
  .post("/", async (c) => {
    const body = await parseJson(c, CreateAccount);
    return c.json(await createAccount(c.var.auth.db, c.var.userId, body, requestToday(c.var.auth)), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateAccount);
    return c.json(await updateAccount(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .post("/:id/archive", async (c) =>
    c.json(await setArchived(c.var.auth.db, c.var.userId, c.req.param("id"), true, requestToday(c.var.auth))),
  )
  .post("/:id/unarchive", async (c) =>
    c.json(await setArchived(c.var.auth.db, c.var.userId, c.req.param("id"), false, requestToday(c.var.auth))),
  );
