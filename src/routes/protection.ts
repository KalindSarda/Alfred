import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreatePolicy, UpdatePolicy, UpdateProfile } from "../schemas/insurance";
import { createPolicy, deletePolicy, getProtection, updatePolicy, updateProfile } from "../services/protection";
import { requestToday } from "../utils/clock";
import { parseJson } from "../utils/validate";

/** The protection check: the answers, the policies and where there is no cover. */
export const protectionRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await getProtection(c.var.auth.db, c.var.userId, requestToday(c.var.auth))))
  .put("/profile", async (c) => {
    const body = await parseJson(c, UpdateProfile);
    await updateProfile(c.var.auth.db, c.var.userId, body);
    return c.json(await getProtection(c.var.auth.db, c.var.userId, requestToday(c.var.auth)));
  });

export const insuranceRoutes = new Hono<AppEnv>()
  .post("/", async (c) => {
    const body = await parseJson(c, CreatePolicy);
    return c.json(await createPolicy(c.var.auth.db, c.var.userId, body, requestToday(c.var.auth)), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdatePolicy);
    return c.json(await updatePolicy(c.var.auth.db, c.var.userId, c.req.param("id"), body, requestToday(c.var.auth)));
  })
  .delete("/:id", async (c) => {
    await deletePolicy(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
