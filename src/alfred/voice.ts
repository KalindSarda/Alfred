import { formatRupees } from "../domain/money";

/**
 * Alfred's voice. This is the one place that decides how recorded facts are worded, so the web panel and the
 * Telegram bot sound like the same person. Every sentence is built from recorded figures: nothing here is an
 * estimate, and the wording never judges spending.
 *
 * When the AI phase arrives, a model will phrase the same `BriefingFacts` instead of these templates, and its
 * output will be checked against the facts so it cannot invent a number. The shape returned to callers stays the same.
 */

const IST_OFFSET_MS = 330 * 60_000;

function istParts(now: Date): { hour: number; day: number; dayOfYear: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const start = Date.UTC(shifted.getUTCFullYear(), 0, 0);
  return {
    hour: shifted.getUTCHours(),
    day: shifted.getUTCDate(),
    dayOfYear: Math.floor((shifted.getTime() - start) / 86_400_000),
  };
}

export function dayPart(now: Date): "morning" | "afternoon" | "evening" {
  const { hour } = istParts(now);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** "Good evening, Kalind." and, on a few fixed days of the month, "Good evening, sir." (never random per request). */
export function greeting(name: string, now: Date): string {
  const { day } = istParts(now);
  const address = day % 7 === 0 ? "sir" : name;
  return `Good ${dayPart(now)}, ${address}.`;
}

const SUBLINES = ["Here is where things stand.", "A brief look at your position.", "Here is the situation."];

/** A short line under the greeting; varies by day so it does not feel canned. */
export function subline(now: Date): string {
  return SUBLINES[istParts(now).dayOfYear % SUBLINES.length] as string;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function inDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

const PERIOD_PHRASE: Record<string, string> = {
  "7d": "over the last 7 days",
  "30d": "over the last 30 days",
  "90d": "over the last 90 days",
  this_month: "so far this month",
  last_month: "last month",
  ytd: "so far this year",
};

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
}

/** "so far this month", or "since the 30th" when the user's month starts on their payday. */
function periodPhrase(facts: BriefingFacts): string {
  if (facts.periodKey === "cycle") {
    return facts.cycleStartDay > 1 ? `since the ${ordinal(facts.cycleStartDay)}` : "so far this month";
  }
  return PERIOD_PHRASE[facts.periodKey] ?? "in this period";
}

function previousPhrase(facts: BriefingFacts): string {
  return facts.periodKey === "cycle" ? "the same point last month" : "the period before";
}

export interface BriefingCard {
  name: string;
  nextDueDate: string;
  statementOutstandingPaise: number;
}

/** Everything the briefing may say, already verified by the ledger. */
export interface BriefingFacts {
  today: string;
  periodKey: string;
  /** The day the user's month starts on (1 = calendar months). Only used when periodKey is "cycle". */
  cycleStartDay: number;
  safeToSpendPaise: number;
  /** Money in accounts that is not counted toward safe-to-spend. */
  setAsidePaise: number;
  expensePaise: number;
  previousExpensePaise: number;
  uncategorizedCount: number;
  draftCount: number;
  /** Active credit cards. */
  cards: BriefingCard[];
}

export interface BriefingLine {
  key: string;
  text: string;
  /** Where tapping the line goes in the web app, when somewhere useful exists. */
  to?: string;
}

const rupees = (paise: number) => formatRupees(paise);

export function buildBriefingLines(facts: BriefingFacts, formatDate: (date: string) => string): BriefingLine[] {
  const lines: BriefingLine[] = [];

  const setAside = facts.setAsidePaise > 0 ? ` A further ${rupees(facts.setAsidePaise)} is set aside and not counted.` : "";
  lines.push({
    key: "safe",
    text:
      facts.safeToSpendPaise >= 0
        ? `${rupees(facts.safeToSpendPaise)} is available to spend, as recorded.${setAside}`
        : `Your recorded balances are ${rupees(-facts.safeToSpendPaise)} short of what your cards currently owe.${setAside}`,
    to: "/accounts",
  });

  const cards = [...facts.cards].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  if (cards.length > 0) {
    const pending = cards.filter((c) => c.statementOutstandingPaise > 0);
    const next = pending[0];
    if (!next) {
      lines.push({ key: "due", text: "No card payments are pending.", to: "/accounts" });
    } else {
      const more = pending.length - 1;
      lines.push({
        key: "due",
        text:
          `${next.name}: ${rupees(next.statementOutstandingPaise)} is due on ${formatDate(next.nextDueDate)} ` +
          `(${inDays(daysBetween(facts.today, next.nextDueDate))})` +
          (more > 0 ? `, with ${more} more card${more === 1 ? "" : "s"} to follow.` : "."),
        to: "/accounts",
      });
    }
  }

  const phrase = periodPhrase(facts);
  const before = previousPhrase(facts);
  if (facts.expensePaise > 0 || facts.previousExpensePaise > 0) {
    const diff = facts.expensePaise - facts.previousExpensePaise;
    let comparison: string;
    if (facts.previousExpensePaise === 0) comparison = "There is no earlier spending to compare with.";
    else if (diff === 0) comparison = `That matches ${before}.`;
    else comparison = `That is ${rupees(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${before}.`;

    // A touch of dry wit, only for a clear swing and never at the user's expense.
    let aside = "";
    if (facts.previousExpensePaise > 0) {
      const change = diff / facts.previousExpensePaise;
      if (change >= 0.25) aside = " Your money has been rather busy.";
      else if (change <= -0.25) aside = " A restrained stretch.";
    }
    lines.push({
      key: "spend",
      text: `You have spent ${rupees(facts.expensePaise)} ${phrase}. ${comparison}${aside}`,
      to: "/transactions",
    });
  }

  if (facts.uncategorizedCount > 0) {
    const n = facts.uncategorizedCount;
    lines.push({
      key: "uncategorized",
      text: `${n} ${n === 1 ? "entry needs" : "entries need"} a category.`,
      to: "/transactions?category=none",
    });
  }
  if (facts.draftCount > 0) {
    const n = facts.draftCount;
    lines.push({
      key: "drafts",
      text: `${n} ${n === 1 ? "entry is" : "entries are"} waiting for your confirmation.`,
      to: "/transactions?status=draft",
    });
  }

  return lines;
}

export interface Briefing {
  greeting: string;
  subline: string;
  lines: BriefingLine[];
  /** "template" today; "ai" once Alfred phrases the briefing himself. */
  source: "template" | "ai";
  generatedAt: string;
  footer: string;
}

export const BRIEFING_FOOTER = "Everything here comes from your recorded transactions. I don't make estimates yet.";

/** Shown when nothing is recorded yet. */
export function emptyBriefingLines(): BriefingLine[] {
  return [
    { key: "start", text: "Nothing is recorded yet. Add a bank account or credit card and I will take it from there.", to: "/accounts" },
    { key: "demo", text: "Or try me with sample data first, from More.", to: "/more" },
  ];
}
