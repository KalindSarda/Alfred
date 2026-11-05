import { describe, expect, it } from "vitest";
import { bpFromPct, dueDatesUpTo, emiAfterPrepayment, emiAfterRateChange, emiClearsLoan, firstDueAfter, levelEmi, monthsToClear, nextInstalment, projectSchedule } from "../../src/domain/loans";

describe("one instalment", () => {
  it("is interest on what is outstanding, and the rest of the EMI repays principal", () => {
    // 10,00,000 at 9% a year: a month's interest is 7,500.
    const split = nextInstalment(1_000_000_00, 900, 20_000_00);
    expect(split).toEqual({ interestPaise: 7_500_00, principalPaise: 12_500_00, totalPaise: 20_000_00 });
  });

  it("the last one clears what is left, with its interest, and may be smaller", () => {
    const split = nextInstalment(15_000_00, 1200, 20_000_00);
    expect(split).toEqual({ interestPaise: 150_00, principalPaise: 15_000_00, totalPaise: 15_150_00 });
  });

  it("is nothing once nothing is owed", () => {
    expect(nextInstalment(0, 900, 20_000_00)).toBeNull();
  });

  it("an EMI that cannot beat the interest repays no principal, and is flagged", () => {
    expect(emiClearsLoan(1_000_000_00, 900, 7_000_00)).toBe(false);
    expect(emiClearsLoan(1_000_000_00, 900, 8_000_00)).toBe(true);
    expect(nextInstalment(1_000_000_00, 900, 7_000_00)).toMatchObject({ principalPaise: 0 });
    expect(monthsToClear(1_000_000_00, 900, 7_000_00)).toBeNull();
  });
});

describe("the EMI and the schedule", () => {
  it("levelEmi matches the card EMI maths: 1,17,455.45 at 16% over 6 months", () => {
    expect(Math.abs(levelEmi(11_745_545, 1600, 6) - 2_049_969)).toBeLessThanOrEqual(100);
  });

  it("the schedule clears the loan exactly and the last row is the smallest", () => {
    const emi = levelEmi(5_000_000_00, 850, 60);
    const rows = projectSchedule(5_000_000_00, 850, emi, "2026-12-05", 5);
    expect(rows).toHaveLength(60);
    expect(rows.reduce((s, r) => s + r.principalPaise, 0)).toBe(5_000_000_00);
    expect(rows.at(-1)!.balancePaise).toBe(0);
    expect(rows[0]).toMatchObject({ n: 1, date: "2026-12-05" });
    expect(rows[1]!.date).toBe("2027-01-05");
    expect(rows.every((r) => r.totalPaise === r.principalPaise + r.interestPaise)).toBe(true);
    expect(rows.at(-1)!.totalPaise).toBeLessThanOrEqual(emi);
  });

  it("monthsToClear agrees with the schedule, and with the months the EMI was worked out for", () => {
    const emi = levelEmi(2_000_000_00, 1000, 24);
    expect(monthsToClear(2_000_000_00, 1000, emi)).toBe(24);
    expect(monthsToClear(0, 1000, emi)).toBe(0);
  });

  it("stops a schedule that would never end", () => {
    const rows = projectSchedule(1_000_000_00, 900, 7_000_00, "2026-12-05", 5);
    expect(rows).toHaveLength(1);
  });
});

describe("due dates", () => {
  it("finds the first due date after a day", () => {
    expect(firstDueAfter("2026-11-04", 5)).toBe("2026-11-05");
    expect(firstDueAfter("2026-11-05", 5)).toBe("2026-12-05");
    expect(firstDueAfter("2026-12-20", 5)).toBe("2027-01-05");
  });

  it("a day the month lacks becomes its last, and the due day comes back after", () => {
    expect(firstDueAfter("2026-02-01", 31)).toBe("2026-02-28");
    expect(dueDatesUpTo("2026-01-31", 31, "2026-05-01")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("lists nothing before the first due date", () => {
    expect(dueDatesUpTo("2026-12-05", 5, "2026-11-30")).toEqual([]);
  });
});

describe("prepayment and rate changes", () => {
  const emi = levelEmi(2_000_000_00, 1000, 24);

  it("shortening keeps the EMI, and the loan ends sooner", () => {
    expect(emiAfterPrepayment("shorten", 2_000_000_00, 500_000_00, 1000, emi)).toBe(emi);
    expect(monthsToClear(1_500_000_00, 1000, emi)!).toBeLessThan(24);
  });

  it("lowering recalculates the EMI over the months that were left", () => {
    const lower = emiAfterPrepayment("lower", 2_000_000_00, 500_000_00, 1000, emi);
    expect(lower).toBeLessThan(emi);
    expect(monthsToClear(1_500_000_00, 1000, lower)).toBe(24);
  });

  it("a rate rise can keep the EMI (longer loan) or keep the end date (higher EMI)", () => {
    expect(emiAfterRateChange("emi", 2_000_000_00, 1000, 1200, emi)).toBe(emi);
    expect(monthsToClear(2_000_000_00, 1200, emi)!).toBeGreaterThan(24);
    const keep = emiAfterRateChange("tenure", 2_000_000_00, 1000, 1200, emi);
    expect(keep).toBeGreaterThan(emi);
    expect(monthsToClear(2_000_000_00, 1200, keep)).toBe(24);
  });

  it("a rate in percent becomes whole basis points", () => {
    expect(bpFromPct(16.5)).toBe(1650);
    expect(bpFromPct(8.55)).toBe(855);
  });
});
