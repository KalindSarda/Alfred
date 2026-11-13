/**
 * Financial health basics for a stretch of time (the person's month): how much came in, what had to be spent, what was
 * chosen, and what is left. Pure rules. The reference lines are common rules of thumb, shown as such; they are not advice.
 */

export interface PeriodFacts {
  incomePaise: number;
  /** Spending that had to happen: essential categories, card EMIs and loan interest. */
  needsPaise: number;
  /** Every other expense. */
  wantsPaise: number;
  /** Put into investments in the period. */
  investedPaise: number;
  /** Repaid against loan principal in the period. */
  principalRepaidPaise: number;
  /** Card EMI instalments and loan instalments (interest and principal) in the period. */
  emiPaise: number;
  /** Refunds and money other people paid back: left out of income, and already taken off `needsPaise` and `wantsPaise`. */
  reimbursedPaise: number;
}

export type SavingsBand = "strong" | "fair" | "low";
export type EmiBand = "comfortable" | "stretched" | "heavy";

/** Rules of thumb: save about a fifth of income; keep EMIs to about two fifths at most (under three tenths is comfortable). */
export const REFERENCE = { savingsStrongPct: 20, savingsFairPct: 10, emiComfortablePct: 30, emiCeilingPct: 40, utilisationPct: 30, needsPct: 50, wantsPct: 30, savingsPct: 20 } as const;

export interface Health {
  incomePaise: number;
  needsPaise: number;
  wantsPaise: number;
  spentPaise: number;
  /** Income less everything spent; negative when more went out than came in. It includes what was invested and the loan principal repaid. */
  savingsPaise: number;
  investedPaise: number;
  principalRepaidPaise: number;
  emiPaise: number;
  /** Refunds and money other people paid back, which are taken off spending rather than counted as income. */
  reimbursedPaise: number;
  /** Percentages of income to one decimal place; null with no income. */
  savingsRatePct: number | null;
  needsPct: number | null;
  wantsPct: number | null;
  emiBurdenPct: number | null;
  savingsBand: SavingsBand | null;
  emiBand: EmiBand | null;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export function healthOf(f: PeriodFacts): Health {
  const spentPaise = f.needsPaise + f.wantsPaise;
  const savingsPaise = f.incomePaise - spentPaise;
  const savingsRatePct = pct(savingsPaise, f.incomePaise);
  const emiBurdenPct = pct(f.emiPaise, f.incomePaise);
  return {
    incomePaise: f.incomePaise,
    needsPaise: f.needsPaise,
    wantsPaise: f.wantsPaise,
    spentPaise,
    savingsPaise,
    investedPaise: f.investedPaise,
    principalRepaidPaise: f.principalRepaidPaise,
    emiPaise: f.emiPaise,
    reimbursedPaise: f.reimbursedPaise,
    savingsRatePct,
    needsPct: pct(f.needsPaise, f.incomePaise),
    wantsPct: pct(f.wantsPaise, f.incomePaise),
    emiBurdenPct,
    savingsBand: savingsRatePct === null ? null : savingsRatePct >= REFERENCE.savingsStrongPct ? "strong" : savingsRatePct >= REFERENCE.savingsFairPct ? "fair" : "low",
    emiBand: emiBurdenPct === null ? null : emiBurdenPct <= REFERENCE.emiComfortablePct ? "comfortable" : emiBurdenPct <= REFERENCE.emiCeilingPct ? "stretched" : "heavy",
  };
}
