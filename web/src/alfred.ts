import { formatRupees } from "../../src/domain/money";
import type { Account, CardAccount, Summary } from "./api";

/**
 * Alfred's voice for the briefing. Every line is built from recorded figures; nothing here is an estimate
 * or a guess, and the wording never judges spending.
 */

const IST_OFFSET_MS = 330 * 60_000;

function istParts(now: Date): { hour: number; day: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return { hour: shifted.getUTCHours(), day: shifted.getUTCDate() };
}

export function dayPart(now: Date): "morning" | "afternoon" | "evening" {
  const { hour } = istParts(now);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** "Good evening, Kalind." and, on a few fixed days of the month, "Good evening, sir." (never random per render). */
export function greeting(name: string, now: Date): string {
  const { day } = istParts(now);
  const address = day % 7 === 0 ? "sir" : name;
  return `Good ${dayPart(now)}, ${address}.`;
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

export interface BriefingLine {
  key: string;
  text: string;
  /** Where tapping the line goes, when somewhere useful exists. */
  to?: string;
}

const rupees = (paise: number) => formatRupees(paise);

export function cardsByDue(accounts: readonly Account[]): CardAccount[] {
  return accounts
    .filter((a): a is CardAccount => a.kind === "card" && !a.archived)
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

export function buildBriefing(
  summary: Summary,
  accounts: readonly Account[],
  today: string,
  formatDate: (date: string) => string,
): BriefingLine[] {
  const lines: BriefingLine[] = [];

  lines.push({
    key: "safe",
    text:
      summary.safeToSpendPaise >= 0
        ? `${rupees(summary.safeToSpendPaise)} is available to spend, as recorded.`
        : `Your recorded balances are ${rupees(-summary.safeToSpendPaise)} short of what your cards currently owe.`,
    to: "/accounts",
  });

  const cards = cardsByDue(accounts);
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
          `(${inDays(daysBetween(today, next.nextDueDate))})` +
          (more > 0 ? `, with ${more} more card${more === 1 ? "" : "s"} to follow.` : "."),
        to: "/accounts",
      });
    }
  }

  const phrase = PERIOD_PHRASE[summary.period.key] ?? "in this period";
  if (summary.expensePaise > 0 || summary.previousExpensePaise > 0) {
    const diff = summary.expensePaise - summary.previousExpensePaise;
    let comparison: string;
    if (summary.previousExpensePaise === 0) comparison = "There is no earlier spending to compare with.";
    else if (diff === 0) comparison = "That matches the period before.";
    else comparison = `That is ${rupees(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than the period before.`;
    lines.push({
      key: "spend",
      text: `You have spent ${rupees(summary.expensePaise)} ${phrase}. ${comparison}`,
      to: "/transactions",
    });
  }

  if (summary.uncategorizedCount > 0) {
    const n = summary.uncategorizedCount;
    lines.push({
      key: "uncategorized",
      text: `${n} ${n === 1 ? "entry needs" : "entries need"} a category.`,
      to: "/transactions?category=none",
    });
  }
  if (summary.draftCount > 0) {
    const n = summary.draftCount;
    lines.push({
      key: "drafts",
      text: `${n} ${n === 1 ? "entry is" : "entries are"} waiting for your confirmation.`,
      to: "/transactions?status=draft",
    });
  }

  return lines;
}
