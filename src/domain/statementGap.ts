/**
 * Why a card statement might differ from what Alfred has: pure rules, worded cautiously because they are only
 * likelihoods. A gap that is exactly a whole-rupee fee plus 18% GST is very likely a fee; a gap that is a few percent of
 * what was left unpaid last month is likely interest.
 */

export type GapKind = "matches" | "fee_gst" | "interest" | "unrecorded" | "credit";
export type BookAs = "fee" | "spending" | "credit";

export interface GapAnalysis {
  /** The statement's total less Alfred's: positive means the bank says more. */
  differencePaise: number;
  kind: GapKind;
  /** A sentence for the person, in plain and cautious words. */
  reason: string;
  /** What to book to make Alfred agree, and as what; null when they already agree. */
  bookAs: BookAs | null;
}

const rupees = (paise: number): string => {
  const whole = Math.trunc(paise / 100);
  const frac = paise % 100;
  const grouped = whole.toString().replace(/(\d+?)(?=(\d\d)+(\d)$)/g, "$1,");
  return `₹${grouped}${frac === 0 ? "" : `.${String(frac).padStart(2, "0")}`}`;
};

/** GST on a fee or a finance charge. */
const GST = 1.18;

/** A fee in whole rupees whose total with GST is exactly the gap (to the paisa), if there is one. */
export function feeWithGstInRupees(gapPaise: number): number | null {
  const fee = Math.round(gapPaise / GST / 100) * 100;
  if (fee < 5_000) return null;
  return Math.abs(Math.round(fee * GST) - gapPaise) <= 1 ? fee : null;
}

/**
 * Compares the statement's total with Alfred's. `previousUnpaidPaise` is what was left unpaid from the statement before
 * this one when its due date passed, which is what interest would be charged on.
 */
export function explainStatementGap(expectedPaise: number, billedPaise: number, previousUnpaidPaise: number): GapAnalysis {
  const differencePaise = billedPaise - expectedPaise;
  if (differencePaise === 0) return { differencePaise, kind: "matches", reason: "That matches.", bookAs: null };

  if (differencePaise < 0) {
    return {
      differencePaise,
      kind: "credit",
      reason: `The statement is ${rupees(-differencePaise)} lower than I have. A cashback or refund credit may be missing from my records, or a payment I dated later than your bank did.`,
      bookAs: "credit",
    };
  }

  const fee = feeWithGstInRupees(differencePaise);
  if (fee !== null) {
    return {
      differencePaise,
      kind: "fee_gst",
      reason: `${rupees(differencePaise)} is exactly ${rupees(fee)} plus 18% GST, which looks like a fee (processing, annual or late) that I did not know of.`,
      bookAs: "fee",
    };
  }

  if (previousUnpaidPaise > 0) {
    const ratio = differencePaise / previousUnpaidPaise;
    if (ratio >= 0.015 && ratio <= 0.08) {
      return {
        differencePaise,
        kind: "interest",
        reason: `Last month's bill was not paid in full (${rupees(previousUnpaidPaise)} was left), and ${rupees(differencePaise)} is about ${(ratio * 100).toFixed(1)}% of that, so it looks like interest and GST.`,
        bookAs: "fee",
      };
    }
  }

  return {
    differencePaise,
    kind: "unrecorded",
    reason: `The statement is ${rupees(differencePaise)} higher than I have. A purchase may be missing from my records, or a charge I cannot name from the figure alone.`,
    bookAs: "spending",
  };
}
