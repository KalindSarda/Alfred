import { describe, expect, it } from "vitest";
import { type Commitment, freeToSpend, horizonDate, nextMonthDay, shortfalls, sortCommitments, uncountedPaise, within } from "../../src/domain/commitments";

const c = (over: Partial<Commitment>): Commitment => ({
  key: "recurring:r",
  date: "2026-11-05",
  title: "Rent",
  amountPaise: 35_700_00,
  source: "recurring",
  accountId: "hdfc",
  accountName: "HDFC",
  accountKind: "bank",
  counted: false,
  ...over,
});

describe("commitments", () => {
  it("takes off only what safe-to-spend does not already hold back", () => {
    const items = [c({}), c({ key: "card:a", source: "card", title: "Card bill", amountPaise: 10_000_00, accountId: null, accountKind: null, counted: true }), c({ key: "loan:l", source: "loan", title: "Loan", date: "2026-11-10", amountPaise: 20_000_00 })];
    expect(uncountedPaise(items, "2026-11-01", "2026-11-30")).toBe(55_700_00);
    expect(freeToSpend(1_00_000_00, items, "2026-11-01", "2026-11-30")).toBe(44_300_00);
  });

  it("counts the window as from today up to, not including, the salary day", () => {
    const items = [c({ date: "2026-11-04" }), c({ key: "a", date: "2026-11-05" }), c({ key: "b", date: "2026-11-30" })];
    expect(within(items, "2026-11-05", "2026-11-30").map((x) => x.key)).toEqual(["a"]);
    expect(freeToSpend(100_000_00, items, "2026-11-05", "2026-11-30")).toBe(100_000_00 - 35_700_00);
  });

  it("can be negative, when the commitments are more than what is free", () => {
    expect(freeToSpend(10_000_00, [c({})], "2026-11-01", "2026-11-30")).toBe(10_000_00 - 35_700_00);
  });

  it("sorts by date, then title", () => {
    const sorted = sortCommitments([c({ date: "2026-11-09", title: "B" }), c({ date: "2026-11-05", title: "Z" }), c({ date: "2026-11-05", title: "A" })]);
    expect(sorted.map((x) => `${x.date} ${x.title}`)).toEqual(["2026-11-05 A", "2026-11-05 Z", "2026-11-09 B"]);
  });

  it("ends the window at the next salary, or at the next month start when none is known", () => {
    expect(horizonDate("2026-11-06", "2026-11-30", 1)).toEqual({ until: "2026-11-30", basis: "salary" });
    expect(horizonDate("2026-11-06", null, 1)).toEqual({ until: "2026-12-01", basis: "month" });
    expect(horizonDate("2026-11-06", "2026-11-06", 25)).toEqual({ until: "2026-11-25", basis: "month" });
    expect(horizonDate("2026-11-26", null, 25)).toEqual({ until: "2026-12-25", basis: "month" });
  });

  it("clamps a month-start day to a short month", () => {
    expect(nextMonthDay("2027-02-10", 31)).toBe("2027-02-28");
    expect(nextMonthDay("2027-02-28", 31)).toBe("2027-03-31");
  });
});

describe("shortfalls", () => {
  const balances = new Map([["hdfc", 40_000_00]]);

  it("reports a debit the account cannot cover, and by how much", () => {
    const result = shortfalls([c({ amountPaise: 50_000_00 })], balances);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ balancePaise: 40_000_00, shortByPaise: 10_000_00 });
  });

  it("counts earlier debits from the same account first", () => {
    const items = [c({ key: "a", date: "2026-11-05", amountPaise: 30_000_00 }), c({ key: "b", date: "2026-11-06", amountPaise: 15_000_00 })];
    const result = shortfalls(items, balances);
    expect(result.map((r) => r.commitment.key)).toEqual(["b"]);
    expect(result[0]).toMatchObject({ balancePaise: 10_000_00, shortByPaise: 5_000_00 });
  });

  it("says nothing when the balance covers it, and ignores cards, counted items and no account", () => {
    expect(shortfalls([c({ amountPaise: 40_000_00 })], balances)).toEqual([]);
    expect(shortfalls([c({ source: "card", counted: true, amountPaise: 90_000_00 })], balances)).toEqual([]);
    expect(shortfalls([c({ accountId: null, accountKind: null, amountPaise: 90_000_00 })], balances)).toEqual([]);
    expect(shortfalls([c({ accountKind: "card", amountPaise: 90_000_00 })], balances)).toEqual([]);
    expect(shortfalls([c({ accountId: "other", amountPaise: 90_000_00 })], balances)).toEqual([]);
  });

  it("an account already short stays short for the next debit", () => {
    const result = shortfalls([c({ key: "a", amountPaise: 50_000_00 }), c({ key: "b", date: "2026-11-06", amountPaise: 5_000_00 })], balances);
    expect(result.map((r) => [r.commitment.key, r.shortByPaise])).toEqual([["a", 10_000_00], ["b", 5_000_00]]);
  });
});
