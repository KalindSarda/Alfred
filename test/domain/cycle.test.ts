import { describe, expect, it } from "vitest";
import { cycleRange, previousCycleSameDays, resolvePeriod } from "../../src/domain/dates";

describe("cycleRange", () => {
  it("with start day 1 it is the calendar month", () => {
    expect(cycleRange("2026-10-27", 1)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(cycleRange("2026-02-10", 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("a payday on the 30th runs 30th to 29th", () => {
    expect(cycleRange("2026-10-31", 30)).toEqual({ from: "2026-10-30", to: "2026-11-29" });
    expect(cycleRange("2026-11-15", 30)).toEqual({ from: "2026-10-30", to: "2026-11-29" });
    expect(cycleRange("2026-10-30", 30)).toEqual({ from: "2026-10-30", to: "2026-11-29" });
  });

  it("the day before payday still belongs to the cycle that is ending", () => {
    expect(cycleRange("2026-11-29", 30)).toEqual({ from: "2026-10-30", to: "2026-11-29" });
    expect(cycleRange("2026-11-30", 30)).toEqual({ from: "2026-11-30", to: "2026-12-29" });
  });

  it("clamps a start day that does not exist in a short month", () => {
    // 30 becomes 28 in February 2027, so the cycle starting in January ends on 27 Feb... and the next starts on the 28th
    expect(cycleRange("2027-02-10", 30)).toEqual({ from: "2027-01-30", to: "2027-02-27" });
    expect(cycleRange("2027-02-28", 30)).toEqual({ from: "2027-02-28", to: "2027-03-29" });
    expect(cycleRange("2028-02-29", 30)).toEqual({ from: "2028-02-29", to: "2028-03-29" });
    expect(cycleRange("2026-04-30", 31)).toEqual({ from: "2026-04-30", to: "2026-05-30" });
  });

  it("crosses the year boundary", () => {
    expect(cycleRange("2026-12-31", 30)).toEqual({ from: "2026-12-30", to: "2027-01-29" });
    expect(cycleRange("2027-01-05", 30)).toEqual({ from: "2026-12-30", to: "2027-01-29" });
  });

  it("every day belongs to exactly one cycle and cycles tile without gaps", () => {
    let day = "2026-01-01";
    let previous: { from: string; to: string } | null = null;
    const nextDay = (d: string) => {
      const date = new Date(`${d}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString().slice(0, 10);
    };
    for (let i = 0; i < 400; i++) {
      const range = cycleRange(day, 30);
      expect(range.from <= day && day <= range.to).toBe(true);
      // when a new cycle begins it starts the day after the previous one ended
      if (previous && range.from !== previous.from) expect(range.from).toBe(nextDay(previous.to));
      previous = range;
      day = nextDay(day);
    }
  });
});

describe("resolvePeriod with a cycle", () => {
  it("uses the given start day, and defaults to calendar months", () => {
    expect(resolvePeriod("cycle", "2026-11-15", 30)).toEqual({ from: "2026-10-30", to: "2026-11-29" });
    expect(resolvePeriod("cycle", "2026-11-15")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
});

describe("previousCycleSameDays", () => {
  it("compares the same number of elapsed days with the previous cycle", () => {
    // 10 days into a cycle that started on the 30th: day index 9 after the start (inclusive of today)
    expect(previousCycleSameDays("2026-11-09", 30)).toEqual({ from: "2026-09-30", to: "2026-10-10" });
  });

  it("on the first day it is just the previous cycle's first day", () => {
    expect(previousCycleSameDays("2026-10-30", 30)).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("never runs past the end of a shorter previous cycle", () => {
    // previous cycle (2027-02-28 .. 2027-03-29 has 30 days); current starts 2027-03-30 and runs 31 days
    const range = previousCycleSameDays("2027-04-28", 30);
    expect(range.from).toBe("2027-02-28");
    expect(range.to <= "2027-03-29").toBe(true);
  });

  it("works for calendar months", () => {
    expect(previousCycleSameDays("2026-10-10", 1)).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  });
});
