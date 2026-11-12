/**
 * The next-step ladder: a common order in which people firm up their money, with where the person stands on each rung and
 * why it matters. Pure rules over figures other parts of Alfred already work out. The order is a rule of thumb, not
 * advice: a step the person has chosen to skip is passed over. Nothing here names a product or says what to invest in.
 */

export type StepKey = "starter" | "debt" | "protection" | "emergency" | "medical" | "fire";
export const STEP_ORDER: readonly StepKey[] = ["starter", "debt", "protection", "emergency", "medical", "fire"];

export type StepStatus = "done" | "next" | "later" | "skipped";

export interface LadderFacts {
  /** What must be spent in a month on essentials; null when there is too little history. */
  essentialsBurnPaise: number | null;
  /** Bank money counted as available, less what is blocked. */
  liquidPaise: number;
  /** Active bank loans at or above the person's costly-debt rate, largest rate first. */
  costlyLoans: { name: string; ratePct: number; outstandingPaise: number }[];
  /** The costly-debt rate in use, in basis points, for wording. */
  costlyDebtBp: number;
  /** High-severity protection gaps, by title. */
  protectionGaps: string[];
  /** The emergency fund's layers; null when no target can be sized yet. */
  living: { gapPaise: number } | null;
  medical: { gapPaise: number } | null;
  /** Nothing is marked as the emergency fund. */
  nothingFlagged: boolean;
  /** Progress toward the independence number, when there is one. */
  firePct: number | null;
  skipped: readonly StepKey[];
}

export interface Step {
  key: StepKey;
  title: string;
  status: StepStatus;
  /** What is still missing in rupees, when a figure applies. */
  amountPaise: number | null;
  /** Why this step is where it is, in a sentence or two. */
  detail: string;
}

export interface Ladder {
  steps: Step[];
  /** The first step that is not done and not skipped; null when everything is. */
  next: Step | null;
}

const TITLE: Record<StepKey, string> = {
  starter: "A starter buffer",
  debt: "Costly debt",
  protection: "Health and life cover",
  emergency: "Emergency fund, living costs",
  medical: "Emergency fund, medical reserve",
  fire: "Investing for financial independence",
};

interface Check {
  done: boolean;
  amountPaise: number | null;
  /** What to say when this is the next step, and when it is later or done. */
  detail: string;
}

function check(key: StepKey, f: LadderFacts): Check {
  switch (key) {
    case "starter": {
      if (f.essentialsBurnPaise === null) return { done: false, amountPaise: null, detail: "Once there are about two weeks of entries I can size one month of essentials, and tell you how much to keep in the bank so a surprise never lands on a card." };
      const gap = Math.max(0, f.essentialsBurnPaise - f.liquidPaise);
      return { done: gap === 0, amountPaise: gap, detail: gap === 0 ? "A month of essentials is in the bank." : "One month of essentials in the bank stops a surprise from going on a card, and makes every step below safer." };
    }
    case "debt": {
      const total = f.costlyLoans.reduce((s, l) => s + l.outstandingPaise, 0);
      const worst = f.costlyLoans[0];
      return {
        done: f.costlyLoans.length === 0,
        amountPaise: f.costlyLoans.length === 0 ? 0 : total,
        detail: worst ? `${worst.name} costs ${worst.ratePct}% a year. The interest saved by paying a loan down is certain, unlike a return. The part-payment what-if shows what it would save.` : `No bank loan at ${f.costlyDebtBp / 100}% a year or more.`,
      };
    }
    case "protection":
      return {
        done: f.protectionGaps.length === 0,
        amountPaise: null,
        detail: f.protectionGaps.length === 0 ? "No gaps found against the usual rules of thumb." : `${f.protectionGaps.join("; ")}. One hospital bill or a lost income can undo years of saving, which is why this comes before building up cash.`,
      };
    case "emergency": {
      if (f.living === null) return { done: false, amountPaise: null, detail: f.nothingFlagged ? "Mark the accounts or investments that are your emergency fund, and it is measured against months of what you spend." : "Once there is enough history, or a target of your own, this is measured against months of what you spend." };
      return {
        done: f.living.gapPaise === 0 && !f.nothingFlagged,
        amountPaise: f.living.gapPaise,
        detail: f.nothingFlagged ? "Nothing is marked as your emergency fund yet. Mark the accounts or investments that are, and it is measured against months of what you spend." : f.living.gapPaise === 0 ? "Your living-costs layer is full." : "Months of what you spend, set apart, so a lost income does not change how you live. Every rupee after this goes toward the larger goal.",
      };
    }
    case "medical":
      if (f.medical === null) return { done: true, amountPaise: 0, detail: "No medical amount is set. You can add one in the emergency fund settings." };
      return { done: f.medical.gapPaise === 0 && !f.nothingFlagged, amountPaise: f.medical.gapPaise, detail: f.medical.gapPaise === 0 ? "The medical layer is full." : "Kept on top of the living costs, for what insurance does not pay." };
    case "fire":
      return { done: f.firePct !== null && f.firePct >= 100, amountPaise: null, detail: f.firePct === null ? "Set what a month costs once work stops on the Freedom page to see your number." : `${f.firePct}% of the way to your number. With the steps above in place, extra money can go here.` };
  }
}

/** Walks the steps in order. A step is done, skipped by the person, the next one, or later. */
export function buildLadder(f: LadderFacts): Ladder {
  let next: Step | null = null;
  const steps = STEP_ORDER.map((key): Step => {
    const c = check(key, f);
    const skipped = f.skipped.includes(key);
    let status: StepStatus;
    if (skipped) status = "skipped";
    else if (c.done) status = "done";
    else if (next === null) status = "next";
    else status = "later";
    const step: Step = { key, title: TITLE[key], status, amountPaise: c.amountPaise, detail: c.detail };
    if (status === "next") next = step;
    return step;
  });
  return { steps, next };
}
