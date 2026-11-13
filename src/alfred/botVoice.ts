import { formatRupees } from "../domain/money";
import type { EntryType } from "../bot/parser";
import { greeting, inDays } from "./voice";

/**
 * What Alfred says in Telegram. Short, composed, never excited: no exclamation marks, no emoji, and he never
 * claims something happened until it has. Wording lives here so it can be reviewed in one place and, later,
 * replaced by AI phrasing of the same facts.
 */

const rupees = (paise: number) => formatRupees(paise);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export interface EntryFacts {
  type: EntryType;
  amountPaise: number;
  merchant: string | null;
  categoryName: string | null;
  fromName: string | null;
  toName: string | null;
  txnDate: string;
  today: string;
}

/** One line describing an entry, for confirmations and receipts: "₹450 at Swiggy, under Food & Dining, on HDFC Millennia". */
export function describeEntry(f: EntryFacts): string {
  const when = f.txnDate === f.today ? "" : `, on ${shortDate(f.txnDate)}`;
  switch (f.type) {
    case "expense":
      return `${rupees(f.amountPaise)}${f.merchant ? ` at ${f.merchant}` : ""}${f.categoryName ? `, under ${f.categoryName}` : ""}${f.fromName ? `, from ${f.fromName}` : ""}${when}`;
    case "income":
      return `${rupees(f.amountPaise)} received${f.fromName ? ` in ${f.fromName}` : ""}${f.merchant ? ` from ${f.merchant}` : ""}${f.categoryName ? `, under ${f.categoryName}` : ""}${when}`;
    case "bill_payment":
      return `${rupees(f.amountPaise)} paid to ${f.toName ?? "the card"}${f.fromName ? ` from ${f.fromName}` : ""}${when}`;
    case "transfer":
      return `${rupees(f.amountPaise)} moved${f.fromName ? ` from ${f.fromName}` : ""}${f.toName ? ` to ${f.toName}` : ""}${when}`;
  }
}

export type Need = "from" | "to";

/** The question Alfred asks when an account is missing or ambiguous. */
export function askAccount(type: EntryType, need: Need, summary: string): string {
  if (type === "bill_payment") return need === "to" ? `Which card are you paying? (${summary})` : `Which account shall I pay it from? (${summary})`;
  if (type === "transfer") return need === "from" ? `Which account shall I move it from? (${summary})` : `And which account is it going to? (${summary})`;
  if (type === "income") return `Which account did it arrive in? (${summary})`;
  return `Which account shall I use? (${summary})`;
}

export interface ReminderCard {
  name: string;
  amountPaise: number;
  dueDate: string;
  daysAway: number;
}

/**
 * Alfred's note before card payments fall due. Facts only: what is due, when, and whether the balances he can
 * see cover it. He says "tracked" because he only knows what has been recorded.
 */
export function cardReminder(cards: ReminderCard[], countedBalancePaise: number): string {
  const total = cards.reduce((sum, c) => sum + c.amountPaise, 0);
  const coverage =
    countedBalancePaise >= total
      ? "Your tracked balances cover it, assuming nothing else is pending."
      : `Your tracked balances are ${rupees(total - countedBalancePaise)} short of it, so a transfer may be needed.`;

  const only = cards[0];
  if (cards.length === 1 && only) {
    return `A quick reminder: ${only.name} has ${rupees(only.amountPaise)} due on ${shortDate(only.dueDate)}, ${inDays(only.daysAway)}. ${coverage}`;
  }
  const lines = cards.map((c) => `${c.name}: ${rupees(c.amountPaise)} on ${shortDate(c.dueDate)} (${inDays(c.daysAway)})`);
  return ["A quick reminder: several card payments are coming up.", ...lines, "", `Together that is ${rupees(total)}. ${coverage}`].join("\n");
}

/** After logging a spend in a budgeted category: what is left, said plainly and without scolding. */
export function budgetNote(categoryName: string, remainingPaise: number, status: "ok" | "near" | "over"): string {
  if (status === "over") return `That puts ${categoryName} ${rupees(-remainingPaise)} over its budget.`;
  if (status === "near") return `Your ${categoryName} budget has ${rupees(remainingPaise)} remaining, which is close to the limit.`;
  return `Your ${categoryName} budget has ${rupees(remainingPaise)} remaining.`;
}

export interface BudgetLine {
  categoryName: string;
  spentPaise: number;
  limitPaise: number;
  remainingPaise: number;
  pct: number;
  status: "ok" | "near" | "over";
}

export function budgetsReply(period: { from: string; to: string }, items: BudgetLine[], totalSpentPaise: number, totalLimitPaise: number): string {
  if (items.length === 0) return "You have not set any budgets yet. You can add them in the app, under Plan.";
  const lines = [`Your budgets for ${shortDate(period.from)} to ${shortDate(period.to)}:`];
  for (const b of items) {
    const left =
      b.status === "over" ? `${rupees(-b.remainingPaise)} over` : b.status === "near" ? `${rupees(b.remainingPaise)} remaining, close to the limit` : `${rupees(b.remainingPaise)} remaining`;
    lines.push(`${b.categoryName}: ${rupees(b.spentPaise)} of ${rupees(b.limitPaise)} (${b.pct}%), ${left}`);
  }
  lines.push("", `In total: ${rupees(totalSpentPaise)} of ${rupees(totalLimitPaise)}.`);
  return lines.join("\n");
}

/** The category list, expense first. Archived categories are not shown. */
export function categoriesReply(expense: string[], income: string[]): string {
  return [
    `Expense categories: ${expense.length ? expense.join(", ") : "none yet"}.`,
    `Income categories: ${income.length ? income.join(", ") : "none yet"}.`,
    "",
    "To add one: /category add Pets (for income: /category add income Freelance). Renaming, merging and deleting are in the app, under You, then Categories.",
  ].join("\n");
}

export interface HoldLine {
  title: string;
  amountPaise: number;
  accountName: string;
  expectedDate: string | null;
  overdue: boolean;
}

/** Money blocked for applications, soonest outcome first. */
export function holdsReply(items: HoldLine[], note?: string): string {
  const lines: string[] = note ? [note, ""] : [];
  const total = items.reduce((sum, h) => sum + h.amountPaise, 0);
  lines.push(`Blocked for applications: ${rupees(total)}. Tap one when you know how it went.`);
  for (const h of items) {
    const when = h.expectedDate ? `, outcome ${h.overdue ? "was due" : "due"} ${shortDate(h.expectedDate)}` : "";
    lines.push(`${h.title}: ${rupees(h.amountPaise)} in ${h.accountName}${when}`);
  }
  return lines.join("\n");
}

