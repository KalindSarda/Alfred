/**
 * Working out an EMI schedule from the amount converted, the yearly rate and the months. Pure money maths, whole paise.
 *
 * Banks charge a level instalment on a reducing balance: P·r / (1 − (1+r)^−n), with r the monthly rate. HDFC's own
 * statement matches it: ₹1,17,455.45 at 16% for 6 months is ₹20,499.7 a month. A bank's first instalment can differ
 * (it counts its own days) and its last absorbs rounding, so these figures are a starting point people can edit.
 */

export interface CalcInput {
  principalPaise: number;
  /** Yearly rate in percent, such as 16. Zero gives an even split. */
  annualRatePct: number;
  months: number;
  /** GST in percent, such as 18; charged on the interest only when `gstOnInterest` is set. */
  gstPct?: number;
  gstOnInterest?: boolean;
}

export interface CalcRow {
  /** 1 to months. */
  n: number;
  principalPaise: number;
  interestPaise: number;
  gstPaise: number;
  /** What the month asks for: principal + interest + GST on the interest. */
  instalmentPaise: number;
}

export function calcSchedule(input: CalcInput): CalcRow[] {
  const { principalPaise, annualRatePct, months } = input;
  if (!Number.isInteger(months) || months < 1 || !Number.isSafeInteger(principalPaise) || principalPaise <= 0 || annualRatePct < 0) return [];
  const r = annualRatePct / 1200;
  const gstRate = input.gstOnInterest ? (input.gstPct ?? 0) / 100 : 0;
  const level = r === 0 ? Math.floor(principalPaise / months) : Math.round((principalPaise * r) / (1 - (1 + r) ** -months));

  const rows: CalcRow[] = [];
  let balance = principalPaise;
  for (let n = 1; n <= months; n++) {
    const interestPaise = Math.round(balance * r);
    // The last month clears whatever is left, so rounding never leaves a balance behind.
    const principalPart = n === months ? balance : Math.min(balance, Math.max(0, r === 0 ? level : level - interestPaise));
    const gstPaise = Math.round(interestPaise * gstRate);
    rows.push({ n, principalPaise: principalPart, interestPaise, gstPaise, instalmentPaise: principalPart + interestPaise + gstPaise });
    balance -= principalPart;
  }
  return rows;
}

export interface CalcTotals {
  payablePaise: number;
  interestPaise: number;
  gstPaise: number;
}

export function scheduleTotals(rows: readonly CalcRow[]): CalcTotals {
  return {
    payablePaise: rows.reduce((s, r) => s + r.instalmentPaise, 0),
    interestPaise: rows.reduce((s, r) => s + r.interestPaise, 0),
    gstPaise: rows.reduce((s, r) => s + r.gstPaise, 0),
  };
}

/** A one-off fee with GST on top, in whole paise: ₹299 at 18% is ₹352.82. */
export const feeWithGst = (feePaise: number, gstPct: number): number => feePaise + Math.round((feePaise * gstPct) / 100);
