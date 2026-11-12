import { describe, expect, it } from "vitest";
import { MAX_PAISE, readFireAssumptions, readFundSettings, readPercent, readRupees, readWhole } from "../../src/domain/planInput";

const fund = { months: "", target: "", medical: "", horizon: "" };
const fire = { age: "", target: "", spend: "", saving: "", ret: "", inflation: "", withdrawal: "", stepup: "" };

describe("readWhole", () => {
  it("takes the fallback when empty, and a whole number inside the range", () => {
    expect(readWhole("", { min: 1, max: 24 }, 6)).toEqual({ ok: true, value: 6 });
    expect(readWhole(" 9 ", { min: 1, max: 24 }, 6)).toEqual({ ok: true, value: 9 });
  });

  it("says what is wrong otherwise", () => {
    expect(readWhole("6.5", { min: 1, max: 24 }, 6)).toEqual({ ok: false, error: "Use a whole number, such as 6." });
    expect(readWhole("abc", { min: 1, max: 24 }, 6).ok).toBe(false);
    expect(readWhole("-3", { min: 1, max: 24 }, 6).ok).toBe(false);
    expect(readWhole("0", { min: 1, max: 24 }, 6)).toEqual({ ok: false, error: "Use a number from 1 to 24." });
    expect(readWhole("25", { min: 1, max: 24 }, 6)).toEqual({ ok: false, error: "Use a number from 1 to 24." });
  });
});

describe("readRupees", () => {
  it("is none when empty, and when zero means none", () => {
    expect(readRupees("", { zeroIsNone: true })).toEqual({ ok: true, value: null });
    expect(readRupees("0", { zeroIsNone: true })).toEqual({ ok: true, value: null });
    expect(readRupees("0.00", { zeroIsNone: true })).toEqual({ ok: true, value: null });
    expect(readRupees("0", { zeroIsNone: false })).toEqual({ ok: true, value: 0 });
  });

  it("reads amounts with commas and decimals", () => {
    expect(readRupees("4,00,000", { zeroIsNone: true })).toEqual({ ok: true, value: 4_00_000_00 });
    expect(readRupees("1,234.5", { zeroIsNone: true })).toEqual({ ok: true, value: 123_450 });
  });

  it("refuses junk and what is too large", () => {
    expect(readRupees("abc", { zeroIsNone: true }).ok).toBe(false);
    expect(readRupees("-5", { zeroIsNone: true }).ok).toBe(false);
    expect(readRupees("1.234", { zeroIsNone: true }).ok).toBe(false);
    expect(readRupees(String(MAX_PAISE / 100 + 1), { zeroIsNone: true })).toEqual({ ok: false, error: "That is too large." });
  });
});

describe("readPercent", () => {
  it("reads up to two decimals in basis points, and falls back when empty", () => {
    expect(readPercent("3.5", { minBp: 100, maxBp: 1000 }, 350)).toEqual({ ok: true, value: 350 });
    expect(readPercent("", { minBp: 100, maxBp: 1000 }, 350)).toEqual({ ok: true, value: 350 });
    expect(readPercent("12.25", { minBp: 0, maxBp: 3000 }, 1000)).toEqual({ ok: true, value: 1225 });
  });

  it("keeps it in range", () => {
    expect(readPercent("0.5", { minBp: 100, maxBp: 1000 }, 350)).toEqual({ ok: false, error: "Use a percentage from 1 to 10." });
    expect(readPercent("11", { minBp: 100, maxBp: 1000 }, 350).ok).toBe(false);
    expect(readPercent("abc", { minBp: 100, maxBp: 1000 }, 350).ok).toBe(false);
  });
});

describe("readFundSettings", () => {
  it("needs nothing: empty boxes mean six months, twelve to close the gap, and no typed amounts", () => {
    expect(readFundSettings(fund)).toEqual({ values: { emergencyMonths: 6, emergencyTargetPaise: null, medicalTargetPaise: null, emergencyHorizonMonths: 12 }, errors: {} });
  });

  it("reads what is typed, and treats a zero amount as none", () => {
    const r = readFundSettings({ months: "9", target: "6,00,000", medical: "0", horizon: "18" });
    expect(r.values).toEqual({ emergencyMonths: 9, emergencyTargetPaise: 6_00_000_00, medicalTargetPaise: null, emergencyHorizonMonths: 18 });
  });

  it("reports each problem against its own box, all at once", () => {
    const r = readFundSettings({ months: "30", target: "x", medical: "-1", horizon: "0" });
    expect(r.values).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(["horizon", "medical", "months", "target"]);
    expect(r.errors.months).toBe("Use a number from 1 to 24.");
    expect(r.errors.horizon).toBe("Use a number from 1 to 60.");
  });
});

describe("readFireAssumptions", () => {
  it("needs nothing: ages unset, spend and saving from the average, the usual rates", () => {
    expect(readFireAssumptions(fire).values).toEqual({ ageNow: null, targetAge: null, monthlySpendPaise: null, monthlySavingPaise: null, returnBp: 1000, inflationBp: 600, withdrawalRateBp: 350, stepupBp: 0 });
  });

  it("reads a full set, where a typed zero saving is real and a zero spend is none", () => {
    const r = readFireAssumptions({ age: "32", target: "45", spend: "60,000", saving: "0", ret: "11", inflation: "6.5", withdrawal: "4", stepup: "5" });
    expect(r.values).toEqual({ ageNow: 32, targetAge: 45, monthlySpendPaise: 60_000_00, monthlySavingPaise: 0, returnBp: 1100, inflationBp: 650, withdrawalRateBp: 400, stepupBp: 500 });
    expect(readFireAssumptions({ ...fire, spend: "0" }).values?.monthlySpendPaise).toBeNull();
  });

  it("checks the ages against each other and against their limits", () => {
    expect(readFireAssumptions({ ...fire, age: "10" }).errors.age).toBe("Use a number from 18 to 90.");
    expect(readFireAssumptions({ ...fire, age: "40", target: "40" }).errors.target).toBe("Choose an age after your age now.");
    expect(readFireAssumptions({ ...fire, target: "50" }).errors.age).toBe("Give your age now to aim for an age.");
    expect(readFireAssumptions({ ...fire, age: "3.5" }).errors.age).toBe("Use a whole number, such as 6.");
  });

  it("keeps every rate in range and reports them separately", () => {
    const r = readFireAssumptions({ ...fire, ret: "50", inflation: "-1", withdrawal: "0.5", stepup: "x" });
    expect(r.values).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(["inflation", "ret", "stepup", "withdrawal"]);
  });
});
