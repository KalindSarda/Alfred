/**
 * How fast money can be put aside: the free surplus of recent months, and how long closing a gap takes at that pace. Pure
 * rules. Free surplus is what is left after everything spent and after what already goes into investments and loan
 * principal, since those are spoken for. A typical month is the average of the last few complete ones; a cautious month is the
 * weakest of them (or 80% of typical while there are fewer than three), because income can be lumpy.
 */

export interface CycleFacts {
  incomePaise: number;
  /** Everything spent: needs and wants. */
  spentPaise: number;
  investedPaise: number;
  principalRepaidPaise: number;
}

export interface Pace {
  /** What is left in a typical month, and in a lean one. Either can be zero or negative. */
  typicalPaise: number;
  cautiousPaise: number;
  /** What a typical month spends, and puts into investments and loan principal, to show what runs alongside. */
  spentPaise: number;
  investingPaise: number;
  /** How many complete months it rests on; 0 when it rests on the recent window scaled to a month. */
  cycles: number;
  /** Fewer than three complete months, so an estimate. */
  early: boolean;
}

/** A month's free surplus. */
export const surplusOf = (c: CycleFacts): number => c.incomePaise - c.spentPaise - c.investedPaise - c.principalRepaidPaise;

/** The most complete months that count towards a typical month. */
export const MAX_CYCLES = 3;

/** A cautious month while there are fewer than three to take the weakest of. */
const CAUTION_PERCENT = 80;

const mean = (xs: readonly number[]): number => Math.round(xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length));

/** From complete months (newest first), up to three. Null when there are none. */
export function paceFromCycles(cycles: readonly CycleFacts[]): Pace | null {
  const used = cycles.slice(0, MAX_CYCLES);
  if (used.length === 0) return null;
  const surpluses = used.map(surplusOf);
  const typicalPaise = mean(surpluses);
  const cautiousPaise = used.length >= MAX_CYCLES ? Math.min(...surpluses) : cautious(typicalPaise);
  return { typicalPaise, cautiousPaise, spentPaise: mean(used.map((c) => c.spentPaise)), investingPaise: mean(used.map((c) => c.investedPaise + c.principalRepaidPaise)), cycles: used.length, early: used.length < MAX_CYCLES };
}

/** From the recent window when no month is complete yet: scaled to thirty days, always an estimate. */
export function paceFromWindow(facts: CycleFacts, days: number): Pace | null {
  if (days <= 0) return null;
  const scale = (paise: number) => Math.round((paise * 30) / days);
  const typicalPaise = scale(surplusOf(facts));
  return { typicalPaise, cautiousPaise: cautious(typicalPaise), spentPaise: scale(facts.spentPaise), investingPaise: scale(facts.investedPaise + facts.principalRepaidPaise), cycles: 0, early: true };
}

/** A lean month: 80% of typical when there is something left; otherwise as bad as typical. */
function cautious(typicalPaise: number): number {
  return typicalPaise > 0 ? Math.round((typicalPaise * CAUTION_PERCENT) / 100) : typicalPaise;
}

/** Whole months to put `gapPaise` aside at `monthlyPaise`; null when nothing is being left over, and 0 when nothing is missing. */
export function monthsToClose(gapPaise: number, monthlyPaise: number): number | null {
  if (gapPaise <= 0) return 0;
  return monthlyPaise > 0 ? Math.ceil(gapPaise / monthlyPaise) : null;
}
