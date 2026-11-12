/**
 * The transfer suggestion: how much could safely move from spending money into the emergency fund today. Pure rules.
 * Free-to-spend already takes off what is committed before the next salary; a cushion for everyday spending over the
 * days left is kept back as well. Alfred only suggests: the person moves the money at the bank, then records it.
 */

/** Suggestions are rounded down to this, so they read like something a person would transfer. */
export const ROUND_PAISE = 10_000;

export type NoSuggestion = "no_target" | "fund_complete" | "no_destination" | "no_source" | "no_history" | "nothing_movable";

export interface TransferFacts {
  /** What is still missing from the emergency fund, and null when it cannot be sized. */
  gapPaise: number | null;
  /** Safe-to-spend less what is committed before `until`. */
  freeToSpendPaise: number;
  /** Everyday spending a day (not rent, EMIs or anything else already counted as committed); null when there is too little history. */
  dailySpendPaise: number | null;
  /** Days until the next salary or month start. */
  daysLeft: number;
  /** What the source bank can give: its balance less what is blocked; null when there is no counted bank. */
  sourceAvailablePaise: number | null;
  hasDestination: boolean;
}

export interface TransferSuggestion {
  /** Null when there is something to suggest. */
  none: NoSuggestion | null;
  amountPaise: number;
  /** What could move at all, before capping at the gap. */
  movablePaise: number;
  cushionPaise: number;
  /** The gap that would remain after this transfer, null when unknown. */
  remainingPaise: number | null;
}

const roundDown = (paise: number): number => Math.floor(paise / ROUND_PAISE) * ROUND_PAISE;

export function suggestTransfer(f: TransferFacts): TransferSuggestion {
  const base = { amountPaise: 0, movablePaise: 0, cushionPaise: 0, remainingPaise: f.gapPaise };
  if (f.gapPaise === null) return { ...base, none: "no_target" };
  if (f.gapPaise <= 0) return { ...base, none: "fund_complete" };
  if (!f.hasDestination) return { ...base, none: "no_destination" };
  if (f.sourceAvailablePaise === null) return { ...base, none: "no_source" };
  if (f.dailySpendPaise === null) return { ...base, none: "no_history" };

  const cushionPaise = Math.max(0, f.daysLeft) * f.dailySpendPaise;
  const movablePaise = Math.max(0, Math.min(f.freeToSpendPaise - cushionPaise, f.sourceAvailablePaise));
  const amountPaise = roundDown(Math.min(movablePaise, f.gapPaise));
  if (amountPaise <= 0) return { none: "nothing_movable", amountPaise: 0, movablePaise, cushionPaise, remainingPaise: f.gapPaise };
  return { none: null, amountPaise, movablePaise, cushionPaise, remainingPaise: f.gapPaise - amountPaise };
}