export interface EmiLine {
  title: string;
  cardName: string;
  months: number;
  billedCount: number;
  toComePaise: number;
  nextDate: string | null;
  nextAmountPaise: number | null;
  status: "active" | "finished" | "cancelled";
}

/** Running EMI plans: how far along each is and what is still to be billed. */
export function emiReply(items: EmiLine[]): string {
  const running = items.filter((p) => p.status === "active");
  if (running.length === 0) return "You have no EMI plans running. You can add one in the app, under Money, then Commitments.";
  const lines = ["Your EMI plans:"];
  for (const p of running) {
    const next = p.nextDate && p.nextAmountPaise !== null ? `, next ${rupees(p.nextAmountPaise)} on ${shortDate(p.nextDate)}` : "";
    lines.push(`${p.title} (${p.cardName}): ${p.billedCount} of ${p.months} billed, ${rupees(p.toComePaise)} still to come${next}`);
  }
  const total = running.reduce((sum, p) => sum + p.toComePaise, 0);
  lines.push("", `In total ${rupees(total)} is still to be billed. It counts in your net worth, but not yet in what you can spend.`);
  return lines.join("\n");
}

export interface RecurringLine {
  title: string;
  type: "expense" | "income" | "investment";
  amountPaise: number;
  accountName: string;
  repeat: string;
  nextDate: string | null;
  mode: "auto" | "draft";
  status: "active" | "paused" | "ended";
}

/** What repeats, soonest first. Paused and ended ones are left out. */
export function recurringReply(items: RecurringLine[]): string {
  const running = items.filter((r) => r.status === "active" && r.nextDate);
  if (running.length === 0) return "Nothing is set to repeat. You can add rent, subscriptions or salary in the app, under Plan, then Recurring.";
  const lines = ["What repeats:"];
  for (const r of running) {
    const verb = r.type === "income" ? "in" : "from";
    lines.push(`${r.title}: ${rupees(r.amountPaise)} ${verb} ${r.accountName}, ${r.repeat.charAt(0).toLowerCase()}${r.repeat.slice(1)}, next ${shortDate(r.nextDate as string)}${r.mode === "draft" ? " (I will ask you to confirm it)" : ""}`);
  }
  return lines.join("\n");
}

export interface OwedPerson {
  name: string;
  trusted: boolean;
  owedToYouPaise: number;
  youOwePaise: number;
}

/** Who owes you and whom you owe. */
export function owedReply(people: OwedPerson[], owedToYouPaise: number, youOwePaise: number): string {
  const owing = people.filter((p) => p.owedToYouPaise > 0);
  const owed = people.filter((p) => p.youOwePaise > 0);
  if (owing.length === 0 && owed.length === 0) return "Nobody owes you anything, and you owe nobody. To note a loan: /lent 5000 hdfc rahul, or /borrowed 5000 hdfc asha.";
  const lines: string[] = [];
  if (owing.length > 0) {
    lines.push(`Owed to you: ${rupees(owedToYouPaise)}`);
    for (const p of owing) lines.push(`${p.name}: ${rupees(p.owedToYouPaise)}${p.trusted ? " (trusted, so I will not follow up)" : ""}`);
  }
  if (owed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`You owe: ${rupees(youOwePaise)}`);
    for (const p of owed) lines.push(`${p.name}: ${rupees(p.youOwePaise)}`);
  }
  return lines.join("\n");
}

export interface GoalLine {
  name: string;
  savedPaise: number;
  targetPaise: number;
  progressPct: number;
  monthlyNeededPaise: number | null;
  targetDate: string | null;
}

/** The active goals, how far along each is, and what they hold back from safe-to-spend. */
export function goalsReply(goals: GoalLine[], setAsidePaise: number): string {
  if (goals.length === 0) return "You have no savings goals yet. Add one in the app, under Plan, then Goals. Then /save 5000 laptop puts money toward it.";
  const lines = goals.map((g) => {
    const pace = g.monthlyNeededPaise !== null && g.targetDate ? `, ${rupees(g.monthlyNeededPaise)} a month to reach it by ${shortDate(g.targetDate)}` : g.targetDate ? `, by ${shortDate(g.targetDate)}` : "";
    return `${g.name}: ${rupees(g.savedPaise)} of ${rupees(g.targetPaise)} (${g.progressPct}%)${pace}`;
  });
  return [...lines, "", `Put toward goals: ${rupees(setAsidePaise)}. It stays in your bank, but is not counted as spendable.`].join("\n");
}

export interface HoldingLine {
  name: string;
  valuePaise: number;
  investedPaise: number;
  gainPaise: number;
  gainPct: number | null;
  staleDays: number | null;
  /** Counted by quantity: what is held and the rate typed (quoted for `ratePer` units). */
  tracking?: "value" | "units";
  unitLabel?: string | null;
  unitOne?: string | null;
  unitsHeldE4?: number;
  ratePaise?: number | null;
  ratePer?: number;
  /** The broker account it is held in, when it has one. */
  accountName?: string | null;
}

const upDown = (paise: number) => (paise === 0 ? "no change" : `${paise > 0 ? "up" : "down"} ${rupees(Math.abs(paise))}`);
const qty = (e4: number) => String(Math.round(e4) / 10_000);
/** "15.2 g at ₹13,100 per 10 g" for a holding counted by quantity; empty otherwise. */
const heldAt = (h: HoldingLine) =>
  h.tracking === "units" && h.unitLabel
    ? `${qty(h.unitsHeldE4 ?? 0)} ${h.unitLabel}${h.ratePaise ? ` at ${rupees(h.ratePaise)} per ${h.ratePer && h.ratePer > 1 ? `${h.ratePer} ` : ""}${h.unitOne ?? h.unitLabel}` : ""}, `
    : "";
const age = (days: number | null) => (days === null ? "no value typed yet" : days === 0 ? "valued today" : `valued ${days} ${days === 1 ? "day" : "days"} ago`);

