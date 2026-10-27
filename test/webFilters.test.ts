import { describe, expect, it } from "vitest";
import { activeFilterCount, emptyFilters, filtersFromSearch, filtersToSearch, rupeesToPaise, toApiParams, transactionsLink } from "../web/src/filters";

describe("filters in the address bar", () => {
  it("round-trips every filter", () => {
    const f = { ...emptyFilters, q: "dinner", account: "a1", categories: ["c1", "none"], type: "expense" as const, status: "draft" as const, from: "2026-10-01", to: "2026-10-31", min: "100", max: "5000" };
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f);
  });

  it("an empty filter set produces an empty query string", () => {
    expect(filtersToSearch(emptyFilters)).toBe("");
    expect(filtersFromSearch("")).toEqual(emptyFilters);
  });

  it("ignores unknown types and statuses from a hand-edited address", () => {
    expect(filtersFromSearch("?type=bogus&status=weird")).toMatchObject({ type: "", status: "" });
  });

  it("builds links used by the briefing and charts", () => {
    expect(transactionsLink({ categories: ["none"] })).toBe("/transactions?category=none");
    expect(transactionsLink({ status: "draft" })).toBe("/transactions?status=draft");
    expect(transactionsLink({})).toBe("/transactions");
  });
});

describe("API parameters", () => {
  it("converts rupee amounts to paise and renames fields", () => {
    const p = toApiParams({ ...emptyFilters, account: "a1", categories: ["c1", "c2"], min: "1,200", max: "5000.50", from: "2026-10-01" });
    expect(p.get("accountId")).toBe("a1");
    expect(p.get("categoryId")).toBe("c1,c2");
    expect(p.get("minAmountPaise")).toBe("120000");
    expect(p.get("maxAmountPaise")).toBe("500050");
    expect(p.get("from")).toBe("2026-10-01");
  });

  it("skips empty or invalid amounts instead of sending junk", () => {
    const p = toApiParams({ ...emptyFilters, min: "abc", max: "" });
    expect(p.has("minAmountPaise")).toBe(false);
    expect(p.has("maxAmountPaise")).toBe(false);
  });

  it("parses rupee text", () => {
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("0")).toBe(0);
    expect(rupeesToPaise("450")).toBe(45000);
    expect(rupeesToPaise("-5")).toBeNull();
  });
});

describe("activeFilterCount", () => {
  it("counts a date range, a category list and an amount pair once each", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
    expect(activeFilterCount({ ...emptyFilters, from: "2026-10-01", to: "2026-10-31" })).toBe(1);
    expect(activeFilterCount({ ...emptyFilters, categories: ["a", "b"], min: "1", max: "2" })).toBe(3);
  });
});
