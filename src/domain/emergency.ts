/**
 * The emergency fund: money kept for when income stops or something big goes wrong. Pure rules. It has two layers in one
 * pool: living costs first (a number of months of what you spend, measured either on essentials only or on everything you
 * spend now, unless a target was typed), then a medical amount on top. What counts as the fund is what the person flagged:
 * bank accounts and holdings. "Six months" is a common rule of thumb, not advice.
 */

export const DEFAULT_MONTHS = 6;
export const DEFAULT_HORIZON_MONTHS = 12;

export type EmergencyBasis = "essentials" | "lifestyle";

export interface EmergencyFacts {
  /** The months of spending the living layer should cover. */
  months: number;
  /** Measure that spending on essentials only, or on everything spent now. */
  basis: EmergencyBasis;
  /** A typed target for the living layer, which replaces months times the burn. */
  manualTargetPaise: number | null;
  /** A typed amount kept on top for medical costs. */
  medicalTargetPaise: number | null;
  /** The months over which a gap is to be closed. */
  horizonMonths: number;
  /** What must be spent in a month (rent, bills, groceries, instalments), and what is spent in all; null when there is too little history. */
  essentialsBurnPaise: number | null;
  lifestyleBurnPaise: number | null;
  /** The flagged bank balances (less what is blocked) and the flagged holdings' worth. */
  bankPaise: number;
  holdingsPaise: number;
  /** How many accounts and holdings are flagged. */
  flagged: number;
  /** The bank money counted as available, flagged or not, for what to say when nothing is flagged. */
  liquidPaise: number;
}

export interface Layer {
  targetPaise: number;
  /** The part of the fund that sits in this layer: the living layer fills first. */
  fundedPaise: number;
  gapPaise: number;
  /** What to put aside each month to close this layer's gap within the horizon. */
  topUpPaise: number;
}

export interface EmergencyFund {
  months: number;
  basis: EmergencyBasis;
  horizonMonths: number;
  /** The burn of the chosen basis, and both of them so the choice can be shown. */
  burnPaise: number | null;
  essentialsBurnPaise: number | null;
  lifestyleBurnPaise: number | null;
  /** The living layer if measured each way (null without history), so both can be seen. */
  essentialsTargetPaise: number | null;
  lifestyleTargetPaise: number | null;
  /** The whole target: living layer plus medical. Null when there is no typed target and not enough history. */
  targetPaise: number | null;
  /** How the living layer was sized: from the burn, or typed. */
  targetBasis: "burn" | "manual" | null;
  fundedPaise: number;
  bankPaise: number;
  holdingsPaise: number;
  /** Nothing is flagged yet. */
  nothingFlagged: boolean;
  living: Layer | null;
  /** Present when a medical amount is set and the living layer can be sized. */
  medical: Layer | null;
  /** The total still missing, and what to put aside each month to close it within the horizon. */
  gapPaise: number | null;
  topUpPaise: number | null;
  /** How many months of the chosen basis the fund covers, to one decimal, rounded down. */
  fundedMonths: number | null;
  /** Funded against the whole target, capped at 100, to one decimal. */
  progressPct: number | null;
  liquidPaise: number;
  liquidMonths: number | null;
}

const monthsOf = (paise: number, burnPaise: number | null): number | null => (burnPaise === null ? null : paise <= 0 ? 0 : Math.floor((paise / burnPaise) * 10) / 10);

function layer(targetPaise: number, fundedPaise: number, horizonMonths: number): Layer {
  const gapPaise = Math.max(0, targetPaise - fundedPaise);
  return { targetPaise, fundedPaise, gapPaise, topUpPaise: Math.ceil(gapPaise / Math.max(1, horizonMonths)) };
}

export function emergencyFund(f: EmergencyFacts): EmergencyFund {
  const manual = f.manualTargetPaise !== null && f.manualTargetPaise > 0 ? f.manualTargetPaise : null;
  const medicalPaise = f.medicalTargetPaise !== null && f.medicalTargetPaise > 0 ? f.medicalTargetPaise : 0;
  const burnPaise = f.basis === "lifestyle" ? f.lifestyleBurnPaise : f.essentialsBurnPaise;
  const livingTargetPaise = manual ?? (burnPaise === null ? null : f.months * burnPaise);
  const fundedPaise = f.bankPaise + f.holdingsPaise;
  const funded = Math.max(0, fundedPaise);

  const living = livingTargetPaise === null ? null : layer(livingTargetPaise, Math.min(funded, livingTargetPaise), f.horizonMonths);
  const medical = livingTargetPaise === null || medicalPaise === 0 ? null : layer(medicalPaise, Math.min(Math.max(0, funded - livingTargetPaise), medicalPaise), f.horizonMonths);
  const targetPaise = livingTargetPaise === null ? null : livingTargetPaise + medicalPaise;
  const gapPaise = targetPaise === null ? null : Math.max(0, targetPaise - fundedPaise);
  return {
    months: f.months,
    basis: f.basis,
    horizonMonths: f.horizonMonths,
    burnPaise,
    essentialsBurnPaise: f.essentialsBurnPaise,
    lifestyleBurnPaise: f.lifestyleBurnPaise,
    essentialsTargetPaise: manual ?? (f.essentialsBurnPaise === null ? null : f.months * f.essentialsBurnPaise),
    lifestyleTargetPaise: manual ?? (f.lifestyleBurnPaise === null ? null : f.months * f.lifestyleBurnPaise),
    targetPaise,
    targetBasis: manual !== null ? "manual" : livingTargetPaise !== null ? "burn" : null,
    fundedPaise,
    bankPaise: f.bankPaise,
    holdingsPaise: f.holdingsPaise,
    nothingFlagged: f.flagged === 0,
    living,
    medical,
    gapPaise,
    topUpPaise: gapPaise === null ? null : Math.ceil(gapPaise / Math.max(1, f.horizonMonths)),
    fundedMonths: monthsOf(fundedPaise, burnPaise),
    progressPct: targetPaise === null || targetPaise <= 0 ? null : Math.min(100, Math.round((funded / targetPaise) * 1000) / 10),
    liquidPaise: f.liquidPaise,
    liquidMonths: monthsOf(f.liquidPaise, burnPaise),
  };
}
