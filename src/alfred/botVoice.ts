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
  if (items.length === 0) return "You have not set any budgets yet. You can add them in the app, under Budgets.";
  const lines = [`Your budgets for ${shortDate(period.from)} to ${shortDate(period.to)}:`];
  for (const b of items) {
    const left =
      b.status === "over" ? `${rupees(-b.remainingPaise)} over` : b.status === "near" ? `${rupees(b.remainingPaise)} remaining, close to the limit` : `${rupees(b.remainingPaise)} remaining`;
    lines.push(`${b.categoryName}: ${rupees(b.spentPaise)} of ${rupees(b.limitPaise)} (${b.pct}%), ${left}`);
  }
  lines.push("", `In total: ${rupees(totalSpentPaise)} of ${rupees(totalLimitPaise)}.`);
  return lines.join("\n");
}

export const botVoice = {
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

  linkFailed: "That code did not work. It may have expired. You can ask for a fresh one in the app, under More.",

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
    "/balance  your accounts, cards and safe-to-spend",
    "/due  card payments coming up",
    "/summary  your month so far (or: week, lastmonth, year)",
    "/undo  remove the last entry I logged",
    "/settings  your current preferences",
    "",
    "Dates are optional: \"450 swiggy yesterday\" or \"450 swiggy 24 oct\". Amounts can be 2k or 1.5L.",
  ].join("\n"),

  unknownCommand: "I do not know that one. /help lists what I can do.",
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