/** The holdings, what they are worth and how they have done. */
export function investReply(items: HoldingLine[]): string {
  if (items.length === 0) return "You have no investments recorded yet. Add one in the app, under Money, then Investments.";
  const value = items.reduce((s, h) => s + h.valuePaise, 0);
  const put = items.reduce((s, h) => s + h.investedPaise, 0);
  const gain = items.reduce((s, h) => s + h.gainPaise, 0);
  const line = (h: HoldingLine) => `${h.name}: ${heldAt(h)}${rupees(h.valuePaise)}, ${upDown(h.gainPaise)}${h.gainPct === null ? "" : ` (${h.gainPct}%)`}, ${age(h.staleDays)}`;
  // With broker accounts, the holdings are listed under the account they are in, the biggest account first.
  let lines: string[];
  if (items.some((h) => h.accountName)) {
    const groups = new Map<string, HoldingLine[]>();
    for (const h of items) groups.set(h.accountName ?? "Not in an account yet", [...(groups.get(h.accountName ?? "Not in an account yet") ?? []), h]);
    const sum = (xs: HoldingLine[]) => xs.reduce((s, h) => s + h.valuePaise, 0);
    lines = [...groups.entries()]
      .sort((a, b) => sum(b[1]) - sum(a[1]))
      .flatMap(([name, xs], i) => [...(i > 0 ? [""] : []), `${name}: ${rupees(sum(xs))}, ${xs.length} ${xs.length === 1 ? "holding" : "holdings"}`, ...xs.map(line)]);
  } else {
    lines = items.map(line);
  }
  return [`Your investments are worth ${rupees(value)}: ${rupees(put)} put in, ${upDown(gain)}.`, "", ...lines, "", "To update one: /value tata 15200. For gold, funds and shares counted by quantity, send the rate (gold: for 10 g), for example /value gold 13200."].join("\n");
}

/** The first-of-the-month nudge. */
export function valueNudge(items: HoldingLine[]): string {
  const lines = items.map((h) => `${h.name}: ${heldAt(h)}${rupees(h.valuePaise)}, ${age(h.staleDays)}`);
  return ["A new month. Would you care to refresh what your investments are worth?", "", ...lines, "", "Send /value with the name and amount, for example /value tata 15200. For gold or a fund, send today's rate instead, for example /value gold 13200 (gold: for 10 g)."].join("\n");
}

export interface LoanLine {
  name: string;
  outstandingPaise: number;
  emiPaise: number;
  dueDay: number;
  nextDueDate: string | null;
  monthsLeft: number;
}

/** What is owed on bank loans, and what comes next. */
export function loansReply(items: LoanLine[]): string {
  if (items.length === 0) return "You have no bank loans recorded. Add one in the app, under Money, then Commitments.";
  const total = items.reduce((s, l) => s + l.outstandingPaise, 0);
  const emi = items.reduce((s, l) => s + l.emiPaise, 0);
  const lines = items.map((l) => `${l.name}: ${rupees(l.outstandingPaise)} owed, EMI ${rupees(l.emiPaise)}${l.nextDueDate ? `, next on ${shortDate(l.nextDueDate)}` : ""}, about ${l.monthsLeft} ${l.monthsLeft === 1 ? "month" : "months"} left`);
  return [`You owe ${rupees(total)} on bank loans, with ${rupees(emi)} going out each month.`, "", ...lines].join("\n");
}

/** What is still to leave before the next salary, and what that leaves free to spend. */
export interface CommitmentsText {
  until: string;
  basis: "salary" | "month";
  items: { date: string; title: string; amountPaise: number; accountName: string | null }[];
  safeToSpendPaise: number;
  freeToSpendPaise: number;
  commitmentsPaise: number;
}

export function commitmentsLines(c: CommitmentsText): string[] {
  const lines = [`Still to leave before ${shortDate(c.until)}${c.basis === "salary" ? " (your next salary)" : ""}:`];
  for (const i of c.items) lines.push(`${shortDate(i.date)}: ${i.title} ${rupees(i.amountPaise)}${i.accountName ? ` (${i.accountName})` : ""}`);
  lines.push("", `Free to spend until then: ${rupees(c.freeToSpendPaise)}, which is ${rupees(c.safeToSpendPaise)} safe to spend less ${rupees(c.commitmentsPaise)} of what is coming.`);
  return lines;
}

/** A usual spend as a button: "Rapido ₹50". */
export const usualLabel = (name: string, amountPaise: number): string => `${name.length > 22 ? `${name.slice(0, 21)}…` : name} ${rupees(amountPaise)}`;

export interface SalaryPlanText {
  /** The salary entry this plan is for; null when asked for with no salary on record. */
  salary: { amountPaise: number; date: string } | null;
  commitments: CommitmentsText;
  perDay: { paise: number; days: number } | null;
  goals: { name: string; paise: number }[];
}

/** The salary day plan: what has come in, what is still to leave before the next salary, and what is left to spend. */
export function salaryPlanLines(p: SalaryPlanText): string[] {
  const c = p.commitments;
  const lines: string[] = [];
  lines.push(p.salary ? `Salary of ${rupees(p.salary.amountPaise)} came in on ${shortDate(p.salary.date)}.` : "I have no salary entry yet. Log your pay as income in the Salary category and I shall plan from it. Here is where things stand.");
  lines.push("");
  if (c.items.length > 0) lines.push(...commitmentsLines(c));
  else lines.push(`Nothing is due before ${shortDate(c.until)}.`, "", `Free to spend until then: ${rupees(c.freeToSpendPaise)}.`);
  if (p.perDay) lines.push(`That is about ${rupees(p.perDay.paise)} a day for ${p.perDay.days} days.`);
  if (p.goals.length > 0) lines.push("", `Goals that want money this month: ${p.goals.map((g) => `${g.name} ${rupees(g.paise)}`).join(", ")}.`);
  if (c.basis === "month") lines.push("", "I do not know your salary day, so I have planned to your month start. Add your pay as repeating income, under Plan, then Recurring, and I shall plan up to it.");
  return lines;
}

/** The morning briefing sent to Telegram: the greeting, what is available, and only the things that need attention. */
export function morningPushLines(greeting: string, safeLine: string | null, attention: string[]): string[] {
  return [greeting, ...(safeLine ? ["", safeLine] : []), "", ...attention.map((a) => `• ${a}`)];
}

const monthYear = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const monthsText = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

export interface WhatIfSide {
  months: number;
  emiPaise: number;
  lastDate: string | null;
}

export interface WhatIfText {
  loanName: string;
  amountPaise: number;
  before: WhatIfSide;
  shorten: { after: WhatIfSide; monthsSaved: number; interestSavedPaise: number };
  lower: { after: WhatIfSide; interestSavedPaise: number };
  invest: { returnPct: number; months: number; gainPaise: number } | null;
}

