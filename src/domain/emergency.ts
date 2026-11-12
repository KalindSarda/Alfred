/**
 * The emergency fund: money kept for when income stops or something big goes wrong. Pure rules. It is judged two ways at
 * once so the person sees where they stand without choosing: against the lifestyle they live now (months of everything they
 * spend) and against essentials only (rent, bills, groceries, instalments), each with a medical amount on top. The lifestyle
 * total is the goal; essentials is a milestone on the way. What counts as the fund is what the person flagged: bank accounts and
 * holdings. "Six months" is a common rule of thumb, not advice.
 */

import { monthsToClose, type Pace } from "./pace";

export const DEFAULT_MONTHS = 6;
export const DEFAULT_HORIZON_MONTHS = 12;

export interface EmergencyFacts {
  /** The months of spending each living layer should cover. */
  months: number;
  /** A typed target for the lifestyle living layer, which replaces months times the burn. */
  manualTargetPaise: number | null;
  /** A typed amount kept on top for medical costs, in both totals. */
  medicalTargetPaise: number | null;
  /** The months over which a gap is to be closed when no pace is known. */
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
  /** What is left over in a typical and a lean month, when it can be told. */
  pace: Pace | null;
}

export interface Layer {
  targetPaise: number;
  /** The part of the fund that sits in this layer: the living layer fills first. */
  fundedPaise: number;
  gapPaise: number;
  /** What to put aside each month to close this layer's gap within the horizon. */
  topUpPaise: number;
}

/** One way of judging the fund: a living layer and the medical amount on top. */
export interface Target {
  /** Null when the living layer cannot be sized yet (no history and no typed target). */
  livingPaise: number | null;
  medicalPaise: number;
  totalPaise: number | null;
  fundedPaise: number;
  gapPaise: number | null;
  /** Funded against the total, capped at 100, to one decimal. */
  pct: number | null;
  /** Months to close the gap at a typical and at a lean month's surplus; null when nothing is left over, 0 when nothing is missing. */
  monthsAtTypical: number | null;
  monthsAtCautious: number | null;
}

/** Where the fund stands between the two milestones. */
export type Verdict = "none" | "building" | "essentials" | "complete";

export interface EmergencyFund {
  months: number;
  horizonMonths: number;
  /** The burn each way, and what the fund covers today of each, in months to one decimal, rounded down. */
  essentialsBurnPaise: number | null;
  lifestyleBurnPaise: number | null;
  monthsOnEssentials: number | null;
  monthsOnLifestyle: number | null;
  targets: { lifestyle: Target; essentials: Target };
  verdict: Verdict;
  /** What is left over each month, as far as it can be told. */
  pace: Pace | null;
  /** The months to close the lifestyle gap if spending were 10% less; only when it would help or nothing is left over now. */
  monthsIfSpendingLess: number | null;

  /** The lifestyle goal, kept as the fields the ladder, the transfer suggestion and Telegram read. */
  burnPaise: number | null;
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
  gapPaise: number | null;
  topUpPaise: number | null;
  fundedMonths: number | null;
  progressPct: number | null;
  liquidPaise: number;
  liquidMonths: number | null;
}

const monthsOf = (paise: number, burnPaise: number | null): number | null => (burnPaise === null ? null : paise <= 0 ? 0 : Math.floor((paise / burnPaise) * 10) / 10);

function layer(targetPaise: number, fundedPaise: number, horizonMonths: number): Layer {
  const gapPaise = Math.max(0, targetPaise - fundedPaise);
  return { targetPaise, fundedPaise, gapPaise, topUpPaise: Math.ceil(gapPaise / Math.max(1, horizonMonths)) };
}

