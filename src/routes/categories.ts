import { Hono } from "hono";
import type { AppEnv } from "../app";
import { CreateCategory, MergeCategory, UpdateCategory } from "../schemas/category";
import { createCategory, deleteCategory, listCategoryDtos, mergeCategory, updateCategory } from "../services/categories";
import { parseJson } from "../utils/validate";

export const categoryRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listCategoryDtos(c.var.auth.db, c.var.userId) }))
  .post("/", async (c) => {
    const body = await parseJson(c, CreateCategory);
    return c.json(await createCategory(c.var.auth.db, c.var.userId, body), 201);
  })
  .patch("/:id", async (c) => {
    const body = await parseJson(c, UpdateCategory);
    return c.json(await updateCategory(c.var.auth.db, c.var.userId, c.req.param("id"), body));
  })
  .delete("/:id", async (c) => {
    await deleteCategory(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/merge", async (c) => {
    const { intoId } = await parseJson(c, MergeCategory);
    return c.json(await mergeCategory(c.var.auth.db, c.var.userId, c.req.param("id"), intoId));
  });