/** What part-paying a loan would do, both ways, and optionally the same money invested instead. */
export function whatIfLines(w: WhatIfText): string[] {
  const lines = [`${w.loanName}: part-paying ${rupees(w.amountPaise)} now.`];
  if (w.shorten.after.months === 0) {
    lines.push(`That clears the loan, and saves ${rupees(w.shorten.interestSavedPaise)} of interest.`);
  } else {
    lines.push(
      `Keeping the EMI at ${rupees(w.before.emiPaise)}: it ends ${monthsText(w.shorten.monthsSaved)} sooner, around ${w.shorten.after.lastDate ? monthYear(w.shorten.after.lastDate) : "then"} instead of ${w.before.lastDate ? monthYear(w.before.lastDate) : "later"}, and saves ${rupees(w.shorten.interestSavedPaise)} of interest.`,
    );
    lines.push(`Lowering the EMI: it falls from ${rupees(w.before.emiPaise)} to ${rupees(w.lower.after.emiPaise)} a month, ending as planned, and saves ${rupees(w.lower.interestSavedPaise)} of interest.`);
  }
  if (w.invest) lines.push("", `For comparison, ${rupees(w.amountPaise)} invested at ${w.invest.returnPct}% a year might grow by about ${rupees(w.invest.gainPaise)} over the ${monthsText(w.invest.months)} the loan has left, before tax and with no guarantee. The interest saved by prepaying is certain.`);
  return lines;
}

/** How long the bank money would last at essential spending, for /balance. Empty when there is nothing to say yet. */
export function runwayLine(r: { burnPaise: number | null; months: number | null; solid: boolean; basedOnDays: number }): string | null {
  if (r.burnPaise === null || r.months === null) return null;
  return `Runway: at ${rupees(r.burnPaise)} a month of essential spending, your bank money would last about ${r.months} months${r.solid ? "" : ` (an early estimate, from ${r.basedOnDays} days of entries)`}.`;
}

/** A renewal reminder for a policy that falls due soon. */
export function renewalReminder(p: { insurer: string; kind: "health" | "term" | "other"; premiumPaise: number; dueDate: string; days: number }): string {
  const what = p.kind === "health" ? "health" : p.kind === "term" ? "term life" : "insurance";
  const when = p.days === 0 ? "today" : p.days === 1 ? "tomorrow" : `in ${p.days} days (${shortDate(p.dueDate)})`;
  const premium = p.premiumPaise > 0 ? ` The premium is ${rupees(p.premiumPaise)}.` : "";
  return `Your ${what} policy with ${p.insurer} is due ${when}.${premium} Paying on time keeps the cover from lapsing.`;
}

export interface FoundationText {
  title: string;
  pct: number | null;
  status: "ok" | "building" | "attention";
  detail: string;
}

export interface FlowsText {
  investingPaise: number;
  premiumsPaise: number;
  leftOverPaise: number | null;
}

/** The foundations: each with how far along it is, the one that needs attention and why, and what runs alongside. */
export function foundationLines(rows: readonly FoundationText[], flows?: FlowsText): string[] {
  const lines = ["Where you stand on the foundations (common ideals, not advice):"];
  for (const r of rows) {
    const label = r.pct !== null ? `${r.pct}%` : r.status === "ok" ? "in place" : "to look at";
    lines.push(`${r.title}: ${label}${r.status === "attention" ? " (needs attention)" : ""}`);
  }
  const focus = rows.find((r) => r.status === "attention");
  lines.push("", focus ? `Focus: ${focus.title}. ${focus.detail}` : "Nothing needs attention right now.");
  if (flows) {
    const parts = [flows.investingPaise > 0 ? `${rupees(flows.investingPaise)} going into investments` : "", flows.premiumsPaise > 0 ? `${rupees(flows.premiumsPaise)} on insurance premiums` : "", flows.leftOverPaise !== null && flows.leftOverPaise > 0 ? `about ${rupees(flows.leftOverPaise)} left over to build the emergency fund` : ""].filter(Boolean);
    if (parts.length > 0) lines.push(`Running alongside, a month: ${parts.join("; ")}.`);
  }
  return lines;
}

export interface TransferText {
  none: "no_target" | "fund_complete" | "no_destination" | "no_source" | "no_history" | "nothing_movable" | null;
  amountPaise: number;
  movablePaise: number;
  cushionPaise: number;
  remainingPaise: number | null;
  freeToSpendPaise: number;
  until: string;
  daysLeft: number;
  gapPaise: number | null;
  from: { name: string } | null;
  to: { name: string; countsTowardSafeToSpend: boolean } | null;
}

/** What could move into the emergency fund today, and why that much. */
export function transferLines(t: TransferText): string[] {
  switch (t.none) {
    case "no_target":
      return ["I cannot size your emergency fund yet. Once there are about two weeks of entries, or you type a target, I can say how much to move."];
    case "fund_complete":
      return ["Your emergency fund is full. Nothing to move."];
    case "no_destination":
      return ["Mark a bank account as your emergency fund in the app, on the account, and I can suggest what to move into it."];
    case "no_source":
      return ["I do not see a bank account to move money from."];
    case "no_history":
      return ["With so little history I cannot tell how much you spend each day, so I cannot say what is safe to move yet."];
    case "nothing_movable":
      return [`Nothing is safe to move today. Free to spend until ${shortDate(t.until)} is ${rupees(t.freeToSpendPaise)}, and about ${rupees(t.cushionPaise)} of it is kept for everyday spending. Try again after your next salary.`];
    default: {
      const lines = [
        `You could move ${rupees(t.amountPaise)} from ${t.from?.name ?? "your bank"} to ${t.to?.name ?? "your emergency account"} today.`,
        `Free to spend until ${shortDate(t.until)} is ${rupees(t.freeToSpendPaise)}. I keep ${rupees(t.cushionPaise)} back for about ${t.daysLeft} ${t.daysLeft === 1 ? "day" : "days"} of everyday spending, so ${rupees(t.movablePaise)} is safe to move.`,
        t.remainingPaise ? `That closes ${rupees(t.amountPaise)} of the ${rupees(t.gapPaise ?? 0)} still missing. The other ${rupees(t.remainingPaise)} is possible after your next salary.` : "That completes your emergency fund.",
        "Move it at your bank first, then tap Record.",
      ];
      if (t.to?.countsTowardSafeToSpend) lines.push(`Tip: ${t.to.name} still counts toward safe-to-spend. Switch that off in the app so this money stays put.`);
      return lines;
    }
  }
}

