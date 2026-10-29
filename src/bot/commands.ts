/**
 * Alfred's public identity in Telegram. Pure data with no imports, so the setup script can load it directly with
 * Node and tests can check it against what the bot really handles.
 */

export const BOT_NAME = "Alfred";

/** Shown on the empty chat screen (Telegram allows 512 characters). */
export const BOT_DESCRIPTION =
  "Your personal assistant. I keep track of your finances, help you stay ahead of your commitments, and bring the important things to your attention.";

/** Shown on the bot's profile (Telegram allows 120 characters). */
export const BOT_SHORT_DESCRIPTION = "Your personal assistant. Finances first.";

export interface BotCommand {
  command: string;
  description: string;
}

export const BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "Welcome, and link this chat to the app" },
  { command: "help", description: "What Alfred can do" },
  { command: "add", description: "Log an expense, e.g. /add 450 food swiggy" },
  { command: "income", description: "Log income, e.g. /income 90000 salary hdfc" },
  { command: "pay", description: "Pay a card bill, e.g. /pay 4500 millennia from hdfc" },
  { command: "transfer", description: "Move money between your banks" },
  { command: "undo", description: "Remove the last entry Alfred logged" },
  { command: "today", description: "What you spent today" },
  { command: "balance", description: "Accounts, cards and safe-to-spend" },
  { command: "budget", description: "How your budgets stand this month" },
  { command: "category", description: "List categories, or add one: /category add Pets" },
  { command: "due", description: "Card payments coming up" },
  { command: "summary", description: "Your month so far" },
  { command: "settings", description: "Your current preferences" },
];
