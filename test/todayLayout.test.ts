import { describe, expect, it } from "vitest";
import { showIncomeCard } from "../web/src/cashflow";
import { parseNavStyle } from "../web/src/navChoice";

describe("the big-screen navigation choice", () => {
  it("is the sidebar unless the top bar was chosen", () => {
    expect(parseNavStyle("top")).toBe("top");
    expect(parseNavStyle("side")).toBe("side");
    for (const v of [null, undefined, "", "Top", "bottom", "left"]) expect(parseNavStyle(v), String(v)).toBe("side");
  });
});

describe("the phone's income card", () => {
  it("shows only when something came in", () => {
    expect(showIncomeCard({ incomePaise: 1 })).toBe(true);
    expect(showIncomeCard({ incomePaise: 0 })).toBe(false);
  });
});
