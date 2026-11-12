import { describe, expect, it } from "vitest";
import { caretAfter, formatAmountInput, formatRupees, formatRupeesCompact, parsePaise } from "../../src/domain/money";

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

describe("formatRupeesCompact", () => {
  const rupees = (n: number) => n * 100;
  it("keeps the full figure under a lakh", () => {
    expect(formatRupeesCompact(rupees(45_000))).toBe("₹45,000");
    expect(formatRupeesCompact(rupees(99_999))).toBe("₹99,999");
    expect(formatRupeesCompact(123_456)).toBe("₹1,234.56");
    expect(formatRupeesCompact(0)).toBe("₹0");
  });

  it("shows lakhs to two decimals with trailing zeros dropped", () => {
    expect(formatRupeesCompact(rupees(100_000))).toBe("₹1 L");
    expect(formatRupeesCompact(rupees(150_000))).toBe("₹1.5 L");
    expect(formatRupeesCompact(rupees(723_100))).toBe("₹7.23 L");
    expect(formatRupeesCompact(rupees(704_549))).toBe("₹7.05 L");
    expect(formatRupeesCompact(rupees(9_900_000))).toBe("₹99 L");
  });

  it("moves to crores at a crore, and when a lakh figure rounds up to one", () => {
    expect(formatRupeesCompact(rupees(10_000_000))).toBe("₹1 Cr");
    expect(formatRupeesCompact(rupees(72_300_000))).toBe("₹7.23 Cr");
    expect(formatRupeesCompact(rupees(9_999_999))).toBe("₹1 Cr");
    expect(formatRupeesCompact(rupees(12_345_000_000))).toBe("₹1,234.5 Cr");
  });

  it("keeps the sign and can drop the symbol", () => {
    expect(formatRupeesCompact(rupees(-723_100))).toBe("-₹7.23 L");
    expect(formatRupeesCompact(rupees(-4_500))).toBe("-₹4,500");
    expect(formatRupeesCompact(rupees(150_000), { symbol: false })).toBe("1.5 L");
  });

  it("rejects what is not integer paise", () => {
    expect(() => formatRupeesCompact(1.5)).toThrow(RangeError);
  });
});

describe("formatAmountInput", () => {
  it("groups the whole part the Indian way as digits are typed", () => {
    expect(formatAmountInput("1")).toBe("1");
    expect(formatAmountInput("1234")).toBe("1,234");
    expect(formatAmountInput("123456")).toBe("1,23,456");
    expect(formatAmountInput("1234567")).toBe("12,34,567");
    expect(formatAmountInput("12,34,5678")).toBe("1,23,45,678");
  });

  it("keeps up to two decimals and a trailing point", () => {
    expect(formatAmountInput("1200.")).toBe("1,200.");
    expect(formatAmountInput("1200.5")).toBe("1,200.5");
    expect(formatAmountInput("1200.567")).toBe("1,200.56");
    expect(formatAmountInput(".5")).toBe("0.5");
    expect(formatAmountInput("12.3.4")).toBe("12.34");
  });

  it("drops junk, leading zeros and anything past twelve digits", () => {
    expect(formatAmountInput("₹ 1,200 rs")).toBe("1,200");
    expect(formatAmountInput("0012")).toBe("12");
    expect(formatAmountInput("0")).toBe("0");
    expect(formatAmountInput("")).toBe("");
    expect(formatAmountInput("1234567890123456")).toBe("1,23,45,67,89,012");
  });

  it("allows a leading minus only where asked", () => {
    expect(formatAmountInput("-1500")).toBe("1,500");
    expect(formatAmountInput("-1500", true)).toBe("-1,500");
    expect(formatAmountInput("-", true)).toBe("-");
  });
});

describe("caretAfter", () => {
  it("puts the caret after the same number of digits once commas are added", () => {
    expect(caretAfter("12,34,567", 7)).toBe(9);
    expect(caretAfter("1,234", 1)).toBe(1);
    expect(caretAfter("1,234", 2)).toBe(3);
    expect(caretAfter("1,200.5", 6)).toBe(7);
    expect(caretAfter("1,234", 0)).toBe(0);
    expect(caretAfter("-1,234", 0)).toBe(1);
    expect(caretAfter("1,234", 99)).toBe(5);
  });
});
