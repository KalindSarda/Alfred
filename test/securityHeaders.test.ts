import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

describe("security headers", () => {
  it("are on a public API response", async () => {
    const res = await makeApp().call("GET", "/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("are on errors too, so a refused request is just as locked down", async () => {
    const res = await makeApp().call("GET", "/api/accounts");
    expect(res.status).toBe(401);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("are on a signed-in response carrying money data", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const res = await app.call("GET", "/api/budgets", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
