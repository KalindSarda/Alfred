import type { Context } from "hono";
import type { z } from "zod";
import { ValidationError } from "../config/errors";

function issuesOf(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Parses and validates a JSON body; every failure becomes the documented 422 envelope. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError("Request validation failed", issuesOf(result.error));
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw new ValidationError("Request validation failed", issuesOf(result.error));
  return result.data;
}
