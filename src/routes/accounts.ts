import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateAccount, ListAccountsQuery, MergeAccount, UpdateAccount } from "../schemas/account";
import { createAccount, deleteAccount, listAccountDtos, mergeAccount, setArchived, updateAccount } from "../services/accounts";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const accountRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { includeArchived } = parseQuery(c, ListAccountsQuery);
    return c.json(await listAccountDtos(c.var.auth.db, c.var.userId, requestToday(c.var.auth), { includeArchived }));
  })
  .post("/", async (c) => {
    const body = await parseJson(c, CreateAccount);
    return c.json(await createAccount(c.var.auth.db, c.var.userId, body, requestToday(c.var.auth)), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateAccount);
    return c.json(await updateAccount(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .delete("/:id", async (c) => {
    await deleteAccount(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/merge", async (c) => {
    const { intoId } = await parseJson(c, MergeAccount);
    return c.json(await mergeAccount(c.var.auth.db, c.var.userId, c.req.param("id"), intoId));
  })
  .post("/:id/archive", async (c) =>
    c.json(await setArchived(c.var.auth.db, c.var.userId, c.req.param("id"), true, requestToday(c.var.auth))),
  )
  .post("/:id/unarchive", async (c) =>
    c.json(await setArchived(c.var.auth.db, c.var.userId, c.req.param("id"), false, requestToday(c.var.auth))),
  );
