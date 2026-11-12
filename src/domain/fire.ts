/**
 * Financial independence (FIRE): the corpus at which the yearly withdrawal rate covers what you spend. Pure rules and a
 * month-by-month projection in integer paise. Yearly rates are in basis points and applied monthly as a simple twelfth
 * (so 10% a year is 0.8333% a month). It is arithmetic on assumptions the person can see and change: returns are not
 * guaranteed, and tax, healthcare costs and the order in which returns arrive are not modelled.
 */

/** The projection gives up after this many months (60 years). */
export const MAX_MONTHS = 720;
const PPM = 1_000_000;

export interface ProjectionInput {
  corpusPaise: number;
  /** Put in each month at first, in today's money terms as typed; it rises by `stepupBp` every 12 months. */
  monthlySavingPaise: number;
  stepupBp: number;
  returnBp: number;
  inflationBp: number;
  /** What a month costs once work stops, in today's money. */
  monthlySpendPaise: number;
  withdrawalRateBp: number;
}

/** The corpus that supports a monthly spend at a withdrawal rate: 3.5% a year means 28.6 times a year's spending. */
export function fireNumber(monthlySpendPaise: number, withdrawalRateBp: number): number {
  return Math.round((monthlySpendPaise * 12 * 10_000) / withdrawalRateBp);
}

export function progressPct(corpusPaise: number, targetPaise: number): number | null {
  return targetPaise <= 0 ? null : Math.min(100, Math.round((Math.max(0, corpusPaise) / targetPaise) * 1000) / 10);
}

const monthlyPpm = (yearlyBp: number): number => Math.round((yearlyBp * 100) / 12);

/**
 * The number of months until the corpus first reaches the target, where the target itself grows with inflation (what you
 * will spend then costs more). 0 when it is already reached; null when it is not within 60 years.
 */
export function monthsToFire(p: ProjectionInput): number | null {
  const r = monthlyPpm(p.returnBp);
  const i = monthlyPpm(p.inflationBp);
  let corpus = p.corpusPaise;
  let target = fireNumber(p.monthlySpendPaise, p.withdrawalRateBp);
  let saving = p.monthlySavingPaise;
  if (target <= 0) return null;
  for (let m = 0; m <= MAX_MONTHS; m += 1) {
    if (corpus >= target) return m;
    corpus = Math.round((corpus * (PPM + r)) / PPM) + saving;
    target = Math.round((target * (PPM + i)) / PPM);
    if ((m + 1) % 12 === 0) saving = Math.round((saving * (10_000 + p.stepupBp)) / 10_000);
  }
  return null;
}

/**
 * The "coast" number: what the corpus would need to be today to reach the target by the target age with no more saving at
 * all. `months` is how far away that age is; null when there is no target age or it has passed.
 */
export function coastNumber(p: ProjectionInput, months: number | null): number | null {
  if (months === null || months <= 0) return null;
  const r = monthlyPpm(p.returnBp);
  const i = monthlyPpm(p.inflationBp);
  let target = fireNumber(p.monthlySpendPaise, p.withdrawalRateBp);
  for (let m = 0; m < months; m += 1) target = Math.round((target * (PPM + i)) / PPM);
  let coast = target;
  for (let m = 0; m < months; m += 1) coast = Math.round((coast * PPM) / (PPM + r));
  return coast;
}

/** The smallest monthly saving (with the same yearly step-up) that gets there within `months`; 0 when the corpus already will. */
export function requiredSaving(p: ProjectionInput, months: number | null): number | null {
  if (months === null || months <= 0) return null;
  const reaches = (saving: number) => {
    const m = monthsToFire({ ...p, monthlySavingPaise: saving });
    return m !== null && m <= months;
  };
  if (reaches(0)) return 0;
  let high = Math.max(1_000_00, fireNumber(p.monthlySpendPaise, p.withdrawalRateBp));
  if (!reaches(high)) return null;
  let low = 0;
  while (high - low > 100) {
    const mid = Math.floor((low + high) / 2);
    if (reaches(mid)) high = mid;
    else low = mid;
  }
  return high;
}

export interface Sensitivity {
  key: "saving" | "spend" | "return";
  /** Months to FIRE under the change, and how many months sooner (negative) or later it makes it; null where it is never reached. */
  months: number | null;
  deltaMonths: number | null;
}

/** What small changes do to the date: saving ₹5,000 more a month, spending 10% less, and a return 2 points lower. */
export function sensitivity(p: ProjectionInput, base: number | null): Sensitivity[] {
  const variants: [Sensitivity["key"], ProjectionInput][] = [
    ["saving", { ...p, monthlySavingPaise: p.monthlySavingPaise + 5_000_00 }],
    ["spend", { ...p, monthlySpendPaise: Math.round((p.monthlySpendPaise * 9) / 10) }],
    ["return", { ...p, returnBp: Math.max(0, p.returnBp - 200) }],
  ];
  return variants.map(([key, input]) => {
    const months = monthsToFire(input);
    return { key, months, deltaMonths: months === null || base === null ? null : months - base };
  });
}
