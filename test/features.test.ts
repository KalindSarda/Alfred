import { describe, expect, it } from "vitest";
import { FEATURES, groupedFeatures, pushRecent, searchFeatures } from "../web/src/features";

const top = (q: string, owner = false) => searchFeatures(q, FEATURES, owner)[0]?.id;

describe("the feature list", () => {
  it("has unique ids and addresses that start with a slash", () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    for (const f of FEATURES) expect(f.to, f.id).toMatch(/^\/[a-z-]*([?#].*)?$/);
  });

  it("shows every group that has something, in order, and hides owner-only items from others", () => {
    expect(groupedFeatures().map((g) => g.group)).toEqual(["Today", "Money", "Plan", "Tidy up", "You"]);
    expect(groupedFeatures(FEATURES, false).flatMap((g) => g.items).some((f) => f.id === "people")).toBe(false);
    expect(groupedFeatures(FEATURES, true).flatMap((g) => g.items).some((f) => f.id === "people")).toBe(true);
  });
});

describe("finding a feature", () => {
  it("finds things by the names people use", () => {
    expect(top("emi")).toBe("emi");
    expect(top("lent")).toBe("lent");
    expect(top("borrowed")).toBe("lent");
    expect(top("udhaar")).toBe("lent");
    expect(top("goal")).toBe("goals");
    expect(top("ipo")).toBe("blocked");
    expect(top("export")).toBe("export");
    expect(top("budget")).toBe("budgets");
    expect(top("subscription")).toBe("recurring");
    expect(top("categories")).toBe("categories");
    expect(top("logout")).toBe("signout");
  });

  it("prefers a title match over a keyword match, and ignores case and punctuation", () => {
    expect(top("Recurring")).toBe("recurring");
    expect(top("  SAVINGS  goals!! ")).toBe("goals");
    expect(searchFeatures("budget")[0]?.id).toBe("budgets");
  });

  it("matches the start of a word and needs every word to fit", () => {
    expect(top("lend")).toBe("lent");
    expect(top("net wor")).toBe("networth");
    expect(searchFeatures("emi zzzz")).toEqual([]);
  });

  it("gives nothing for nothing or for nonsense", () => {
    expect(searchFeatures("")).toEqual([]);
    expect(searchFeatures("   ")).toEqual([]);
    expect(searchFeatures("qqqqqq")).toEqual([]);
  });

  it("only offers inviting people to the owner", () => {
    expect(top("invite", false)).not.toBe("people");
    expect(top("invite", true)).toBe("people");
  });
});

describe("recently used features", () => {
  it("puts the latest first, once each, keeping five", () => {
    expect(pushRecent([], "emi")).toEqual(["emi"]);
    expect(pushRecent(["emi", "lent"], "lent")).toEqual(["lent", "emi"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
  });
});
