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
  return `Good ${dayPart(now)}, ${address(name, now)}.`;
}

/** How Alfred addresses the user today: their name, or "sir" on a few fixed days of the month. */
export function address(name: string, now: Date): string {
  return istParts(now).day % 7 === 0 ? "sir" : name;
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

export interface BriefingHold {
  title: string;
  amountPaise: number;
  expectedDate: string | null;
}

export interface BriefingRecurring {
  title: string;
  type: "expense" | "income" | "investment";
  amountPaise: number;
  date: string;
}

export interface BriefingGoals {
  /** Put toward active goals: still in the bank, but not spendable. */
  setAsidePaise: number;
  count: number;
  /** The goal whose date is closest and not yet reached (within 30 days or passed), if any. */
  attention: { name: string; remainingPaise: number; targetDate: string } | null;
}

export interface BriefingDebts {
  /** Loans still open whose due date has passed, oldest first. */
  overdue: { name: string; direction: "lent" | "borrowed"; outstandingPaise: number; dueDate: string }[];
}

export interface BriefingHoldings {
  /** Active holdings whose value was typed more than 35 days ago, or never. */
  staleCount: number;
  /** The oldest of them, in days; null when one has no value at all. */
  oldestDays: number | null;
}

export interface BriefingLoans {
  /** The nearest loan instalment, when it falls within a week. */
  next: { name: string; totalPaise: number; date: string; accountName: string } | null;
}

export interface BriefingEmi {
  /** Instalments not yet billed, across all running plans. */
  toComePaise: number;
  next: { title: string; amountPaise: number; date: string } | null;
}

export interface BriefingBudget {
  categoryName: string;
  pct: number;
  remainingPaise: number;
  status: "ok" | "near" | "over";
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
  /** Budgets with this month's progress. */
  budgets: BriefingBudget[];
  /** Money blocked for applications such as IPOs, still waiting on an outcome. */
  holds: BriefingHold[];
  /** Card EMI instalments still to be billed. */
  emi: BriefingEmi;
  /** The soonest recurring entry due within a week, if any. */
  recurring: BriefingRecurring | null;
  /** Savings goals; leave out when there are none. */
  goals?: BriefingGoals;
  /** Lent and borrowed money; leave out when there is none. */
  debts?: BriefingDebts;
  /** Investments; leave out when there are none. */
  holdings?: BriefingHoldings;
  /** Bank loans; leave out when there are none. */
  loans?: BriefingLoans;
  /** What is still to leave before the next salary; leave out when nothing is coming. */
  commitments?: { count: number; untilDate: string; freeToSpendPaise: number };
  /** How long since the person last logged an entry; leave out when they never have. */
  logging?: { daysSince: number; lastDate: string };
  /** Bank debits in the next few days that the account cannot cover; leave out when there are none. */
  shortfalls?: { title: string; amountPaise: number; accountName: string; shortByPaise: number; date: string }[];
  /** The nearest insurance premium or renewal within a week, on the person's own policies. */
  insurance?: { insurer: string; kind: "health" | "term" | "other"; premiumPaise: number; date: string } | null;
  /** How the foundations stand: the emergency fund against both targets, independence, and the one row to look at first. */
  progress?: { emergency: { lifestylePct: number; essentialsPct: number | null } | null; firePct: number | null; focus: { title: string; detail: string } | null };
}

/** Where a line sits in the briefing, in the order they are shown. */
export type BriefingSection = "needs" | "position" | "progress" | "coming" | "trends";

export const SECTION_TITLES: Record<BriefingSection, string> = {
  needs: "Needs you",
  position: "Where you stand",
  progress: "Progress",
  coming: "Coming up",
  trends: "Trends",
};

export const SECTION_ORDER: readonly BriefingSection[] = ["needs", "position", "progress", "coming", "trends"];

export interface BriefingLine {
  key: string;
  text: string;
  /** Where tapping the line goes in the web app, when somewhere useful exists. */
  to?: string;
  section: BriefingSection;
  /** How much it matters, 0 to 100: when there is more to say than fits, the highest are kept. */
  importance: number;
  /** Worth a message of its own in the morning: something to do now or within two days. */
  soon?: boolean;
}

const rupees = (paise: number) => formatRupees(paise);

/**
 * Everything the briefing could say, each line placed in a section with an importance. Nothing is dropped here; composing
 * the briefing keeps the most important. `money` formats amounts: the web shows lakhs and crores compactly, Telegram in full.
 */
export function buildBriefingLines(facts: BriefingFacts, formatDate: (date: string) => string, money: (paise: number) => string = rupees): BriefingLine[] {
  const lines: BriefingLine[] = [];
  const m = money;
  const add = (line: BriefingLine) => lines.push(line);

  // Where you stand: one line, with what is free, what is in hand and what is still to leave.
  const setAside = facts.setAsidePaise > 0 ? ` A further ${m(facts.setAsidePaise)} is set aside and not counted.` : "";
  const c = facts.commitments;
  const stillToLeave = c ? facts.safeToSpendPaise - c.freeToSpendPaise : 0;
  let position: string;
  if (facts.safeToSpendPaise < 0) {
    position = `Your recorded balances are ${m(-facts.safeToSpendPaise)} short of what your cards currently owe.${setAside}`;
  } else if (c && c.count > 0) {
    const things = `${c.count} ${c.count === 1 ? "payment" : "payments"}`;
    position =
      c.freeToSpendPaise >= 0
        ? `${m(c.freeToSpendPaise)} is free to spend until ${formatDate(c.untilDate)}. You have ${m(facts.safeToSpendPaise)} in hand, with ${m(stillToLeave)} still to leave in ${things}.${setAside}`
        : `${things} still to leave before ${formatDate(c.untilDate)} come to ${m(-c.freeToSpendPaise)} more than is free to spend. You have ${m(facts.safeToSpendPaise)} in hand.${setAside}`;
  } else {
    position = `${m(facts.safeToSpendPaise)} is available to spend, as recorded.${setAside}`;
  }
  add({ key: "position", text: position, to: "/accounts", section: "position", importance: 100 });

  // Needs you.
  for (const s of facts.shortfalls ?? []) {
    add({ key: "shortfall", text: `${s.title} (${m(s.amountPaise)}) is due ${inDays(daysBetween(facts.today, s.date))}, but ${s.accountName} is ${m(s.shortByPaise)} short.`, to: "/accounts?view=commitments", section: "needs", importance: 100, soon: true });
  }

  const cards = [...facts.cards].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
  if (cards.length > 0) {
    const pending = cards.filter((card) => card.statementOutstandingPaise > 0);
    const next = pending[0];
    if (!next) {
      add({ key: "due", text: "No card payments are pending.", to: "/accounts", section: "coming", importance: 5 });
    } else {
      const more = pending.length - 1;
      const days = daysBetween(facts.today, next.nextDueDate);
      add({
        key: "due",
        text: `${next.name}: ${m(next.statementOutstandingPaise)} is due on ${formatDate(next.nextDueDate)} (${inDays(days)})${more > 0 ? `, with ${more} more card${more === 1 ? "" : "s"} to follow.` : "."}`,
        to: "/accounts",
        section: days <= 3 ? "needs" : "coming",
        importance: days <= 3 ? 90 : 50,
        soon: days <= 2,
      });
    }
  }

  const policy = facts.insurance;
  if (policy) {
    const what = policy.kind === "health" ? "health" : policy.kind === "term" ? "term life" : "insurance";
    const days = daysBetween(facts.today, policy.date);
    add({ key: "insurance", text: `Your ${what} policy with ${policy.insurer} is due ${inDays(days)}${policy.premiumPaise > 0 ? `: ${m(policy.premiumPaise)}` : ""}. Paying on time keeps the cover from lapsing.`, to: "/protection", section: "needs", importance: 80, soon: days <= 2 });
  }

  const late = facts.debts?.overdue ?? [];
  if (late.length > 0) {
    const d = late[0]!;
    const first =
      d.direction === "lent"
        ? `${d.name} still owes you ${m(d.outstandingPaise)}, which was due ${formatDate(d.dueDate)}.`
        : `You owe ${d.name} ${m(d.outstandingPaise)}, which was due ${formatDate(d.dueDate)}.`;
    add({ key: "debts", text: late.length > 1 ? `${first} ${late.length - 1} more ${late.length === 2 ? "loan is" : "loans are"} overdue too.` : first, to: "/accounts?view=commitments#lent", section: "needs", importance: 75 });
  }

  // Blocked money: an outcome that is overdue needs you; otherwise it is just something to know about.
  if (facts.holds.length > 0) {
    const total = facts.holds.reduce((sum, h) => sum + h.amountPaise, 0);
    const dated = facts.holds.filter((h) => h.expectedDate !== null).map((h) => h.expectedDate as string).sort();
    const overdue = dated.filter((d) => d < facts.today).length;
    const next = dated.find((d) => d >= facts.today);
    const what = facts.holds.length === 1 ? (facts.holds[0] as BriefingHold).title : `${facts.holds.length} applications`;
    let text = `${m(total)} is blocked for ${what}`;
    if (overdue > 0) text += `. ${overdue === 1 ? "An outcome was" : `${overdue} outcomes were`} due earlier; do tell me how ${overdue === 1 ? "it" : "they"} went`;
    else if (next) text += `; the outcome is due ${formatDate(next)}`;
    add({ key: "blocked", text: `${text}.`, to: "/accounts?view=commitments", section: overdue > 0 ? "needs" : "coming", importance: overdue > 0 ? 70 : 40 });
  }

  if (facts.logging && facts.logging.daysSince >= 2) {
    add({ key: "habit", text: `Nothing logged since ${formatDate(facts.logging.lastDate)}, ${facts.logging.daysSince} days. Shall we catch up?`, to: "/transactions", section: "needs", importance: 60 });
  }
  if (facts.draftCount > 0) {
    const n = facts.draftCount;
    add({ key: "drafts", text: `${n} ${n === 1 ? "entry is" : "entries are"} waiting for your confirmation.`, to: "/transactions?status=draft", section: "needs", importance: 55 });
  }

  // Progress.
  const focus = facts.progress?.focus;
  if (focus) add({ key: "focus", text: `Look at first: ${focus.title}. ${focus.detail}`, to: "/freedom#foundations", section: "progress", importance: 65 });
  const fund = facts.progress?.emergency;
  if (fund) {
    add({ key: "emergency", text: `Emergency fund: ${fund.lifestylePct}% of your lifestyle goal${fund.essentialsPct !== null ? `, ${fund.essentialsPct}% of essentials only` : ""}.`, to: "/freedom#emergency", section: "progress", importance: 45 });
  }
  if (facts.progress && facts.progress.firePct !== null) {
    add({ key: "independence", text: `Independence: ${facts.progress.firePct}% of the way to your number.`, to: "/freedom#fire", section: "progress", importance: 30 });
  }
  const goals = facts.goals;
  if (goals && goals.count > 0 && goals.setAsidePaise > 0) {
    const covered = facts.safeToSpendPaise >= 0 ? "" : " Your balances no longer cover all of it.";
    const near = goals.attention ? ` ${goals.attention.name} still needs ${m(goals.attention.remainingPaise)} by ${formatDate(goals.attention.targetDate)}.` : "";
    add({
      key: "goals",
      text: `${m(goals.setAsidePaise)} is put toward ${goals.count === 1 ? "a savings goal" : `${goals.count} savings goals`}, so it is not counted as spendable.${near}${covered}`,
      to: "/plan?view=goals",
      section: "progress",
      importance: 35,
    });
  }

  // Coming up.
  if (facts.emi.toComePaise > 0) {
    const n = facts.emi.next;
    add({
      key: "emi",
      text: `${m(facts.emi.toComePaise)} of card EMIs is still to be billed${n ? `; the next is ${m(n.amountPaise)} for ${n.title} on ${formatDate(n.date)}` : ""}.`,
      to: "/accounts?view=commitments",
      section: "coming",
      importance: 50,
      soon: facts.emi.next ? daysBetween(facts.today, facts.emi.next.date) <= 2 : false,
    });
  }
  const loan = facts.loans?.next;
  if (loan) {
    const days = daysBetween(facts.today, loan.date);
    add({ key: "loans", text: `${loan.name}: ${m(loan.totalPaise)} is due on ${formatDate(loan.date)} (${inDays(days)}), from ${loan.accountName}.`, to: "/accounts?view=commitments#loans", section: "coming", importance: 55, soon: days <= 2 });
  }
  if (facts.recurring) {
    const r = facts.recurring;
    const days = daysBetween(facts.today, r.date);
    const when = `${formatDate(r.date)} (${inDays(days)})`;
    add({ key: "recurring", text: r.type === "income" ? `${r.title}, ${m(r.amountPaise)}, is expected on ${when}.` : `${r.title}, ${m(r.amountPaise)}, comes up on ${when}.`, to: "/plan?view=recurring", section: "coming", importance: 45, soon: days <= 2 });
  }

  // Trends.
  const phrase = periodPhrase(facts);
  const before = previousPhrase(facts);
  if (facts.expensePaise > 0 || facts.previousExpensePaise > 0) {
    const diff = facts.expensePaise - facts.previousExpensePaise;
    let comparison: string;
    if (facts.previousExpensePaise === 0) comparison = "There is no earlier spending to compare with.";
    else if (diff === 0) comparison = `That matches ${before}.`;
    else comparison = `That is ${m(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${before}.`;

    // A touch of dry wit, only for a clear swing and never at the user's expense.
    let aside = "";
    if (facts.previousExpensePaise > 0) {
      const change = diff / facts.previousExpensePaise;
      if (change >= 0.25) aside = " Your money has been rather busy.";
      else if (change <= -0.25) aside = " A restrained stretch.";
    }
    add({ key: "spend", text: `You have spent ${m(facts.expensePaise)} ${phrase}. ${comparison}${aside}`, to: "/transactions", section: "trends", importance: 40 });
  }

  // Budgets only get a line when one needs attention, and over comes before near.
  const over = facts.budgets.filter((b) => b.status === "over");
  const near = facts.budgets.filter((b) => b.status === "near");
  const pressed = [...over, ...near].slice(0, 2);
  if (pressed.length > 0) {
    const parts = pressed.map((b) => (b.status === "over" ? `${b.categoryName} is ${m(-b.remainingPaise)} over its budget` : `${b.categoryName} is at ${Math.round(b.pct)}% of its budget`));
    const more = over.length + near.length - pressed.length;
    add({ key: "budget", text: `${parts.join(", and ")}${more > 0 ? `, with ${more} more to watch` : ""}.`, to: "/plan?view=budgets", section: "trends", importance: over.length > 0 ? 58 : 48 });
  }

  const held = facts.holdings;
  if (held && held.staleCount > 0) {
    const n = held.staleCount;
    const how = held.oldestDays === null ? "has no value yet" : `was last valued ${held.oldestDays} days ago`;
    add({
      key: "investments",
      text: n === 1 ? `One of your investments ${how}. A fresh value keeps your net worth honest.` : `${n} of your investments need a fresh value; the oldest ${held.oldestDays === null ? "has none yet" : `was last valued ${held.oldestDays} days ago`}.`,
      to: "/accounts?view=investments",
      section: "trends",
      importance: 25,
    });
  }
  if (facts.uncategorizedCount > 0) {
    const n = facts.uncategorizedCount;
    add({ key: "uncategorized", text: `${n} ${n === 1 ? "entry needs" : "entries need"} a category.`, to: "/transactions?category=none", section: "trends", importance: 20 });
  }

  return lines;
}

/** How many lines the home briefing shows at most. */
export const BRIEFING_CAP = 7;

export interface BriefingSectionView {
  key: BriefingSection;
  title: string;
  lines: BriefingLine[];
}

/**
 * Keeps the most important lines (the position line always), and groups them by section in the order people read them:
 * what needs them, where they stand, progress, what is coming, trends. Empty sections vanish.
 */
export function composeBriefing(lines: readonly BriefingLine[], cap: number = BRIEFING_CAP): { sections: BriefingSectionView[]; lines: BriefingLine[] } {
  const kept = new Set(
    [...lines]
      .map((l, i) => ({ l, i }))
      .sort((a, b) => b.l.importance - a.l.importance || a.i - b.i)
      .slice(0, cap)
      .map((x) => x.l),
  );
  const sections = SECTION_ORDER.map((key): BriefingSectionView => ({
    key,
    title: SECTION_TITLES[key],
    lines: lines.filter((l) => l.section === key && kept.has(l)).sort((a, b) => b.importance - a.importance),
  })).filter((s) => s.lines.length > 0);
  return { sections, lines: sections.flatMap((s) => s.lines) };
}

export interface Briefing {
  greeting: string;
  subline: string;
  lines: BriefingLine[];
  /** The same lines grouped as they are shown: needs you, where you stand, progress, coming up, trends. */
  sections: BriefingSectionView[];
  /** "template" today; "ai" once Alfred phrases the briefing himself. */
  source: "template" | "ai";
  generatedAt: string;
  footer: string;
}

export const BRIEFING_FOOTER = "Everything here comes from your recorded transactions. I don't make estimates yet.";

/** Shown when nothing is recorded yet. */
export function emptyBriefingLines(): BriefingLine[] {
  return [
    { key: "start", text: "Nothing is recorded yet. Add a bank account or credit card and I will take it from there.", to: "/accounts", section: "position", importance: 100 },
    { key: "demo", text: "Or try me with sample data first, from Settings.", to: "/settings#demo", section: "position", importance: 90 },
  ];
}
