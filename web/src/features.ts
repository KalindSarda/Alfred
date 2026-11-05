/**
 * Every place in Alfred a person might want to go, in one list. The Everything page shows it as tiles and the jump
 * search ranks it, so adding a feature here is all it takes to make it findable.
 */

export type FeatureGroup = "Today" | "Money" | "Plan" | "Tidy up" | "You";

export interface Feature {
  id: string;
  title: string;
  /** One line saying what it is for. */
  blurb: string;
  group: FeatureGroup;
  /** Where it lives, including a "#section" when it is a card on a page. */
  to: string;
  /** Other words people might type, such as "emi" for EMI plans. */
  keywords: string[];
  /** Only the owner sees it (inviting people). */
  ownerOnly?: boolean;
}

export const GROUPS: FeatureGroup[] = ["Today", "Money", "Plan", "Tidy up", "You"];

export const FEATURES: Feature[] = [
  { id: "home", title: "Home", blurb: "Your briefing, safe-to-spend and this month's cash flow", group: "Today", to: "/", keywords: ["cash flow", "dashboard", "briefing", "safe to spend", "overview", "summary"] },
  { id: "transactions", title: "Transactions", blurb: "Every entry, with search and filters", group: "Today", to: "/transactions", keywords: ["expenses", "income", "entries", "history", "spending", "search", "filter", "add"] },
  { id: "review", title: "Entries to review", blurb: "Entries waiting for a category", group: "Today", to: "/transactions?category=none", keywords: ["uncategorised", "uncategorized", "no category", "drafts", "confirm"] },

  { id: "accounts", title: "Accounts and cards", blurb: "Bank accounts, credit cards and net worth", group: "Money", to: "/accounts", keywords: ["bank", "balance", "credit card", "net worth", "add account", "archive", "merge"] },
  { id: "networth", title: "Net worth over time", blurb: "How your net worth has moved month by month", group: "Money", to: "/accounts#trend", keywords: ["trend", "chart", "growth", "history"] },
  { id: "blocked", title: "Blocked for IPOs", blurb: "Money held for applications until the result", group: "Money", to: "/accounts?view=commitments#blocked", keywords: ["ipo", "upi mandate", "blocked", "allotment", "allotted", "application", "hold"] },
  { id: "investments", title: "Investments", blurb: "Stocks, IPO holdings, gold and crypto, and what they are worth", group: "Money", to: "/accounts?view=investments", keywords: ["stock", "shares", "ipo", "gold", "crypto", "portfolio", "holding", "demat", "sip", "mutual fund", "value", "sell", "buy"] },
  { id: "emi", title: "EMI plans", blurb: "Card purchases paid in instalments", group: "Money", to: "/accounts?view=commitments#emi", keywords: ["emi", "instalment", "installment", "no cost", "card plan", "loan on card"] },
  { id: "lent", title: "Lent and borrowed", blurb: "Who owes you, whom you owe, and follow-ups", group: "Money", to: "/accounts?view=commitments#lent", keywords: ["lend", "lent", "borrow", "borrowed", "owe", "owed", "debt", "loan", "friend", "trusted", "repay", "udhaar"] },

  { id: "budgets", title: "Budgets", blurb: "Monthly limits for categories", group: "Plan", to: "/plan", keywords: ["budget", "limit", "overspend", "category limit"] },
  { id: "recurring", title: "Recurring entries", blurb: "Rent, subscriptions, salary and SIPs added on their day", group: "Plan", to: "/plan?view=recurring", keywords: ["repeat", "subscription", "rent", "salary", "sip", "monthly", "bills", "autopay"] },
  { id: "goals", title: "Savings goals", blurb: "Money set aside for something you are saving for", group: "Plan", to: "/plan?view=goals", keywords: ["goal", "saving", "savings", "target", "save", "set aside", "laptop", "trip"] },

  { id: "categories", title: "Categories", blurb: "Add, rename, merge or archive categories", group: "Tidy up", to: "/categories", keywords: ["category", "rename", "merge", "label", "tags"] },
  { id: "export", title: "Download your data", blurb: "Backup (JSON) and spreadsheet (CSV)", group: "Tidy up", to: "/settings#data", keywords: ["export", "backup", "csv", "json", "download", "spreadsheet", "excel"] },
  { id: "demo", title: "Demo data", blurb: "Try Alfred with sample accounts and entries", group: "Tidy up", to: "/settings#demo", keywords: ["sample", "test", "clear demo", "try"] },
  { id: "setup", title: "Setup guide", blurb: "Walk through name, accounts, cards and Telegram again", group: "Tidy up", to: "/setup", keywords: ["onboarding", "start", "guide", "run setup"] },

  { id: "telegram", title: "Telegram", blurb: "Connect the chat and see what Alfred can do there", group: "You", to: "/settings#telegram", keywords: ["bot", "chat", "link", "connect", "commands", "notifications"] },
  { id: "people", title: "People and invitations", blurb: "Invite someone, or remove access", group: "You", to: "/settings#people", keywords: ["invite", "invitation", "access", "family", "share", "users"], ownerOnly: true },
  { id: "profile", title: "Your name", blurb: "What Alfred calls you", group: "You", to: "/settings#profile", keywords: ["name", "profile", "email", "account"] },
  { id: "month", title: "Month start day", blurb: "Set your month to begin on payday", group: "You", to: "/settings#month", keywords: ["payday", "salary day", "cycle", "period"] },
  { id: "reminders", title: "Card reminders", blurb: "How many days before a due date Alfred reminds you", group: "You", to: "/settings#reminders", keywords: ["due date", "nudge", "notification", "lead days"] },
  { id: "settings", title: "All settings", blurb: "Everything about you and your account in one page", group: "You", to: "/settings", keywords: ["preferences", "options", "configure"] },
  { id: "signout", title: "Sign out", blurb: "Leave this device, or sign out everywhere", group: "You", to: "/settings#signout", keywords: ["logout", "log out", "sign off"] },
  { id: "delete", title: "Delete my account", blurb: "Permanently remove your records", group: "You", to: "/settings#delete", keywords: ["remove account", "erase", "close account", "leave"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** How well one feature fits what was typed: higher is better, 0 means it does not fit. */
function score(feature: Feature, query: string): number {
  const words = query.split(" ");
  const title = norm(feature.title);
  const keywords = feature.keywords.map(norm);
  const blurb = norm(feature.blurb);
  let total = 0;
  for (const word of words) {
    let best = 0;
    if (title === word) best = 100;
    else if (title.split(" ").includes(word)) best = 80;
    else if (title.startsWith(word)) best = 70;
    else if (title.split(" ").some((t) => t.startsWith(word))) best = 60;
    else if (keywords.some((k) => k === word || k.split(" ").includes(word))) best = 50;
    else if (keywords.some((k) => k.startsWith(word) || k.split(" ").some((t) => t.startsWith(word)))) best = 40;
    else if (word.length >= 3 && (title.includes(word) || keywords.some((k) => k.includes(word)))) best = 25;
    else if (word.length >= 3 && blurb.includes(word)) best = 10;
    if (best === 0) return 0; // every word typed has to fit something
    total += best;
  }
  return total;
}

/** The features that fit what was typed, best first. Nothing typed gives nothing; an owner-only feature is left out for others. */
export function searchFeatures(query: string, features: readonly Feature[] = FEATURES, isOwner = false): Feature[] {
  const q = norm(query);
  if (!q) return [];
  return features
    .filter((f) => !f.ownerOnly || isOwner)
    .map((f) => ({ f, s: score(f, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.title.localeCompare(b.f.title))
    .map((x) => x.f);
}

/** The features visible to this person, grouped in display order. */
export function groupedFeatures(features: readonly Feature[] = FEATURES, isOwner = false): { group: FeatureGroup; items: Feature[] }[] {
  return GROUPS.map((group) => ({ group, items: features.filter((f) => f.group === group && (!f.ownerOnly || isOwner)) })).filter((g) => g.items.length > 0);
}

export const RECENT_MAX = 5;

/** Puts a feature first in the recently used list, keeping a few. Pure so it can be tested; storage is the caller's. */
export function pushRecent(current: readonly string[], id: string): string[] {
  return [id, ...current.filter((x) => x !== id)].slice(0, RECENT_MAX);
}
