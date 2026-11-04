import { Hono } from "hono";
import type { AppEnv } from "../app";
import { AddPayment, CreateDebt, ListDebtsQuery, SettleDebt, UpdateContact, UpdateDebt } from "../schemas/debt";
import { addPayment, createDebt, deleteDebt, forgiveDebt, listDebts, removePayment, setTrusted, settleDebt, updateDebt } from "../services/debts";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const debtRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { status } = parseQuery(c, ListDebtsQuery);
    return c.json(await listDebts(c.var.auth.db, c.var.userId, requestToday(c.var.auth), status));
  })
  .post("/", async (c) => {
    const body = await parseJson(c, CreateDebt);
    return c.json((await createDebt(c.var.auth.db, c.var.userId, body, "web", requestToday(c.var.auth))).person, 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateDebt);
    return c.json(await updateDebt(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .post("/:id/payments", async (c) => {
    const body = await parseJson(c, AddPayment);
    return c.json(await addPayment(c.var.auth.db, c.var.userId, c.req.param("id"), body, "web", requestToday(c.var.auth)), 201);
  })
  .delete("/:id/payments/:paymentId", async (c) =>
    c.json(await removePayment(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("paymentId"), requestToday(c.var.auth))),
  )
  .post("/:id/settle", async (c) => {
    const body = await parseJson(c, SettleDebt);
    return c.json(await settleDebt(c.var.auth.db, c.var.userId, c.req.param("id"), body, "web", requestToday(c.var.auth)));
  })
  .post("/:id/forgive", async (c) => c.json(await forgiveDebt(c.var.auth.db, c.var.userId, c.req.param("id"), requestToday(c.var.auth))))
  .delete("/:id", async (c) => {
    await deleteDebt(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });

export const contactRoutes = new Hono<AppEnv>().patch("/:id", async (c) => {
  const { trusted } = await parseJson(c, UpdateContact);
  await setTrusted(c.var.auth.db, c.var.userId, c.req.param("id"), trusted);
  return c.json(await listDebts(c.var.auth.db, c.var.userId, requestToday(c.var.auth), "open"));
});
