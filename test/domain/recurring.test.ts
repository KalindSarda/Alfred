import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrencesBetween, repeatLabel, ruleDayIsValid, type RuleShape, weekdayOf } from "../../src/domain/recurring";

const monthly = (day: number, extra: Partial<RuleShape> = {}): RuleShape => ({ frequency: "monthly", day, month: null, startDate: "2026-01-01", endDate: null, ...extra });
const weekly = (day: number, extra: Partial<RuleShape> = {}): RuleShape => ({ frequency: "weekly", day, month: null, startDate: "2026-01-01", endDate: null, ...extra });
const yearly = (month: number, day: number, extra: Partial<RuleShape> = {}): RuleShape => ({ frequency: "yearly", day, month, startDate: "2024-01-01", endDate: null, ...extra });

describe("weekdayOf", () => {
  it("counts Monday as 1 and Sunday as 7", () => {
    expect(weekdayOf("2026-10-26")).toBe(1); // a Monday
    expect(weekdayOf("2026-10-31")).toBe(6);
    expect(weekdayOf("2026-11-01")).toBe(7);
  });
});

describe("monthly", () => {
  it("falls on the day each month", () => {
    expect(occurrencesBetween(monthly(5), "2026-09-01", "2026-12-31")).toEqual(["2026-09-05", "2026-10-05", "2026-11-05", "2026-12-05"]);
  });

  it("the 31st becomes the last day of shorter months, including February in a leap year", () => {
    expect(occurrencesBetween(monthly(31), "2027-01-01", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(occurrencesBetween(monthly(31), "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("includes both ends of the range, and nothing outside it", () => {
    expect(occurrencesBetween(monthly(5), "2026-10-05", "2026-11-05")).toEqual(["2026-10-05", "2026-11-05"]);
    expect(occurrencesBetween(monthly(5), "2026-10-06", "2026-11-04")).toEqual([]);
  });

  it("respects the rule's own start and end", () => {
    const r = monthly(5, { startDate: "2026-10-10", endDate: "2027-01-05" });
    expect(occurrencesBetween(r, "2026-01-01", "2030-01-01")).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });

  it("leaves out skipped dates", () => {
    expect(occurrencesBetween(monthly(5, { skips: ["2026-11-05"] }), "2026-10-01", "2026-12-31")).toEqual(["2026-10-05", "2026-12-05"]);
  });
});

describe("weekly", () => {
  it("falls on the weekday every seven days", () => {
    expect(occurrencesBetween(weekly(1), "2026-10-26", "2026-11-16")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  });

  it("starts from the first matching weekday on or after the start", () => {
    expect(occurrencesBetween(weekly(5, { startDate: "2026-10-27" }), "2026-10-01", "2026-11-10")).toEqual(["2026-10-30", "2026-11-06"]);
  });
});

describe("yearly", () => {
  it("falls once a year", () => {
    expect(occurrencesBetween(yearly(3, 14), "2025-01-01", "2027-12-31")).toEqual(["2025-03-14", "2026-03-14", "2027-03-14"]);
  });

  it("29 February happens on the 28th in common years", () => {
    expect(occurrencesBetween(yearly(2, 29), "2027-01-01", "2028-12-31")).toEqual(["2027-02-28", "2028-02-29"]);
  });
});

describe("nextOccurrence", () => {
  it("is the first due date on or after the given day", () => {
    expect(nextOccurrence(monthly(5), "2026-10-05")).toBe("2026-10-05");
    expect(nextOccurrence(monthly(5), "2026-10-06")).toBe("2026-11-05");
    expect(nextOccurrence(yearly(3, 14), "2026-03-15")).toBe("2027-03-14");
  });

  it("steps over a skipped date, and is null once the rule has ended", () => {
    expect(nextOccurrence(monthly(5, { skips: ["2026-11-05"] }), "2026-10-06")).toBe("2026-12-05");
    expect(nextOccurrence(monthly(5, { endDate: "2026-11-30" }), "2026-12-01")).toBeNull();
  });

  it("is not before the rule starts", () => {
    expect(nextOccurrence(monthly(5, { startDate: "2027-02-01" }), "2026-10-06")).toBe("2027-02-05");
  });
});

describe("validity and labels", () => {
  it("accepts only days that can occur", () => {
    expect(ruleDayIsValid("weekly", 7, null)).toBe(true);
    expect(ruleDayIsValid("weekly", 8, null)).toBe(false);
    expect(ruleDayIsValid("monthly", 31, null)).toBe(true);
    expect(ruleDayIsValid("monthly", 0, null)).toBe(false);
    expect(ruleDayIsValid("monthly", 5, 3)).toBe(false);
    expect(ruleDayIsValid("yearly", 29, 2)).toBe(true);
    expect(ruleDayIsValid("yearly", 30, 2)).toBe(false);
    expect(ruleDayIsValid("yearly", 31, 4)).toBe(false);
    expect(ruleDayIsValid("yearly", 5, null)).toBe(false);
  });

  it("describes a rule in words", () => {
    expect(repeatLabel({ frequency: "weekly", day: 1, month: null })).toBe("Every Monday");
    expect(repeatLabel({ frequency: "monthly", day: 5, month: null })).toBe("Every month on the 5th");
    expect(repeatLabel({ frequency: "monthly", day: 22, month: null })).toBe("Every month on the 22nd");
    expect(repeatLabel({ frequency: "monthly", day: 11, month: null })).toBe("Every month on the 11th");
    expect(repeatLabel({ frequency: "monthly", day: 31, month: null })).toBe("Every month on the last day");
    expect(repeatLabel({ frequency: "yearly", day: 14, month: 3 })).toBe("Every year on 14 Mar");
  });
});
