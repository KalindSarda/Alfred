import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { AppError, ConflictError } from "../src/config/errors";

describe("app skeleton", () => {
  it("health check reaches D1", async () => {
    const res = await createApp().request("/api/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("maps domain errors to the error envelope", async () => {
    const app = createApp();
    app.get("/boom", () => {
      throw new ConflictError("already there");
    });
    const res = await app.request("/boom", {}, env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "conflict", message: "already there" } });
    expect(new ConflictError()).toBeInstanceOf(AppError);
  });

  it("hides internals on unexpected errors", async () => {
    const app = createApp();
    app.get("/crash", () => {
      throw new Error("db password leaked");
    });
    const res = await app.request("/crash", {}, env);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("leaked");
  });

  it("returns the error envelope for unknown routes", async () => {
    const res = await createApp().request("/api/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  });
});