export interface EmergencyText {
  months: number;
  fundedPaise: number;
  nothingFlagged: boolean;
  liquidMonths: number | null;
  early: boolean;
  basedOnDays: number;
  monthsOnEssentials: number | null;
  verdict: "none" | "building" | "essentials" | "complete";
  targets: {
    lifestyle: { totalPaise: number | null; gapPaise: number | null; pct: number | null; monthsAtTypical: number | null; monthsAtCautious: number | null };
    essentials: { totalPaise: number | null; pct: number | null };
  };
  pace: { typicalPaise: number } | null;
  monthsIfSpendingLess: number | null;
  topUpPaise: number | null;
  horizonMonths: number;
}

/** Where the emergency fund stands against both ways of judging it, for /balance and the monthly review. Empty when there is nothing useful to say yet. */
export function emergencyLine(e: EmergencyText): string | null {
  const early = e.early ? ` (an early estimate, from ${e.basedOnDays} days of entries)` : "";
  if (e.nothingFlagged) {
    if (e.liquidMonths === null) return null;
    return `Emergency fund: nothing is marked as one yet. Your bank money alone would cover about ${e.liquidMonths} months of your spending${early}; a common aim is ${e.months}. You can mark accounts or holdings in the app.`;
  }
  const life = e.targets.lifestyle;
  const ess = e.targets.essentials;
  if (life.totalPaise === null || life.pct === null) return `Emergency fund: ${rupees(e.fundedPaise)} set apart. Once there are about two weeks of entries I can size a target.`;
  const essentialsPart = ess.totalPaise !== null && ess.pct !== null ? ` and ${ess.pct}% of essentials only (${rupees(ess.totalPaise)})` : "";
  const parts = [`Emergency fund: ${rupees(e.fundedPaise)}, which is ${life.pct}% of your lifestyle goal (${rupees(life.totalPaise)})${essentialsPart}${early}.`];

  if (e.verdict === "essentials" && life.gapPaise) parts.push(`You could live on essentials alone for about ${e.monthsOnEssentials} months today. ${rupees(life.gapPaise)} more covers your full lifestyle.`);
  else if (e.verdict === "complete") parts.push("Both are covered: your full lifestyle and essentials.");
  else if (e.monthsOnEssentials !== null) parts.push(`That covers about ${e.monthsOnEssentials} months of essentials alone.`);

  if (life.gapPaise) {
    if (e.pace === null) parts.push(`Still to build: ${rupees(life.gapPaise)}; about ${rupees(e.topUpPaise ?? 0)} a month would close it in ${e.horizonMonths} months.`);
    else if (e.pace.typicalPaise <= 0) parts.push(`Recent months leave nothing over after spending and investing, so I cannot give a time.${e.monthsIfSpendingLess ? ` Spending 10% less would take about ${e.monthsIfSpendingLess} months.` : ""}`);
    else {
      const lean = life.monthsAtCautious && life.monthsAtCautious !== life.monthsAtTypical ? `, ${life.monthsAtCautious} if a month is lean` : "";
      parts.push(`At your usual surplus of ${rupees(e.pace.typicalPaise)} a month, after what you already invest, about ${life.monthsAtTypical} months to the full goal${lean}.`);
    }
  }
  return parts.join(" ");
}

export interface FireText {
  numberPaise: number | null;
  progressPct: number | null;
  corpusPaise: number;
  projection: { months: number | null; year: number | null; age: number | null; reached: boolean } | null;
}

/** Where financial independence stands, for the monthly review. Empty without a spending figure to measure against. */
export function fireLine(f: FireText): string | null {
  if (f.numberPaise === null) return null;
  const head = `Financial independence: ${rupees(f.corpusPaise)} of ${rupees(f.numberPaise)} (${f.progressPct ?? 0}%).`;
  const p = f.projection;
  if (!p) return head;
  if (p.reached) return `${head} The number is reached on today's assumptions.`;
  if (p.months === null || p.year === null) return `${head} At the current saving it is not reached within 60 years; the Freedom page shows what would change that.`;
  return `${head} At the current saving and assumptions, around ${p.year}${p.age === null ? "" : `, at about ${p.age}`}. An estimate, not a promise.`;
}

export interface ReviewText {
  from: string;
  to: string;
  incomePaise: number;
  spentPaise: number;
  savingsPaise: number;
  savingsRatePct: number | null;
  needsPaise: number;
  wantsPaise: number;
  needsPct: number | null;
  wantsPct: number | null;
  emiPaise: number;
  emiBurdenPct: number | null;
  investedPaise: number;
  principalRepaidPaise: number;
  /** Refunds and money other people paid back, already taken off spending. */
  reimbursedPaise?: number;
  utilizationPct: number | null;
  runway: { months: number | null; burnPaise: number | null; solid: boolean; basedOnDays: number };
  netWorth: { endPaise: number; changePaise: number } | null;
  emergency?: EmergencyText;
  fire?: FireText;
  focus?: { title: string; detail: string } | null;
}

