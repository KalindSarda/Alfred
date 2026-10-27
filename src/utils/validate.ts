import type { Context } from "hono";
import type { z } from "zod";
import { ValidationError } from "../config/errors";

function issuesOf(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Reads the JSON body without validating its shape (for services that validate it themselves). */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

/** Parses and validates a JSON body; every failure becomes the documented 422 envelope. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const result = schema.safeParse(await readJson(c));
  if (!result.success) throw new ValidationError("Request validation failed", issuesOf(result.error));
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw new ValidationError("Request validation failed", issuesOf(result.error));
  return result.data;
}
