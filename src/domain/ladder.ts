/**
 * The foundations: the usual things people firm up in their money, the ideal for each, and how far along the person is. Pure
 * rules over figures other parts of Alfred already work out. They run in parallel (cash going into the emergency fund while a
 * SIP builds toward independence), so there is no "next": each row shows its percent done, and at most one row is tagged as
 * needing attention, chosen by rule. A rule of thumb, not advice. Nothing here names a product or says what to invest in.
 */

export type RowKey = "starter" | "debt" | "cover" | "lifestyle" | "essentials" | "medical" | "fire";
export const ROW_ORDER: readonly RowKey[] = ["starter", "debt", "cover", "lifestyle", "essentials", "medical", "fire"];

export type RowStatus = "ok" | "building" | "attention";

export interface FoundationFacts {
  /** What must be spent in a month on essentials; null when there is too little history. */
  essentialsBurnPaise: number | null;
  /** Bank money counted as available, less what is blocked. */
  liquidPaise: number;
  /** Active bank loans at or above the person's costly-debt rate, largest rate first. */
  costlyLoans: { name: string; ratePct: number; outstandingPaise: number }[];
  /** The costly-debt rate in use, in basis points, for wording. */
  costlyDebtBp: number;
  /** How many covers the person's situation calls for, how many are in place, which are missing, and whether any gap is a high one. */
  cover: { needed: number; inPlace: number; missing: string[]; urgent: boolean };
  /** The emergency fund judged both ways, and its medical layer. Percents are null while a target cannot be sized. */
  fund: {
    nothingFlagged: boolean;
    fundedPaise: number;
    lifestyle: { pct: number | null; gapPaise: number | null; monthsAtTypical: number | null };
    essentials: { pct: number | null; gapPaise: number | null; monthsAtTypical: number | null };
    /** Null when no medical amount is set. */
    medical: { fundedPaise: number; targetPaise: number } | null;
  };
  /** Progress toward the independence number, when there is one. */
  firePct: number | null;
}

export interface Row {
  key: RowKey;
  title: string;
  /** What the ideal is, in a phrase. */
  ideal: string;
  /** How far along, 0 to 100; null when it cannot be told (or does not apply as a figure). */
  pct: number | null;
  status: RowStatus;
  /** Where the person stands and why, in a sentence or two. */
  detail: string;
  /** What is still missing in paise, when a figure applies. */
  amountPaise: number | null;
}

export interface Foundations {
  rows: Row[];
  /** The one row to look at first, by rule; null when nothing needs attention. */
  attention: Row | null;
}

const clampPct = (n: number): number => Math.min(100, Math.max(0, Math.round(n * 10) / 10));

type Draft = Omit<Row, "status"> & { done: boolean };

