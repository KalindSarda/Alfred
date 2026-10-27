import { describe, expect, it } from "vitest";
import { previousRange } from "../../src/services/dashboard";
import { nameFromEmail } from "../../src/services/settings";

describe("previousRange", () => {
  it("is the same number of days ending the day before", () => {
    expect(previousRange({ from: "2026-09-28", to: "2026-10-27" })).toEqual({ from: "2026-08-29", to: "2026-09-27" });
    expect(previousRange({ from: "2026-10-21", to: "2026-10-27" })).toEqual({ from: "2026-10-14", to: "2026-10-20" });
  });

  it("works for a single day and across a year boundary", () => {
    expect(previousRange({ from: "2026-10-27", to: "2026-10-27" })).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    expect(previousRange({ from: "2027-01-01", to: "2027-01-10" })).toEqual({ from: "2026-12-22", to: "2026-12-31" });
  });

  it("covers a full calendar month with the days before it", () => {
    expect(previousRange({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  });
});

describe("nameFromEmail", () => {
  it.each([
    ["kalind.s@youngsoft.in", "Kalind"],
    ["PRIYA_sharma@x.com", "Priya"],
    ["123.arjun@x.com", "Arjun"],
    ["a@x.com", "A"],
    ["1234@x.com", "there"],
  ])("%s -> %s", (email, expected) => {
    expect(nameFromEmail(email)).toBe(expected);
  });
});
