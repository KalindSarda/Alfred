import { describe, expect, it } from "vitest";
import { FEATURES } from "../web/src/features";
import { HUB_PATHS, hubOf, redirectFor } from "../web/src/routes";

describe("the five places", () => {
  it("puts each page under one of Today, Activity, Money, Plan or You", () => {
    expect(hubOf("/")).toBe("today");
    expect(hubOf("/activity")).toBe("activity");
    expect(hubOf("/money")).toBe("money");
    expect(hubOf("/plan")).toBe("plan");
    for (const p of ["/you", "/settings", "/categories"]) expect(hubOf(p), p).toBe("you");
    for (const hub of Object.keys(HUB_PATHS) as (keyof typeof HUB_PATHS)[]) expect(hubOf(HUB_PATHS[hub])).toBe(hub);
  });
});

describe("old addresses", () => {
  it("move to their new place and keep the query and section", () => {
    expect(redirectFor("/transactions", "?category=none", "")).toBe("/activity?category=none");
    expect(redirectFor("/accounts", "?view=commitments", "#loans")).toBe("/money?view=commitments#loans");
    expect(redirectFor("/budgets", "", "")).toBe("/plan?view=budgets");
    expect(redirectFor("/budgets", "?view=goals", "")).toBe("/plan?view=goals");
    expect(redirectFor("/more", "", "")).toBe("/you");
  });

  it("turn Freedom and Protection into views of Plan", () => {
    expect(redirectFor("/freedom", "", "#foundations")).toBe("/plan?view=foundations#foundations");
    expect(redirectFor("/protection", "", "")).toBe("/plan?view=protection");
  });

  it("leave current addresses alone", () => {
    for (const p of ["/", "/activity", "/money", "/plan", "/you", "/settings", "/categories", "/setup"]) expect(redirectFor(p, "", ""), p).toBeNull();
  });

  it("are never what the features list points at", () => {
    for (const f of FEATURES) {
      const url = new URL(f.to, "https://x.test");
      expect(redirectFor(url.pathname, url.search, url.hash), f.id).toBeNull();
    }
  });
});