function drafts(f: FoundationFacts): Draft[] {
  const out: Draft[] = [];

  // Starter buffer.
  if (f.essentialsBurnPaise === null) {
    out.push({ key: "starter", title: "Starter buffer", ideal: "One month of essentials in the bank", pct: null, done: false, amountPaise: null, detail: "Once there are about two weeks of entries I can size one month of essentials, so a surprise never lands on a card." });
  } else {
    const gap = Math.max(0, f.essentialsBurnPaise - f.liquidPaise);
    out.push({ key: "starter", title: "Starter buffer", ideal: "One month of essentials in the bank", pct: clampPct((Math.max(0, f.liquidPaise) / f.essentialsBurnPaise) * 100), done: gap === 0, amountPaise: gap, detail: gap === 0 ? "A month of essentials is in the bank." : "A month of essentials in the bank stops a surprise from going on a card." });
  }

  // Costly debt.
  const worst = f.costlyLoans[0];
  out.push({
    key: "debt",
    title: "Costly debt",
    ideal: `No bank loan at ${f.costlyDebtBp / 100}% a year or more`,
    pct: worst ? null : 100,
    done: !worst,
    amountPaise: worst ? f.costlyLoans.reduce((s, l) => s + l.outstandingPaise, 0) : 0,
    detail: worst ? `${worst.name} costs ${worst.ratePct}% a year. The interest saved by paying a loan down is certain, unlike a return. The part-payment what-if shows what it would save.` : "No bank loan at or above that rate.",
  });

  // Health and life cover.
  out.push({
    key: "cover",
    title: "Health and life cover",
    ideal: f.cover.needed > 1 ? "Personal health cover and term life cover" : "Personal health cover",
    pct: clampPct((f.cover.inPlace / Math.max(1, f.cover.needed)) * 100),
    done: f.cover.missing.length === 0,
    amountPaise: null,
    detail: f.cover.missing.length === 0 ? "No gaps found against the usual rules of thumb." : `${f.cover.missing.join("; ")}. One hospital bill or a lost income can undo years of saving.`,
  });

  // The emergency fund, both ways.
  const fund = (key: "lifestyle" | "essentials", title: string, ideal: string, t: FoundationFacts["fund"]["lifestyle"]): Draft => ({
    key,
    title,
    ideal,
    pct: t.pct,
    done: t.pct !== null && t.pct >= 100 && !f.fund.nothingFlagged,
    amountPaise: t.gapPaise,
    detail:
      t.pct === null
        ? "Once there is enough history, or a target of your own, this is measured against months of what you spend."
        : f.fund.nothingFlagged
          ? "Nothing is marked as your emergency fund yet. Mark the accounts or investments that are."
          : t.gapPaise === 0
            ? "Fully covered."
            : t.monthsAtTypical !== null
              ? `About ${t.monthsAtTypical} ${t.monthsAtTypical === 1 ? "month" : "months"} to go at your usual pace.`
              : "Nothing is left over each month at the moment, so no time can be given.",
  });
  out.push(fund("lifestyle", "Emergency fund, lifestyle", "Months of everything you spend now, plus a medical reserve", f.fund.lifestyle));
  out.push(fund("essentials", "Emergency fund, essentials", "Months of essentials alone, plus the same medical reserve", f.fund.essentials));

  // Medical reserve.
  if (f.fund.medical === null) {
    out.push({ key: "medical", title: "Medical reserve", ideal: "A set amount on top, for what insurance does not pay", pct: null, done: true, amountPaise: 0, detail: "No medical amount is set. You can add one in the emergency fund settings." });
  } else {
    const gap = Math.max(0, f.fund.medical.targetPaise - f.fund.medical.fundedPaise);
    out.push({ key: "medical", title: "Medical reserve", ideal: "A set amount on top, for what insurance does not pay", pct: clampPct((f.fund.medical.fundedPaise / Math.max(1, f.fund.medical.targetPaise)) * 100), done: gap === 0, amountPaise: gap, detail: gap === 0 ? "The medical layer is full." : "Filled after the living costs, from the same pool." });
  }

  // Independence.
  out.push({
    key: "fire",
    title: "Financial independence",
    ideal: "The corpus that covers your spending",
    pct: f.firePct,
    done: f.firePct !== null && f.firePct >= 100,
    amountPaise: null,
    detail: f.firePct === null ? "Set what a month costs once work stops, on this page, to see your number." : `${f.firePct}% of the way to your number. This is a long road, and it can run alongside the rest.`,
  });
  return out;
}

/** The emergency rows that can need attention, lowest percent first. The medical layer is inside both totals, so it never is one by itself. */
const EMERGENCY: readonly RowKey[] = ["lifestyle", "essentials"];

/**
 * Rows with a percent and a status. At most one is tagged "attention", by this order: a high cover gap, then costly debt, then a
 * starter buffer under half, then the emergency row furthest from done (lifestyle or essentials). Independence is never tagged: it is the long road.
 */
export function buildFoundations(f: FoundationFacts): Foundations {
  const list = drafts(f);
  const byKey = new Map(list.map((d) => [d.key, d] as const));

  let focus: RowKey | null = null;
  if (!(byKey.get("cover")?.done ?? true) && f.cover.urgent) focus = "cover";
  else if (!(byKey.get("debt")?.done ?? true)) focus = "debt";
  else if (byKey.get("starter")?.pct !== null && (byKey.get("starter")?.pct ?? 100) < 50) focus = "starter";
  else {
    const open = EMERGENCY.map((k) => byKey.get(k) as Draft).filter((d) => !d.done && d.pct !== null);
    open.sort((a, b) => (a.pct as number) - (b.pct as number) || EMERGENCY.indexOf(a.key) - EMERGENCY.indexOf(b.key));
    if (open[0]) focus = open[0].key;
  }

  const rows = ROW_ORDER.map((key): Row => {
    const { done, ...row } = byKey.get(key) as Draft;
    const status: RowStatus = done ? "ok" : key === focus ? "attention" : "building";
    return { ...row, status };
  });
  return { rows, attention: rows.find((r) => r.status === "attention") ?? null };
}

export type Frequency = "weekly" | "monthly" | "yearly";

/** What something repeating comes to in a month. */
export function monthlyEquivalent(amountPaise: number, frequency: Frequency): number {
  switch (frequency) {
    case "weekly":
      return Math.round((amountPaise * 52) / 12);
    case "monthly":
      return amountPaise;
    case "yearly":
      return Math.round(amountPaise / 12);
  }
}
