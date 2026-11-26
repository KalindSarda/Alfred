import { describe, expect, it } from "vitest";
import { makeApp } from "./api-helpers";

// Guards the session middleware (`app.use("/api/*", requireSession)`) against router quirks.
// Hono's RegExpRouter once skipped wildcard middleware for some paths (fixed in 4.13.16), so every
// protected route must answer only 401 or 404 for odd paths when nobody is signed in.
// Routes: the protected mounts in src/app.ts. Public ones (health, auth sign-in, telegram) are left out.
const PROTECTED = [
  "me", "accounts", "transactions", "categories", "money-health", "runway", "emergency-fund", "fire", "ladder",
  "transfer-suggestion", "investment-accounts", "protection", "insurance", "cards", "balance-check", "commitments",
  "holding-kinds", "settings", "demo-data", "dashboard", "alfred", "budgets", "export", "people", "holds",
  "emi-plans", "recurring", "debts", "partners", "allowance", "prices", "investment-trend", "contacts", "goals",
  "entry-hints", "holdings", "loans", "telegram",
];

const oddPaths = (name: string): string[] => {
  const p = `/api/${name}`;
  return [
    p, `${p}/`, `${p}//`, `${p}/.`, `${p}.`, `${p}/x`, `${p}//x`,
    `/api//${name}`, `//api/${name}`, `/api/./${name}`, `/api/x/../${name}`,
    `/API/${name}`, `/api/${name.toUpperCase()}`, `/Api/${name}/`,
    `/api%2F${name}`, `/api/%2F${name}`, `/api/${name}%2F`, `/api/${name}%2Fx`, `/api/%61${name.slice(1)}`,
    `${p}%0A`, `${p}%0D`, `${p}/%0A`, `/api/%0A${name}`, `${p}/\\x`,`${p}%5Cx`,
  ];
};

describe("protected routes without a session", () => {
  it("answer only 401 or 404 for odd paths and methods", async () => {
    const app = makeApp();
    const bad: string[] = [];
    let probes = 0;
    for (const name of PROTECTED) {
      for (const path of oddPaths(name)) {
        for (const method of ["GET", "POST", "DELETE"]) {
          probes++;
          const res = await app.call(method, path, method === "POST" ? { body: {} } : {});
          if (res.status !== 401 && res.status !== 404) bad.push(`${method} ${path} -> ${res.status}`);
        }
      }
    }
    expect(probes).toBeGreaterThan(2000);
    expect(bad).toEqual([]);
  });

  it("still answers 401 on the plain protected path (not just 404 everywhere)", async () => {
    const app = makeApp();
    for (const name of PROTECTED) expect((await app.call("GET", `/api/${name}`)).status).toBe(401);
  });
});
