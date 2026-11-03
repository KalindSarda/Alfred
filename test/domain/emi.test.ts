import { describe, expect, it } from "vitest";
import { defaultInstalmentPaise, dueInstalments, emiToCome, instalmentSchedule, isValidStartMonth, nextInstalment, scheduleIsConsistent, startMonthLabel } from "../../src/domain/emi";

const card = { statementDay: 23, dueDay: 12 };
const phone = { totalPaise: 1_22_000_00, months: 6, instalmentPaise: 20_333_33, startMonth: "2026-11" };

describe("instalmentSchedule", () => {
  it("bills one instalment on each statement date, starting in the start month", () => {
    const s = instalmentSchedule(phone, card);
    expect(s.map((i) => i.date)).toEqual(["2026-11-23", "2026-12-23", "2027-01-23", "2027-02-23", "2027-03-23", "2027-04-23"]);
    expect(s.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("makes the last instalment carry the remainder so the total is exact", () => {
    const s = instalmentSchedule(phone, card);
    expect(s.slice(0, 5).every((i) => i.amountPaise === 20_333_33)).toBe(true);
    expect(s[5]!.amountPaise).toBe(1_22_000_00 - 5 * 20_333_33);
    expect(s.reduce((sum, i) => sum + i.amountPaise, 0)).toBe(phone.totalPaise);
  });

  it("clamps a statement day that a short month does not have", () => {
    const s = instalmentSchedule({ totalPaise: 3_000_00, months: 3, instalmentPaise: 1_000_00, startMonth: "2027-01" }, { statementDay: 31, dueDay: 15 });
    expect(s.map((i) => i.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("crosses the year end and a leap day", () => {
    const s = instalmentSchedule({ totalPaise: 4_000_00, months: 4, instalmentPaise: 1_000_00, startMonth: "2027-12" }, { statementDay: 29, dueDay: 10 });
    expect(s.map((i) => i.date)).toEqual(["2027-12-29", "2028-01-29", "2028-02-29", "2028-03-29"]);
  });

  it("handles a one-month plan", () => {
    expect(instalmentSchedule({ totalPaise: 500_00, months: 1, instalmentPaise: 500_00, startMonth: "2026-11" }, card)).toEqual([{ n: 1, date: "2026-11-23", amountPaise: 500_00 }]);
  });
});

describe("what is billed and what is still to come", () => {
  it("nothing is billed before the first statement, so the whole amount is still to come", () => {
    expect(dueInstalments(phone, card, "2026-11-22")).toHaveLength(0);
    expect(emiToCome(phone, card, "2026-11-22")).toBe(phone.totalPaise);
  });

  it("an instalment counts as billed on its statement date itself", () => {
    expect(dueInstalments(phone, card, "2026-11-23").map((i) => i.n)).toEqual([1]);
    expect(emiToCome(phone, card, "2026-11-23")).toBe(phone.totalPaise - 20_333_33);
  });

  it("billed plus to-come always equals the total", () => {
    for (const today of ["2026-10-01", "2026-11-23", "2027-01-30", "2027-03-23", "2027-04-23", "2030-01-01"]) {
      const billed = dueInstalments(phone, card, today).reduce((s, i) => s + i.amountPaise, 0);
      expect(billed + emiToCome(phone, card, today), today).toBe(phone.totalPaise);
    }
  });

  it("owes nothing more once every instalment is billed", () => {
    expect(emiToCome(phone, card, "2027-04-23")).toBe(0);
    expect(nextInstalment(phone, card, "2027-04-23")).toBeNull();
  });

  it("finds the next instalment still to come", () => {
    expect(nextInstalment(phone, card, "2026-12-01")).toEqual({ n: 2, date: "2026-12-23", amountPaise: 20_333_33 });
  });

  it("a cancelled plan owes nothing further and has no next instalment", () => {
    expect(emiToCome({ ...phone, cancelled: true }, card, "2026-12-01")).toBe(0);
    expect(nextInstalment({ ...phone, cancelled: true }, card, "2026-12-01")).toBeNull();
  });
});

describe("helpers", () => {
  it("the default instalment is the whole-paise share, the remainder going to the last", () => {
    expect(defaultInstalmentPaise(1_22_000_00, 6)).toBe(20_333_33);
    expect(scheduleIsConsistent({ totalPaise: 1_22_000_00, months: 6, instalmentPaise: defaultInstalmentPaise(1_22_000_00, 6) })).toBe(true);
  });

  it("rejects an instalment so large that the last one would be empty or negative", () => {
    expect(scheduleIsConsistent({ totalPaise: 100, months: 3, instalmentPaise: 50 })).toBe(false);
    expect(scheduleIsConsistent({ totalPaise: 100, months: 3, instalmentPaise: 49 })).toBe(true);
    expect(scheduleIsConsistent({ totalPaise: 100, months: 1, instalmentPaise: 100 })).toBe(true);
  });

  it("validates and labels the start month", () => {
    expect(isValidStartMonth("2026-11")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "26-11", "2026-1", "", "2026-11-01"]) expect(isValidStartMonth(bad), bad).toBe(false);
    expect(startMonthLabel("2026-11")).toBe("Nov 2026");
  });
});
