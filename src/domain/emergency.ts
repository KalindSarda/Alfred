/**
 * The emergency fund: money kept for when income stops or something big goes wrong. Pure rules. The target is a number of
 * months of essential spending (the same burn the runway uses) unless the person typed a target of their own. What counts
 * as the fund is what they flagged: bank accounts and holdings. "Six months" is a common rule of thumb, not advice.
 */

export const DEFAULT_MONTHS = 6;
export const DEFAULT_HORIZON_MONTHS = 12;

export interface EmergencyFacts {
  /** The months of essential spending the fund should cover. */
  months: number;
  /** A typed target, which replaces months times the burn. */
  manualTargetPaise: number | null;
  /** The months over which a gap is to be closed. */
  horizonMonths: number;
  /** What must be spent in a month; null when there is too little history. */
  burnPaise: number | null;
  /** The flagged bank balances (less what is blocked) and the flagged holdings' worth. */
  bankPaise: number;
  holdingsPaise: number;
  /** How many accounts and holdings are flagged. */
  flagged: number;
  /** The bank money counted as available, flagged or not, for what to say when nothing is flagged. */
  liquidPaise: number;
}

export interface EmergencyFund {
  months: number;
  horizonMonths: number;
  burnPaise: number | null;
  /** Null when there is no typed target and not enough history for a burn. */
  targetPaise: number | null;
  basis: "burn" | "manual" | null;
  fundedPaise: number;
  bankPaise: number;
  holdingsPaise: number;
  /** Nothing is flagged yet. */
  nothingFlagged: boolean;
  /** How much is still missing, and what to put aside each month to close it within the horizon. */
  gapPaise: number | null;
  topUpPaise: number | null;
  /** How many months of essential spending the fund covers, to one decimal, rounded down. */
  fundedMonths: number | null;
  /** Funded against the target, capped at 100, to one decimal. */
  progressPct: number | null;
  liquidPaise: number;
  liquidMonths: number | null;
}

const monthsOf = (paise: number, burnPaise: number | null): number | null => (burnPaise === null ? null : paise <= 0 ? 0 : Math.floor((paise / burnPaise) * 10) / 10);

export function emergencyFund(f: EmergencyFacts): EmergencyFund {
  const manual = f.manualTargetPaise !== null && f.manualTargetPaise > 0 ? f.manualTargetPaise : null;
  const targetPaise = manual ?? (f.burnPaise === null ? null : f.months * f.burnPaise);
  const fundedPaise = f.bankPaise + f.holdingsPaise;
  const gapPaise = targetPaise === null ? null : Math.max(0, targetPaise - fundedPaise);
  return {
    months: f.months,
    horizonMonths: f.horizonMonths,
    burnPaise: f.burnPaise,
    targetPaise,
    basis: manual !== null ? "manual" : targetPaise !== null ? "burn" : null,
    fundedPaise,
    bankPaise: f.bankPaise,
    holdingsPaise: f.holdingsPaise,
    nothingFlagged: f.flagged === 0,
    gapPaise,
    topUpPaise: gapPaise === null ? null : Math.ceil(gapPaise / Math.max(1, f.horizonMonths)),
    fundedMonths: monthsOf(fundedPaise, f.burnPaise),
    progressPct: targetPaise === null || targetPaise <= 0 ? null : Math.min(100, Math.round((Math.max(0, fundedPaise) / targetPaise) * 1000) / 10),
    liquidPaise: f.liquidPaise,
    liquidMonths: monthsOf(f.liquidPaise, f.burnPaise),
  };
}
