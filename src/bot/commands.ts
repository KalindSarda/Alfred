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
  { command: "menu", description: "Buttons for everything I can show you" },
  { command: "add", description: "Log an expense, e.g. /add 450 food swiggy" },
  { command: "income", description: "Log income, e.g. /income 90000 salary hdfc" },
  { command: "pay", description: "Pay a card bill, e.g. /pay 4500 millennia from hdfc" },
  { command: "transfer", description: "Move money between your banks" },
  { command: "undo", description: "Remove the last entry Alfred logged" },
  { command: "today", description: "What you spent today" },
  { command: "balance", description: "Accounts, cards and safe-to-spend" },
  { command: "budget", description: "How your budgets stand this month" },
  { command: "ipo", description: "Money blocked for IPO applications, or /ipo 15000 hdfc tata tech" },
  { command: "emi", description: "Your card EMI plans and what is still to be billed" },
  { command: "recurring", description: "What repeats: rent, subscriptions, salary" },
  { command: "owed", description: "Who owes you and whom you owe" },
  { command: "lent", description: "Note money you lent: /lent 5000 hdfc rahul" },
  { command: "borrowed", description: "Note money you borrowed: /borrowed 5000 hdfc asha" },
  { command: "goals", description: "Your savings goals, or /save 5000 laptop to put money toward one" },
  { command: "invest", description: "Your investments, or /value tata 15200 to update one" },
  { command: "loans", description: "What you owe on bank loans, and the next EMI" },
  { command: "accounts", description: "Your accounts and cards; archive or restore one" },
  { command: "category", description: "List categories, or add one: /category add Pets" },
  { command: "due", description: "Card payments coming up" },
  { command: "summary", description: "Your month so far" },
  { command: "settings", description: "Your current preferences" },
];
