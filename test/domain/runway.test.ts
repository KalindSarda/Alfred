import { describe, expect, it } from "vitest";
import { MIN_DAYS, runway } from "../../src/domain/runway";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

describe("runway", () => {
  it("is the liquid money over a month of essential spending", () => {
    // 20 days of history (11 to 30 Oct), 30,000 spent: 1,500 a day, 45,000 a month.
    const r = runway(2_70_000_00, [{ date: day(15), amountPaise: 30_000_00 }], day(11), day(30));
    expect(r).toMatchObject({ basedOnDays: 20, burnPaise: 45_000_00, months: 6, solid: false, essentialPaise: 30_000_00 });
  });

  it("rounds the months down to one decimal", () => {
    const r = runway(1_00_000_00, [{ date: day(15), amountPaise: 30_000_00 }], day(11), day(30));
    expect(r.months).toBe(2.2);
  });

  it("says nothing with under two weeks of history, or when nothing essential was spent", () => {
    expect(runway(1_00_000_00, [{ date: day(28), amountPaise: 5_000_00 }], day(25), day(30))).toMatchObject({ burnPaise: null, months: null, basedOnDays: 6 });
    expect(MIN_DAYS).toBe(14);
    expect(runway(1_00_000_00, [], day(1), day(30))).toMatchObject({ burnPaise: null, months: null });
    expect(runway(1_00_000_00, [], null, day(30))).toMatchObject({ burnPaise: null, basedOnDays: 0 });
  });

  it("looks back 90 days at most, and counts only what falls in the window", () => {
    const r = runway(9_00_000_00, [{ date: "2026-06-01", amountPaise: 99_999_00 }, { date: "2026-09-01", amountPaise: 90_000_00 }], "2026-01-01", "2026-10-30");
    expect(r.basedOnDays).toBe(90);
    expect(r.windowFrom).toBe("2026-08-02");
    expect(r.essentialPaise).toBe(90_000_00);
    expect(r.burnPaise).toBe(30_000_00);
    expect(r.solid).toBe(true);
  });

  it("is zero months with no money, and never negative", () => {
    expect(runway(0, [{ date: day(15), amountPaise: 30_000_00 }], day(11), day(30)).months).toBe(0);
    expect(runway(-5_000_00, [{ date: day(15), amountPaise: 30_000_00 }], day(11), day(30)).months).toBe(0);
  });
});