function target(livingPaise: number | null, medicalPaise: number, fundedPaise: number, pace: Pace | null): Target {
  const totalPaise = livingPaise === null ? null : livingPaise + medicalPaise;
  const gapPaise = totalPaise === null ? null : Math.max(0, totalPaise - fundedPaise);
  return {
    livingPaise,
    medicalPaise,
    totalPaise,
    fundedPaise,
    gapPaise,
    pct: totalPaise === null || totalPaise <= 0 ? null : Math.min(100, Math.round((Math.max(0, fundedPaise) / totalPaise) * 1000) / 10),
    monthsAtTypical: gapPaise === null || pace === null ? null : monthsToClose(gapPaise, pace.typicalPaise),
    monthsAtCautious: gapPaise === null || pace === null ? null : monthsToClose(gapPaise, pace.cautiousPaise),
  };
}

export function emergencyFund(f: EmergencyFacts): EmergencyFund {
  const manual = f.manualTargetPaise !== null && f.manualTargetPaise > 0 ? f.manualTargetPaise : null;
  const medicalPaise = f.medicalTargetPaise !== null && f.medicalTargetPaise > 0 ? f.medicalTargetPaise : 0;
  const fundedPaise = f.bankPaise + f.holdingsPaise;
  const funded = Math.max(0, fundedPaise);

  const lifestyleLiving = manual ?? (f.lifestyleBurnPaise === null ? null : f.months * f.lifestyleBurnPaise);
  const essentialsLiving = f.essentialsBurnPaise === null ? null : f.months * f.essentialsBurnPaise;
  const lifestyle = target(lifestyleLiving, medicalPaise, fundedPaise, f.pace);
  const essentials = target(essentialsLiving, medicalPaise, fundedPaise, f.pace);

  let verdict: Verdict = "none";
  if (lifestyle.totalPaise !== null && lifestyle.gapPaise === 0 && !(f.flagged === 0)) verdict = "complete";
  else if (essentials.totalPaise !== null && essentials.gapPaise === 0 && f.flagged > 0) verdict = "essentials";
  else if (f.flagged > 0 && (lifestyle.totalPaise !== null || essentials.totalPaise !== null)) verdict = "building";

  const living = lifestyleLiving === null ? null : layer(lifestyleLiving, Math.min(funded, lifestyleLiving), f.horizonMonths);
  const medical = lifestyleLiving === null || medicalPaise === 0 ? null : layer(medicalPaise, Math.min(Math.max(0, funded - lifestyleLiving), medicalPaise), f.horizonMonths);
  const gapPaise = lifestyle.gapPaise;
  const trimmed = f.pace && gapPaise !== null && gapPaise > 0 ? monthsToClose(gapPaise, f.pace.typicalPaise + Math.round(f.pace.spentPaise / 10)) : null;

  return {
    months: f.months,
    horizonMonths: f.horizonMonths,
    essentialsBurnPaise: f.essentialsBurnPaise,
    lifestyleBurnPaise: f.lifestyleBurnPaise,
    monthsOnEssentials: monthsOf(fundedPaise, f.essentialsBurnPaise),
    monthsOnLifestyle: monthsOf(fundedPaise, f.lifestyleBurnPaise),
    targets: { lifestyle, essentials },
    verdict,
    pace: f.pace,
    monthsIfSpendingLess: trimmed,
    burnPaise: f.lifestyleBurnPaise,
    targetPaise: lifestyle.totalPaise,
    targetBasis: manual !== null ? "manual" : lifestyleLiving !== null ? "burn" : null,
    fundedPaise,
    bankPaise: f.bankPaise,
    holdingsPaise: f.holdingsPaise,
    nothingFlagged: f.flagged === 0,
    living,
    medical,
    gapPaise,
    topUpPaise: gapPaise === null ? null : Math.ceil(gapPaise / Math.max(1, f.horizonMonths)),
    fundedMonths: monthsOf(fundedPaise, f.lifestyleBurnPaise),
    progressPct: lifestyle.pct,
    liquidPaise: f.liquidPaise,
    liquidMonths: monthsOf(f.liquidPaise, f.lifestyleBurnPaise),
  };
}