/** The monthly review: what came in, what went out, what was saved, and a few ratios with their usual reference lines. */
export function monthlyReviewLines(v: ReviewText): string[] {
  const lines = [`Your month, ${shortDate(v.from)} to ${shortDate(v.to)}.`, ""];
  lines.push(`Income ${rupees(v.incomePaise)}. Spent ${rupees(v.spentPaise)}.`);
  if (v.savingsPaise >= 0) lines.push(`Saved ${rupees(v.savingsPaise)}${v.savingsRatePct === null ? "" : `, which is ${v.savingsRatePct}% of income (a common aim is 20% or more)`}.`);
  else lines.push(`More went out than came in, by ${rupees(-v.savingsPaise)}.`);
  if (v.needsPct !== null && v.wantsPct !== null) lines.push(`Needs ${rupees(v.needsPaise)} (${v.needsPct}%), wants ${rupees(v.wantsPaise)} (${v.wantsPct}%). A common rule of thumb is 50% needs, 30% wants, 20% saved.`);
  if (v.reimbursedPaise && v.reimbursedPaise > 0) lines.push(`${rupees(v.reimbursedPaise)} of refunds and money other people paid back is taken off spending, and is not counted as income.`);
  if (v.investedPaise > 0 || v.principalRepaidPaise > 0) {
    const parts = [v.investedPaise > 0 ? `${rupees(v.investedPaise)} went into investments` : "", v.principalRepaidPaise > 0 ? `${rupees(v.principalRepaidPaise)} repaid loan principal` : ""].filter(Boolean);
    lines.push(`${parts.join(" and ")}.`);
  }
  if (v.emiBurdenPct !== null && v.emiPaise > 0) lines.push(`EMIs took ${v.emiBurdenPct}% of income (about 40% is the usual ceiling).`);
  if (v.utilizationPct !== null) lines.push(`Your cards owe ${v.utilizationPct}% of their limits (under 30% is the usual aim).`);
  if (v.runway.months !== null && v.runway.burnPaise !== null) lines.push(`Your bank money would last about ${v.runway.months} months at ${rupees(v.runway.burnPaise)} a month of essential spending${v.runway.solid ? "" : ` (an early estimate, from ${v.runway.basedOnDays} days of entries)`}.`);
  const fund = v.emergency ? emergencyLine(v.emergency) : null;
  if (fund) lines.push(fund);
  if (v.focus) lines.push(`Focus: ${v.focus.title}. ${v.focus.detail}`);
  const independence = v.fire ? fireLine(v.fire) : null;
  if (independence) lines.push(independence);
  if (v.netWorth) lines.push(`Net worth ${rupees(v.netWorth.endPaise)}, ${v.netWorth.changePaise >= 0 ? "up" : "down"} ${rupees(Math.abs(v.netWorth.changePaise))} over the month.`);
  return lines;
}

export interface SwipeLine {
  name: string;
  days: number;
  statementDate: string;
  dueDate: string;
  fits: boolean;
  availableCreditPaise: number;
  waitDate: string | null;
  waitDays: number | null;
}

/** Which card gives the longest time before the bill, for an amount. */
export function swipeReply(amountPaise: number, cards: SwipeLine[]): string {
  const lines = [`For ${rupees(amountPaise)}, the longest time before the bill first:`];
  for (const c of cards) {
    const credit = c.fits ? "" : `, but only ${rupees(Math.max(0, c.availableCreditPaise))} of credit is left`;
    lines.push(`${c.name}: ${c.days} days (statement ${shortDate(c.statementDate)}, bill due ${shortDate(c.dueDate)})${credit}`);
  }
  const best = cards.find((c) => c.fits);
  if (best?.waitDate && best.waitDays !== null) lines.push("", `If it can wait until ${shortDate(best.waitDate)}, the day after its statement, ${best.name} would give ${best.waitDays} days instead of ${best.days}.`);
  return lines.join("\n");
}

