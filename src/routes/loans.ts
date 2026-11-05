import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ChangeRate, CreateLoan, ForecloseLoan, ListLoansQuery, PrepayLoan, SetInstalmentTotal, UpdateLoan } from "../schemas/loan";
import { changeRate, createLoan, deleteLoan, forecloseLoan, listLoans, loanSchedule, prepayLoan, removeInstalment, setInstalmentTotal, updateLoan } from "../services/loans";
import { requestToday } from "../utils/clock";
import { parseJson, parseQuery } from "../utils/validate";

export const loanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { status } = parseQuery(c, ListLoansQuery);
    return c.json(await listLoans(c.var.auth.db, c.var.userId, status));
  })
  .post("/", async (c) => c.json(await createLoan(c.var.auth.db, c.var.userId, await parseJson(c, CreateLoan), requestToday(c.var.auth)), 201))
  .patch("/:id", async (c) => c.json(await updateLoan(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateLoan))))
  .get("/:id/schedule", async (c) => c.json({ rows: await loanSchedule(c.var.auth.db, c.var.userId, c.req.param("id")) }))
  .post("/:id/prepay", async (c) => c.json(await prepayLoan(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, PrepayLoan), requestToday(c.var.auth)), 201))
  .post("/:id/rate", async (c) => c.json(await changeRate(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, ChangeRate))))
  .post("/:id/foreclose", async (c) => c.json(await forecloseLoan(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, ForecloseLoan), requestToday(c.var.auth))))
  .patch("/:id/instalments/:on", async (c) => c.json(await setInstalmentTotal(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("on"), (await parseJson(c, SetInstalmentTotal)).totalPaise)))
  .delete("/:id/instalments/:on", async (c) => c.json(await removeInstalment(c.var.auth.db, c.var.userId, c.req.param("id"), c.req.param("on"))))
  .delete("/:id", async (c) => {
    await deleteLoan(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
