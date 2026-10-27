import { describe, expect, it } from "vitest";
import { formatRupees, parsePaise } from "../../src/domain/money";

describe("parsePaise", () => {
  it.each([
    ["450", 45000],
    ["450.5", 45050],
    ["450.50", 45050],
    ["0.99", 99],
    ["1,200", 120000],
    ["1,20,000.75", 12000075],
    ["₹1,200", 120000],
    ["rs 99", 9900],
    ["Rs.99", 9900],
    ["INR 10", 1000],
    ["  75  ", 7500],
  ])("parses %s", (input, expected) => {
    expect(parsePaise(input)).toBe(expected);
  });

  it.each(["", "abc", "0", "0.00", "-5", "1.234", "12.", ".5", "1e5", "4 50", "450 food", "99999999999999"])(
    "rejects %s",
    (input) => {
      expect(parsePaise(input)).toBeNull();
    },
  );

  it("never produces float artifacts", () => {
    expect(parsePaise("0.29")).toBe(29);
    expect(parsePaise("19.99")).toBe(1999);
  });
});

describe("formatRupees", () => {
  it.each([
    [0, "₹0"],
    [99, "₹0.99"],
    [45000, "₹450"],
    [100000, "₹1,000"],
    [20000000, "₹2,00,000"],
    [31000000, "₹3,10,000"],
    [7900000, "₹79,000"],
    [123456789, "₹12,34,567.89"],
    [-45000, "-₹450"],
    [4505, "₹45.05"],
  ])("formats %i", (paise, expected) => {
    expect(formatRupees(paise)).toBe(expected);
  });

  it("can omit the symbol", () => {
    expect(formatRupees(20000000, { symbol: false })).toBe("2,00,000");
  });

  it("rejects non-integer paise", () => {
    expect(() => formatRupees(10.5)).toThrow(RangeError);
  });
});