export const botVoice = {
  transferRecorded: (amount: string, from: string, to: string) => `Recorded: ${amount} moved from ${from} to ${to}.`,
  transferLeft: "All right. Nothing recorded. Ask again any time with /fund.",
  reviewNothing: "There is nothing to review yet: no income or spending in your last full month.",
  whatIfNeedsAmount: "Tell me the amount, for example /whatif 25000 home.",
  whatIfNoLoans: "You have no bank loans recorded.",
  whatIfWhich: (amount: string) => `Which loan would the ${amount} go toward? Name it, for example /whatif ${amount} home.`,
  whatIfNoMatch: "I cannot tell which loan you mean. Use part of its name.",
  salaryNone: "I have no salary entry on record, so there is nothing to plan from. Log your pay as income in the Salary category.",
  swipeNeedsAmount: "Tell me the amount, for example /swipe 20000.",
  swipeNoCards: "You have no credit cards on record.",
  statementAsk: (name: string, statementDate: string, expectedPaise: number) =>
    `${name}: your statement of ${shortDate(statementDate)} should be out. I make the total ${rupees(expectedPaise)}. What does it say?`,
  statementMatches: "Splendid. That matches the statement.",
  statementAskAmount: (name: string) => `What is the total amount due on the ${name} statement? Send the amount, such as 20988.76.`,
  statementGap: (name: string, expectedPaise: number, billedPaise: number, reason: string) => `${name}: I made the statement ${rupees(expectedPaise)} and it says ${rupees(billedPaise)}. ${reason}`,
  statementBooked: (kind: "fee" | "spending" | "credit", paise: number, name: string) =>
    `Booked ${rupees(paise)} as ${kind === "fee" ? "a fee" : kind === "spending" ? "unlogged spending" : "a credit"} on ${name}, dated its statement. We agree now.`,
  statementLeft: "Very well. I have left it as it is.",
  statementGone: "That statement has been superseded or the question has expired. Use Check statement in the app if you still want to compare it.",
  eveningNone: "Good evening. Nothing has been logged today. Anything to add?",
  eveningSilent: (days: number, lastDate: string) => `Good evening. ${days} days have passed since your last entry, on ${shortDate(lastDate)}. A moment now keeps the books honest. What went out today?`,
  noneToday: "Understood. A quiet day, noted. I shall not ask again tonight.",
  logPaused: (until: string) => `Very well. I shall keep quiet until ${shortDate(until)}.`,
  balanceAsk: (name: string, paise: number) => `Weekly check. I have ${name} at ${rupees(paise)}. Does your bank say the same?`,
  balanceMatches: "Splendid. That matches your bank.",
  balanceAskAmount: (name: string) => `What does your bank show for ${name}? Send the balance, such as 100284.52.`,
  balanceLower: (name: string, alfredPaise: number, typedPaise: number, diffPaise: number) =>
    `${name}: I have ${rupees(alfredPaise)} and your bank shows ${rupees(typedPaise)}. That is ${rupees(diffPaise)} less than I know of, so some spending was not logged.`,
  balanceHigher: (name: string, alfredPaise: number, typedPaise: number, diffPaise: number) =>
    `${name}: I have ${rupees(alfredPaise)} and your bank shows ${rupees(typedPaise)}. That is ${rupees(diffPaise)} more than I know of, so some money was not recorded.`,
  balanceBooked: (kind: "spending" | "income", paise: number, name: string, balancePaise: number) =>
    `Booked ${rupees(paise)} as ${kind === "spending" ? "unlogged spending" : "unrecorded income"}. ${name} now stands at ${rupees(balancePaise)}, as your bank says.`,
  balanceLeft: "Very well. I have left it as it is.",
  balanceGone: "That check has expired. Ask me again next Sunday, or use Check balance in the app.",
  mandateShort: (title: string, amountPaise: number, accountName: string, whenText: string, balancePaise: number, shortByPaise: number) =>
    `${title}: ${rupees(amountPaise)} is due to leave ${accountName} ${whenText}, and it holds ${rupees(Math.max(0, balancePaise))}. It is ${rupees(shortByPaise)} short. A transfer in beforehand would spare you a failed debit.`,
  loanCheck: (name: string, totalPaise: number, interestPaise: number, principalPaise: number, accountName: string) =>
    `${name}: ${rupees(totalPaise)} was taken from ${accountName} (interest ${rupees(interestPaise)}, principal ${rupees(principalPaise)}). Does that agree with your bank?`,
  loanAgrees: "Splendid. That matches your bank.",
  unitsAsk: (holding: string, amountPaise: number, word: string) => `${rupees(amountPaise)} went into ${holding}. How many ${word} did that buy?`,
  unitsAskNumber: (word: string) => `Send how many ${word}, such as ${word === "grams" ? "0.5" : "10"}.`,
  unitsSet: (holding: string, quantity: string, heldText: string) => `Noted: ${quantity} added to ${holding}. You now hold ${heldText}.`,
  unitsGone: "I cannot find that entry any more, so there is nothing to add the quantity to.",
  loanAskAmount: (name: string, on: string) => `What did the bank take for ${name} on ${shortDate(on)}? Send the full amount, such as 32500.`,
  loanFixed: (name: string, totalPaise: number, owedPaise: number) => `Corrected. ${name} took ${rupees(totalPaise)} that month, and ${rupees(owedPaise)} is still owed.`,
  loanGone: "I cannot find that instalment any more, so there is nothing to correct.",
  valueNeedsAmount: "How much is it worth now? For example: /value tata 15200.",
  valueNoHoldings: "You have no investments recorded yet. Add one in the app, under Money, then Investments.",
  valueNoMatch: "I could not find that investment. /invest lists them.",
  valueAskWhich: (paise: number) => `Which investment is worth ${rupees(paise)}?`,
  valueSet: (name: string, valuePaise: number, gainPaise: number) => `Noted. ${name} is worth ${rupees(valuePaise)}, ${upDown(gainPaise)} on what you put in.`,
  valueClosed: "That investment is closed, so I have left it alone.",
  emiCheck: (title: string, n: number, months: number, amountPaise: number, cardName: string) =>
    `${title}, instalment ${n} of ${months}: ${rupees(amountPaise)} has been added to ${cardName}. Does your statement agree?`,
  emiAgrees: "Splendid. It matches your statement.",
  emiAskAmount: (title: string, n: number) => `What does the statement show for ${title}, instalment ${n}? Just send the amount, such as 20100.`,
  emiFixed: (title: string, n: number, amountPaise: number, toComePaise: number) =>
    `Corrected. ${title}, instalment ${n}, is now ${rupees(amountPaise)}.${toComePaise > 0 ? ` ${rupees(toComePaise)} is still to come.` : ""}`,
  emiGone: "I cannot find that instalment any more, so there is nothing to correct.",
  emiClosed: "That plan is closed, so I cannot change it. Reopen it in the app first.",
  menu: "What would you like to see? Or write to me plainly, such as \"450 food swiggy\". /help lists everything.",
  goalNeedsAmount: "How much? For example: /save 5000 laptop.",
  goalNoGoals: "You have no savings goals yet. Add one in the app, under Plan, then Goals.",
  goalNoMatch: "I could not find that goal. /goals lists them.",
  goalAskWhich: (paise: number) => `Which goal is the ${rupees(paise)} for?`,
  goalSaved: (name: string, amountPaise: number, savedPaise: number, targetPaise: number) =>
    `Noted. ${rupees(amountPaise)} put toward ${name}: ${rupees(savedPaise)} of ${rupees(targetPaise)}. It stays in your bank, but I take it off what you can spend.${savedPaise >= targetPaise ? " That reaches the goal. Mark it achieved in the app once you have spent it." : ""}`,
  goalUndone: "Removed. That money is no longer put toward the goal.",
  goalClosed: "That goal is already closed.",
  welcome(name: string, now: Date): string {
    return [
      `${greeting(name, now)} Alfred here.`,
      "",
      "I will help keep your finances organised, track your spending, monitor upcoming payments, and make sure nothing important slips through the cracks.",
      "",
      "You can write to me plainly: \"450 food swiggy\" will do. Or use /help to see what I can do.",
      "",
      "I will take care of the details.",
    ].join("\n");
  },

  alreadyLinked(name: string, now: Date): string {
    return `${greeting(name, now)} At your service. /help lists what I can do.`;
  },

  linkFailed: "That code did not work. It may have expired. You can ask for a fresh one in the app, under You, then Settings.",

  help: [
    "Here is what I can do.",
    "",
    "Log something, in plain words or with a command:",
    "/add 450 food swiggy",
    "/income 90000 salary hdfc",
    "/pay 4500 millennia from hdfc",
    "/transfer 5000 hdfc sbi",
    "",
    "Ask me:",
    "/today  what you spent today",
    "/budget  how your budgets stand this month",
    "/accounts  your accounts and cards; archive or restore one",
    "/owed  who owes you and whom you owe",
    "/lent  note money you lent: /lent 5000 hdfc rahul (or: cash)",
    "/borrowed  note money you borrowed: /borrowed 5000 hdfc asha",
    "/recurring  what repeats: rent, subscriptions, salary",
    "/goals  your savings goals; put money toward one: /save 5000 laptop",
    "/invest  your investments; update one: /value tata 15200",
    "/loans  what you owe on bank loans, and the next EMI",
    "/salary  your salary day plan: what is still to leave and what is free",
    "/review  your last month: what came in, what went out, and what was saved",
    "/fund  your next step, and how much could safely move into your emergency fund",
    "/whatif  what part-paying a loan would do: /whatif 25000 home (add 12% to compare investing)",
    "/swipe  which card to use today for a purchase: /swipe 20000",
    "/menu  buttons for the main things I can show you",
    "/emi  your card EMI plans and what is still to be billed",
    "/ipo  money blocked for IPO applications, or: /ipo 15000 hdfc tata tech",
    "/category  list your categories, or add one",
    "/balance  your accounts, cards and safe-to-spend",
    "/due  card payments coming up",
    "/summary  your month so far (or: week, lastmonth, year)",
    "/undo  remove the last entry I logged",
    "/settings  your current preferences",
    "",
    "Dates are optional: \"450 swiggy yesterday\" or \"450 swiggy 24 oct\". Amounts can be 2k or 1.5L.",
  ].join("\n"),

  unknownCommand: "I do not know that one. /help lists what I can do.",
  holdRecorded: (title: string, amountPaise: number, accountName: string, safePaise: number) =>
    `Noted. ${rupees(amountPaise)} is blocked in ${accountName} for ${title}. You can spend ${rupees(safePaise)}, as recorded. When you know the outcome, /ipo has the buttons.`,
  holdAllotted: (title: string, amountPaise: number, accountName: string) =>
    `${title} was allotted. ${rupees(amountPaise)} has been debited from ${accountName}, recorded as an investment rather than spending.`,
  holdReleased: (title: string, amountPaise: number, accountName: string) =>
    `${title} was not allotted. The ${rupees(amountPaise)} in ${accountName} is available again, and nothing was debited.`,
  holdRemoved: "Removed. That block is gone.",
  holdAlreadySettled: "That one has already been settled.",
  holdNeedsBank: "Money is blocked in a bank account. Please name one, for example: /ipo 15000 hdfc tata tech.",
  noHolds: "Nothing is blocked for applications at the moment. To add one: /ipo 15000 hdfc tata tech.",
  askHoldAccount: (summary: string) => `Which account is it blocked in? (${summary})`,
  holdDue: (title: string, amountPaise: number, accountName: string) =>
    `The outcome of ${title} is due. ${rupees(amountPaise)} is blocked in ${accountName}. Was it allotted?`,
  recurringDraft: (title: string, amountPaise: number, accountName: string) =>
    `${title} came due. I have added ${rupees(amountPaise)} on ${accountName} as a draft, since that amount can vary. Is it right? If not, correct it in the app.`,
  recurringReminder: (title: string, amountPaise: number, accountName: string, date: string, days: number) =>
    `A word ahead of time: ${title}, ${rupees(amountPaise)} on ${accountName}, comes up on ${shortDate(date)}, in ${days} ${days === 1 ? "day" : "days"}.`,
  recurringConfirmed: (title: string) => `Confirmed. ${title} now counts in your records.`,
  recurringDiscarded: (title: string) => `Removed. ${title} for that day is gone from your records.`,
  recurringSettled: "That one has already been settled.",
  debtNeedsName: "Whom was it with? For example: /lent 5000 hdfc rahul.",
  askDebtAccount: (summary: string) => `Which account did it go through? (${summary}) Or say it was cash.`,
  debtRecorded: (lent: boolean, name: string, amountPaise: number, accountName: string | null, trusted: boolean) =>
    `Noted. You ${lent ? "lent" : "borrowed"} ${rupees(amountPaise)} ${lent ? "to" : "from"} ${name}${accountName ? `, through ${accountName}` : ", in cash"}.` +
    (lent ? (trusted ? ` ${name} is trusted, so I will not follow up.` : ` I will follow up if it is not paid back; you can mark ${name} as trusted in the app to stop that.`) : ""),
  debtUndone: "Removed. That loan is gone from your records.",
  debtHasPayments: "That loan already has repayments, so please change it in the app.",
  debtSettled: "That one has already been settled.",
  followUp: (name: string, outstandingPaise: number, date: string, dueDate: string | null) =>
    `${name} still owes you ${rupees(outstandingPaise)}, lent on ${shortDate(date)}${dueDate ? `, due ${shortDate(dueDate)}` : ""}. Has it been paid?`,
  askPaidAccount: (name: string, outstandingPaise: number) => `${name}'s ${rupees(outstandingPaise)} was paid. Which account did it come into? Or say it was cash.`,
  paidInFull: (name: string, amountPaise: number, accountName: string | null) =>
    `Marked as paid: ${name}'s ${rupees(amountPaise)}${accountName ? ` has come into ${accountName}` : ", received in cash"}.`,
  followUpLater: "Very well. I will ask again in a couple of weeks.",
  followUpStopped: (name: string) => `Understood. I will not follow up about ${name}'s money again. You can change that in the app.`,
  repayTomorrow: (name: string, amountPaise: number, dueDate: string) => `A reminder: you owe ${name} ${rupees(amountPaise)}, due tomorrow, ${shortDate(dueDate)}.`,
  repayToday: (name: string, amountPaise: number, dueDate: string, late: boolean) =>
    late ? `You owe ${name} ${rupees(amountPaise)}, which was due on ${shortDate(dueDate)}.` : `You owe ${name} ${rupees(amountPaise)}, due today.`,
  accountArchived: (name: string) => `Archived ${name}. It is hidden from lists and new entries, and its history is kept. You can restore it below.`,
  accountRestored: (name: string) => `Restored ${name}. It is back in your lists.`,
  accountNotArchived: (name: string, reason: string) => `I could not archive ${name}. ${reason}`,
  categoryAdded: (name: string, kind: "expense" | "income") => `Added ${name} as ${kind === "expense" ? "an expense" : "an income"} category. You can use it straight away.`,
  categoryExists: (name: string) => `You already have a category called ${name}.`,
  categoryBadName: "A category name can be 1 to 40 characters. For example: /category add Pets",
  noAmount: "I could not find an amount in that. Something like \"450 food swiggy\" will do.",
  badDate: "That date does not look right. Try \"yesterday\", \"24 oct\" or \"24/10\".",
  failure: "That did not go through, and nothing was recorded. Shall we try again?",
  expired: "That one has timed out, so I have set it aside. Send it again whenever you are ready.",
  cancelled: "As you wish. Nothing was recorded.",
  nothingToUndo: "I have not logged anything for you that I can remove.",
  alreadyRemoved: "That one has already been removed.",
  noMatchingAccount: "I do not have an account that fits that. You can add one in the app.",
  noAccountsYet: "I have no accounts to work with yet. Please add one in the app first.",

  confirm(summary: string): string {
    return `${summary}. Shall I record it?`;
  },

  recorded(summary: string, extra?: string): string {
    return `Noted. ${summary}.${extra ? ` ${extra}` : ""}`;
  },

  uncategorized: "It has no category yet.",

  cardOwes(card: string, owedPaise: number): string {
    return owedPaise > 0 ? `${card} now owes ${rupees(owedPaise)}.` : `${card} is now settled.`;
  },

  askRemove(summary: string): string {
    return `Shall I remove ${summary}?`;
  },

  removed(summary: string): string {
    return `Removed. ${summary} is no longer in your record.`;
  },

  askCategory: "Which category shall I file it under?",

  filed(summary: string): string {
    return `Filed. ${summary}.`;
  },
};
