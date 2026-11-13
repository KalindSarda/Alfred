import { describe, expect, it } from "vitest";
import { showIncomeCard } from "../web/src/cashflow";

describe("the phone's income card", () => {
  it("shows only when something came in", () => {
    expect(showIncomeCard({ incomePaise: 1 })).toBe(true);
    expect(showIncomeCard({ incomePaise: 0 })).toBe(false);
  });
});
