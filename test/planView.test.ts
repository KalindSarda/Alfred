import { describe, expect, it } from "vitest";
import { planPath, searchForView, viewFromSearch } from "../web/src/planView";

describe("the Plan page view", () => {
  it("is the overview unless the address asks for another view", () => {
    expect(viewFromSearch("")).toBe("overview");
    expect(viewFromSearch("?view=budgets")).toBe("budgets");
    expect(viewFromSearch("?view=recurring")).toBe("recurring");
    expect(viewFromSearch("?x=1&view=recurring")).toBe("recurring");
    expect(viewFromSearch("?view=goals")).toBe("goals");
    expect(viewFromSearch("?view=foundations")).toBe("foundations");
    expect(viewFromSearch("?view=protection")).toBe("protection");
  });

  it("treats anything else as the overview", () => {
    for (const search of ["?view=", "?view=other", "?view=Recurring", "?views=recurring", "?view=overview", "?view=Goals"]) {
      expect(viewFromSearch(search), search).toBe("overview");
    }
  });

  it("writes the address back, leaving the default view clean", () => {
    expect(searchForView("overview")).toBe("");
    expect(searchForView("budgets")).toBe("?view=budgets");
    expect(searchForView("recurring")).toBe("?view=recurring");
    expect(searchForView("goals")).toBe("?view=goals");
    expect(planPath("goals")).toBe("/plan?view=goals");
    expect(planPath("overview")).toBe("/plan");
    expect(planPath("budgets")).toBe("/plan?view=budgets");
    expect(planPath("recurring")).toBe("/plan?view=recurring");
    expect(planPath("foundations")).toBe("/plan?view=foundations");
    expect(viewFromSearch(searchForView("recurring"))).toBe("recurring");
  });
});
