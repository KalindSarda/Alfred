import { describe, expect, it } from "vitest";
import { previousPeriodRange } from "../src/domain/dates";

describe("previousPeriodRange", () => {
  const today = "2026-10-27";

  it("compares the month so far with the same days of the one before", () => {
    expect(previousPeriodRange("cycle", today, 1)).toEqual({ from: "2026-09-01", to: "2026-09-27" });
    // a month that starts on the 30th: 27 Nov is its 29th day, so the same 29 days of the one before end on 28 Oct
    expect(previousPeriodRange("cycle", "2026-11-27", 30)).toEqual({ from: "2026-09-30", to: "2026-10-28" });
    expect(previousPeriodRange("this_month", today)).toEqual({ from: "2026-09-01", to: "2026-09-27" });
  });

  it("compares a rolling window with the window of the same length just before it", () => {
    expect(previousPeriodRange("7d", today)).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(previousPeriodRange("30d", today)).toEqual({ from: "2026-08-29", to: "2026-09-27" });
    expect(previousPeriodRange("90d", today)).toEqual({ from: "2026-05-01", to: "2026-07-29" });
  });

  it("compares last month with the month before it, whole", () => {
    expect(previousPeriodRange("last_month", today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(previousPeriodRange("last_month", "2026-01-10")).toEqual({ from: "2025-11-01", to: "2025-11-30" });
  });

  it("compares the year so far with the same dates a year earlier", () => {
    expect(previousPeriodRange("ytd", today)).toEqual({ from: "2025-01-01", to: "2025-10-27" });
    expect(previousPeriodRange("ytd", "2028-02-29")).toEqual({ from: "2027-01-01", to: "2027-02-28" });
  });

  it("clamps this month's days when the earlier month is shorter", () => {
    expect(previousPeriodRange("this_month", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
