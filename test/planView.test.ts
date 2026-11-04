import { describe, expect, it } from "vitest";
import { planPath, searchForView, viewFromSearch } from "../web/src/planView";

describe("the Plan page view", () => {
  it("is Budgets unless the address asks for Recurring", () => {
    expect(viewFromSearch("")).toBe("budgets");
    expect(viewFromSearch("?view=recurring")).toBe("recurring");
    expect(viewFromSearch("?x=1&view=recurring")).toBe("recurring");
  });

  it("treats anything else as Budgets", () => {
    for (const search of ["?view=", "?view=other", "?view=Recurring", "?views=recurring", "?view=budgets", "?view=goals"]) {
      expect(viewFromSearch(search), search).toBe("budgets");
    }
  });

  it("writes the address back, leaving the default view clean", () => {
    expect(searchForView("budgets")).toBe("");
    expect(searchForView("recurring")).toBe("?view=recurring");
    expect(planPath("budgets")).toBe("/plan");
    expect(planPath("recurring")).toBe("/plan?view=recurring");
    expect(viewFromSearch(searchForView("recurring"))).toBe("recurring");
  });
});
