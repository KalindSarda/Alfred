import { parsePaise } from "./money";

/**
 * Reading what is typed into the emergency fund and independence settings. Pure rules, so the checks are the same everywhere
 * and are tested. An empty box always means "use the default" (or "none" for an amount), so nothing here is required; what is
 * typed has to make sense, and each problem is reported against its own box.
 */

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const bad = (error: string): Read<never> => ({ ok: false, error });

/** The most a typed amount may be, in paise (what the server accepts). */
export const MAX_PAISE = 100_000_000_000_00;

/** A whole number within a range; empty gives `fallback`. */
export function readWhole(text: string, range: { min: number; max: number }, fallback: number): Read<number> {
  const t = text.trim();
  if (t === "") return ok(fallback);
  if (!/^\d+$/.test(t)) return bad("Use a whole number, such as 6.");
  const n = Number(t);
  return n < range.min || n > range.max ? bad(`Use a number from ${range.min} to ${range.max}.`) : ok(n);
}

/** A whole number within a range, or null when left empty. */
export function readWholeOrNone(text: string, range: { min: number; max: number }): Read<number | null> {
  return text.trim() === "" ? ok(null) : readWhole(text, range, 0);
}

/**
 * An amount in rupees. Empty gives null; so does zero when `zeroIsNone` (a zero target or spend means nothing was set), while
 * with `zeroIsNone` off zero is a real amount. Commas are fine.
 */
export function readRupees(text: string, options: { zeroIsNone: boolean }): Read<number | null> {
  const t = text.trim();
  if (t === "") return ok(null);
  if (/^0+(\.0{1,2})?$/.test(t.replace(/,/g, ""))) return ok(options.zeroIsNone ? null : 0);
  const paise = parsePaise(t);
  if (paise === null) return bad("Use a number such as 600000, up to two decimals.");
  return paise > MAX_PAISE ? bad("That is too large.") : ok(paise);
}

/** A percentage with up to two decimals, in basis points; empty gives `fallbackBp`. */
export function readPercent(text: string, range: { minBp: number; maxBp: number }, fallbackBp: number): Read<number> {
  const t = text.trim();
  if (t === "") return ok(fallbackBp);
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return bad("Use a percentage such as 3.5.");
  const bp = Math.round(Number.parseFloat(t) * 100);
  return bp < range.minBp || bp > range.maxBp ? bad(`Use a percentage from ${range.minBp / 100} to ${range.maxBp / 100}.`) : ok(bp);
}

export interface FundInput {
  months: string;
  target: string;
  medical: string;
  horizon: string;
}

export interface FundValues {
  emergencyMonths: number;
  emergencyTargetPaise: number | null;
  medicalTargetPaise: number | null;
  emergencyHorizonMonths: number;
}

export type Errors<K extends string> = Partial<Record<K, string>>;

/** The emergency fund settings: months (6 when empty), an own living-costs target or none, a medical amount or none, and months to close the gap (12 when empty). */
export function readFundSettings(input: FundInput): { values: FundValues | null; errors: Errors<keyof FundInput> } {
  const months = readWhole(input.months, { min: 1, max: 24 }, 6);
  const target = readRupees(input.target, { zeroIsNone: true });
  const medical = readRupees(input.medical, { zeroIsNone: true });
  const horizon = readWhole(input.horizon, { min: 1, max: 60 }, 12);
  const errors: Errors<keyof FundInput> = {};
  if (!months.ok) errors.months = months.error;
  if (!target.ok) errors.target = target.error;
  if (!medical.ok) errors.medical = medical.error;
  if (!horizon.ok) errors.horizon = horizon.error;
  if (!months.ok || !target.ok || !medical.ok || !horizon.ok) return { values: null, errors };
  return { values: { emergencyMonths: months.value, emergencyTargetPaise: target.value, medicalTargetPaise: medical.value, emergencyHorizonMonths: horizon.value }, errors };
}

export interface FireInput {
  age: string;
  target: string;
  spend: string;
  saving: string;
  ret: string;
  inflation: string;
  withdrawal: string;
  stepup: string;
}

export interface FireValues {
  ageNow: number | null;
  targetAge: number | null;
  monthlySpendPaise: number | null;
  monthlySavingPaise: number | null;
  returnBp: number;
  inflationBp: number;
  withdrawalRateBp: number;
  stepupBp: number;
}

/** The independence assumptions. Empty ages are not set; an empty spend or saving means "use my recent average"; empty rates take their usual values. */
export function readFireAssumptions(input: FireInput): { values: FireValues | null; errors: Errors<keyof FireInput> } {
  const age = readWholeOrNone(input.age, { min: 18, max: 90 });
  const target = readWholeOrNone(input.target, { min: 19, max: 100 });
  const spend = readRupees(input.spend, { zeroIsNone: true });
  const saving = readRupees(input.saving, { zeroIsNone: false });
  const ret = readPercent(input.ret, { minBp: 0, maxBp: 3000 }, 1000);
  const inflation = readPercent(input.inflation, { minBp: 0, maxBp: 2000 }, 600);
  const withdrawal = readPercent(input.withdrawal, { minBp: 100, maxBp: 1000 }, 350);
  const stepup = readPercent(input.stepup, { minBp: 0, maxBp: 3000 }, 0);
  const errors: Errors<keyof FireInput> = {};
  if (!age.ok) errors.age = age.error;
  if (!target.ok) errors.target = target.error;
  if (!spend.ok) errors.spend = spend.error;
  if (!saving.ok) errors.saving = saving.error;
  if (!ret.ok) errors.ret = ret.error;
  if (!inflation.ok) errors.inflation = inflation.error;
  if (!withdrawal.ok) errors.withdrawal = withdrawal.error;
  if (!stepup.ok) errors.stepup = stepup.error;
  if (age.ok && target.ok && target.value !== null) {
    if (age.value === null) errors.age = "Give your age now to aim for an age.";
    else if (target.value <= age.value) errors.target = "Choose an age after your age now.";
  }
  if (Object.keys(errors).length > 0 || !age.ok || !target.ok || !spend.ok || !saving.ok || !ret.ok || !inflation.ok || !withdrawal.ok || !stepup.ok) return { values: null, errors };
  return {
    values: { ageNow: age.value, targetAge: target.value, monthlySpendPaise: spend.value, monthlySavingPaise: saving.value, returnBp: ret.value, inflationBp: inflation.value, withdrawalRateBp: withdrawal.value, stepupBp: stepup.value },
    errors,
  };
}
