import { describe, expect, it } from "vitest";
import { accountsPath, searchForView, viewFromSearch } from "../web/src/accountsView";

describe("the Accounts page view", () => {
  it("is Accounts unless the address asks for Commitments", () => {
    expect(viewFromSearch("")).toBe("accounts");
    expect(viewFromSearch("?view=commitments")).toBe("commitments");
    expect(viewFromSearch("?x=1&view=commitments")).toBe("commitments");
    expect(viewFromSearch("?view=investments")).toBe("investments");
  });

  it("treats anything else as Accounts", () => {
    for (const search of ["?view=", "?view=other", "?view=Commitments", "?views=commitments", "?view=accounts"]) {
      expect(viewFromSearch(search), search).toBe("accounts");
    }
    expect(viewFromSearch("?view=other")).toBe("accounts");
    expect(viewFromSearch("?view=Commitments")).toBe("accounts");
  });

  it("writes the address back, leaving the default view clean", () => {
    expect(searchForView("accounts")).toBe("");
    expect(searchForView("commitments")).toBe("?view=commitments");
    expect(accountsPath("accounts")).toBe("/money");
    expect(accountsPath("commitments")).toBe("/money?view=commitments");
    expect(searchForView("investments")).toBe("?view=investments");
    expect(accountsPath("investments")).toBe("/money?view=investments");
    expect(viewFromSearch(searchForView("commitments"))).toBe("commitments");
  });
});
