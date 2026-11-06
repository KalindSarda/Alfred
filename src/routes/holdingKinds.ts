import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateHoldingKind, MergeHoldingKind, UpdateHoldingKind } from "../schemas/holdingKind";
import { createKind, deleteKind, listKinds, mergeKind, updateKind } from "../services/holdingKinds";
import { parseJson } from "../utils/validate";

export const holdingKindRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listKinds(c.var.auth.db, c.var.userId) }))
  .post("/", async (c) => c.json(await createKind(c.var.auth.db, c.var.userId, await parseJson(c, CreateHoldingKind)), 201))
  .patch("/:id", async (c) => c.json(await updateKind(c.var.auth.db, c.var.userId, c.req.param("id"), await parseJson(c, UpdateHoldingKind))))
  .delete("/:id", async (c) => {
    await deleteKind(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/merge", async (c) => {
    const { intoId } = await parseJson(c, MergeHoldingKind);
    return c.json(await mergeKind(c.var.auth.db, c.var.userId, c.req.param("id"), intoId));
  });
