import { describe, expect, it } from "vitest";
import {
  addDays,
  clampDay,
  daysInMonth,
  isValidIstDate,
  monthRange,
  resolvePeriod,
  shiftMonth,
  toIstDate,
} from "../../src/domain/dates";

describe("toIstDate", () => {
  it("rolls to the next IST day after 18:30 UTC", () => {
    expect(toIstDate(new Date("2026-10-26T18:29:59Z"))).toBe("2026-10-26");
    expect(toIstDate(new Date("2026-10-26T18:30:00Z"))).toBe("2026-10-27");
  });

  it("handles year rollover", () => {
    expect(toIstDate(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("month arithmetic", () => {
  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("clamps days that do not exist", () => {
    expect(clampDay(2026, 2, 30)).toBe("2026-02-28");
    expect(clampDay(2028, 2, 30)).toBe("2028-02-29");
    expect(clampDay(2026, 4, 31)).toBe("2026-04-30");
    expect(clampDay(2026, 1, 31)).toBe("2026-01-31");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("shifts months across years", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 6, -18)).toEqual({ year: 2024, month: 12 });
  });

  it("validates dates strictly", () => {
    expect(isValidIstDate("2026-02-29")).toBe(false);
    expect(isValidIstDate("2028-02-29")).toBe(true);
    expect(isValidIstDate("2026-13-01")).toBe(false);
    expect(isValidIstDate("26-1-1")).toBe(false);
  });

  it("gives the range of a month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("resolvePeriod", () => {
  const today = "2026-10-26";
  it("rolling periods include today", () => {
    expect(resolvePeriod("7d", today)).toEqual({ from: "2026-10-20", to: today });
    expect(resolvePeriod("30d", today)).toEqual({ from: "2026-09-27", to: today });
    expect(resolvePeriod("90d", today)).toEqual({ from: "2026-07-29", to: today });
  });

  it("this month, last month and year to date", () => {
    expect(resolvePeriod("this_month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(resolvePeriod("last_month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod("ytd", today)).toEqual({ from: "2026-01-01", to: today });
  });

  it("last month in January is December of the previous year", () => {
    expect(resolvePeriod("last_month", "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
