import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ValidationError } from "../config/errors";
import {
  confirmTransaction,
  createTransaction,
  getTransaction,
  listTransactions,
  restoreTransaction,
  softDeleteTransaction,
  updateTransaction,
} from "../services/ledger";
import { findIdempotent, rememberIdempotent } from "../services/idempotency";
import type { CreateTransactionInput } from "../schemas/transaction";
import { readJson } from "../utils/validate";

const MAX_KEY_LENGTH = 100;

export const transactionRoutes = new Hono<AppEnv>()
  // Static paths are registered before dynamic ones.
  .get("/", async (c) => c.json(await listTransactions(c.var.auth.db, c.var.userId, c.req.query())))
  .post("/", async (c) => {
    const { db } = c.var.auth;
    const key = c.req.header("Idempotency-Key");
    if (key !== undefined && (key.length === 0 || key.length > MAX_KEY_LENGTH)) {
      throw new ValidationError("Invalid Idempotency-Key", [{ path: "Idempotency-Key", message: "Must be 1-100 characters" }]);
    }
    if (key) {
      const previous = await findIdempotent(db, c.var.userId, key);
      if (previous) {
        c.header("Idempotent-Replayed", "true");
        return c.json(await getTransaction(db, c.var.userId, previous), 201);
      }
    }
    // The ledger service validates the body against CreateTransaction, so the cast only satisfies the type.
    const body = (await readJson(c)) as CreateTransactionInput;
    const created = await createTransaction(db, c.var.userId, body, { source: "web" });
    if (key) await rememberIdempotent(db, c.var.userId, key, created.id);
    return c.json(created, 201);
  })
  .get("/:id", async (c) => c.json(await getTransaction(c.var.auth.db, c.var.userId, c.req.param("id"))))
  .patch("/:id", async (c) =>
    c.json(await updateTransaction(c.var.auth.db, c.var.userId, c.req.param("id"), await readJson(c))),
  )
  .delete("/:id", async (c) => {
    await softDeleteTransaction(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/confirm", async (c) =>
    c.json(await confirmTransaction(c.var.auth.db, c.var.userId, c.req.param("id"))),
  )
  .post("/:id/restore", async (c) =>
    c.json(await restoreTransaction(c.var.auth.db, c.var.userId, c.req.param("id"))),
  );
