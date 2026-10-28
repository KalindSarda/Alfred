import { addDays, type IstDate, isValidIstDate, parseIstDate } from "../domain/dates";
import { parsePaise } from "../domain/money";

/**
 * Turns what you type to Alfred ("450 swiggy using millennia yesterday") into a structured entry.
 * Pure and deterministic: no database, no AI. Anything it cannot pin down is reported as missing or ambiguous,
 * so the caller asks you with buttons instead of guessing.
 */

export type EntryType = "expense" | "income" | "bill_payment" | "transfer";

export interface BotAccount {
  id: string;
  name: string;
  kind: "bank" | "card";
}

export interface BotCategory {
  id: string;
  name: string;
  kind: "expense" | "income";
}

export interface MerchantMemory {
  categoryId: string | null;
  accountId: string;
}

export interface ParseContext {
  today: IstDate;
  accounts: readonly BotAccount[];
  categories: readonly BotCategory[];
  /** Lower-cased merchant -> what you used last time. */
  merchants: ReadonlyMap<string, MerchantMemory>;
}

export type Resolution = { status: "found"; id: string } | { status: "ambiguous"; ids: string[] } | { status: "missing" };

export interface ParsedEntry {
  type: EntryType;
  amountPaise: number;
  txnDate: IstDate;
  /** The account money leaves (or, for income, arrives in). */
  from: Resolution;
  /** Transfers and bill payments only. */
  to: Resolution;
  categoryId: string | null;
  merchant: string | null;
  /** What you used last time for this merchant, to offer first. */
  suggestedAccountId: string | null;
}

export type ParseFailure = "empty" | "no_amount" | "bad_date";
export type ParseResult = { ok: true; entry: ParsedEntry } | { ok: false; reason: ParseFailure };

// ---- vocabulary ----

const FILLER = new Set([
  "spent", "paid", "pay", "bought", "buy", "add", "log", "put", "for", "on", "at", "in", "the", "a", "an", "of", "my",
  "rs", "inr", "rupees", "rupee", "was", "is", "it", "and", "into", "towards", "got", "received", "credited", "earned", "income",
]);
const ACCOUNT_MARKERS = new Set(["from", "using", "via", "with", "by"]);
const TO_MARKERS = new Set(["to"]);
const STOP_ACCOUNT_TOKENS = new Set(["the", "of", "and", "a", "an", "acc", "account", "ac"]);
const INCOME_WORDS = /\b(received|credited|salary|income|earned|refund|refunded|cashback|bonus)\b/i;

/** Everyday words that name a default category. The word is kept as the merchant when nothing else is given. */
const CATEGORY_WORDS: Record<string, string> = {
  dinner: "Food & Dining", lunch: "Food & Dining", breakfast: "Food & Dining", snack: "Food & Dining", snacks: "Food & Dining",
  coffee: "Food & Dining", tea: "Food & Dining", restaurant: "Food & Dining", cafe: "Food & Dining", food: "Food & Dining",
  grocery: "Groceries", groceries: "Groceries", vegetables: "Groceries", fruits: "Groceries", milk: "Groceries",
  petrol: "Fuel", diesel: "Fuel", fuel: "Fuel",
  cab: "Transport", taxi: "Transport", auto: "Transport", metro: "Transport", bus: "Transport", train: "Transport", parking: "Transport", toll: "Transport",
  electricity: "Bills & Utilities", water: "Bills & Utilities", wifi: "Bills & Utilities", internet: "Bills & Utilities", broadband: "Bills & Utilities",
  recharge: "Bills & Utilities", gas: "Bills & Utilities", bill: "Bills & Utilities", bills: "Bills & Utilities",
  rent: "Rent", medicine: "Health", medicines: "Health", doctor: "Health", pharmacy: "Health", hospital: "Health",
  movie: "Entertainment", movies: "Entertainment", cinema: "Entertainment", concert: "Entertainment",
  salary: "Salary", interest: "Interest", refund: "Refunds", cashback: "Cashback",
};

/** Well-known merchants: the word stays as the merchant, and suggests a category when none is given. */
const MERCHANT_HINTS: Record<string, string> = {
  swiggy: "Food & Dining", zomato: "Food & Dining", dominos: "Food & Dining", starbucks: "Food & Dining",
  amazon: "Shopping", flipkart: "Shopping", myntra: "Shopping", ajio: "Shopping",
  uber: "Transport", ola: "Transport", rapido: "Transport",
  netflix: "Subscriptions", spotify: "Subscriptions", hotstar: "Subscriptions", prime: "Subscriptions", youtube: "Subscriptions",
  bigbasket: "Groceries", blinkit: "Groceries", zepto: "Groceries", dmart: "Groceries", instamart: "Groceries",
  bookmyshow: "Entertainment", pvr: "Entertainment",
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// ---- token helpers ----

interface Tok {
  raw: string;
  norm: string;
  used: boolean;
  /** Which part of the sentence the word sits in. */
  zone: "free" | "from" | "to";
}

const stripEdges = (word: string) => word.replace(/^[^\p{L}\p{N}₹]+/u, "").replace(/[^\p{L}\p{N}/%-]+$/u, "");
const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0 && !STOP_ACCOUNT_TOKENS.has(t));
}

const wordMatchesToken = (word: string, token: string) => word === token || (word.length >= 3 && token.startsWith(word));

export function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---- amounts ----

const AMOUNT = /^(?:₹|rs\.?|inr)?(\d[\d,]*(?:\.\d{1,2})?)(k|l|lac|lacs|lakh|lakhs)?(?:\/-)?$/i;
const SUFFIX: Record<string, number> = { k: 1_000, l: 100_000, lac: 100_000, lacs: 100_000, lakh: 100_000, lakhs: 100_000 };

/** "450", "1,200", "450.50", "₹99", "2k", "1.5L" to integer paise; null when it is not an amount. */
export function parseAmountToken(token: string): number | null {
  const match = AMOUNT.exec(token.trim());
  if (!match) return null;
  const base = parsePaise(match[1] as string);
  if (base === null) return null;
  const multiplier = match[2] ? (SUFFIX[match[2].toLowerCase()] ?? 1) : 1;
  const paise = base * multiplier;
  return Number.isSafeInteger(paise) && paise <= 10_000_000_000_00 ? paise : null;
}

// ---- dates ----

const pad = (n: number) => String(n).padStart(2, "0");

/** Picks the most recent year in which day/month is not in the future, unless a year was given. */
function withYear(today: IstDate, month: number, day: number, year?: number): IstDate | null {
  const thisYear = parseIstDate(today).year;
  const build = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
  if (year !== undefined) {
    const full = year < 100 ? 2000 + year : year;
    return isValidIstDate(build(full)) ? build(full) : null;
  }
  const candidate = build(thisYear);
  if (!isValidIstDate(candidate)) return null;
  return candidate > today ? (isValidIstDate(build(thisYear - 1)) ? build(thisYear - 1) : null) : candidate;
}

type DateHit = { date: IstDate; consumed: number } | "invalid" | null;

function dateAt(tokens: Tok[], i: number, today: IstDate): DateHit {
  const t = tokens[i];
  if (!t || t.used) return null;
  const word = t.raw.toLowerCase();
  if (word === "today") return { date: today, consumed: 1 };
  if (word === "yesterday" || word === "yday") return { date: addDays(today, -1), consumed: 1 };

  const slash = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(word);
  if (slash) {
    const date = withYear(today, Number(slash[2]), Number(slash[1]), slash[3] ? Number(slash[3]) : undefined);
    return date ? { date, consumed: 1 } : "invalid";
  }

  const next = tokens[i + 1];
  if (next && !next.used) {
    const nextWord = norm(next.raw);
    const day = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(word);
    if (day && MONTHS[nextWord] !== undefined) {
      const date = withYear(today, MONTHS[nextWord] as number, Number(day[1]));
      return date ? { date, consumed: 2 } : "invalid";
    }
    const monthFirst = MONTHS[norm(word)];
    const dayNext = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(nextWord);
    if (monthFirst !== undefined && dayNext) {
      const date = withYear(today, monthFirst, Number(dayNext[1]));
      return date ? { date, consumed: 2 } : "invalid";
    }
  }
  return null;
}

// ---- account and category matching ----

function accountIdsFor(word: string, accounts: readonly BotAccount[], kind?: "bank" | "card"): string[] {
  return accounts
    .filter((a) => (kind ? a.kind === kind : true) && nameTokens(a.name).some((t) => wordMatchesToken(word, t)))
    .map((a) => a.id);
}

/** Combines the matches of several words: the accounts all words agree on, or else every candidate. */
function resolve(words: Tok[], accounts: readonly BotAccount[], kind?: "bank" | "card"): { resolution: Resolution; matched: Tok[] } {
  const sets: { tok: Tok; ids: string[] }[] = [];
  for (const tok of words) {
    const ids = accountIdsFor(tok.norm, accounts, kind);
    if (ids.length > 0) sets.push({ tok, ids });
  }
  if (sets.length === 0) return { resolution: { status: "missing" }, matched: [] };
  const intersection = sets.map((s) => s.ids).reduce((acc, ids) => acc.filter((id) => ids.includes(id)));
  const ids = intersection.length > 0 ? intersection : [...new Set(sets.flatMap((s) => s.ids))];
  const resolution: Resolution = ids.length === 1 ? { status: "found", id: ids[0] as string } : { status: "ambiguous", ids };
  return { resolution, matched: sets.map((s) => s.tok) };
}

function categoryFor(word: string, categories: readonly BotCategory[], kind: "expense" | "income"): BotCategory | undefined {
  const matches = categories.filter((c) => c.kind === kind && nameTokens(c.name).some((t) => wordMatchesToken(word, t)));
  return matches.sort((a, b) => nameTokens(a.name).length - nameTokens(b.name).length)[0];
}

const categoryByName = (name: string, categories: readonly BotCategory[], kind: "expense" | "income") =>
  categories.find((c) => c.kind === kind && c.name.toLowerCase() === name.toLowerCase());

// ---- the parser ----

/** What kind of entry plain text most likely is: income when it says so, otherwise an expense. */
export function inferType(text: string): EntryType {
  return INCOME_WORDS.test(text) ? "income" : "expense";
}

export function parseEntry(text: string, type: EntryType, ctx: ParseContext): ParseResult {
  const rawTokens = text.trim().split(/\s+/).map(stripEdges).filter((w) => w.length > 0);
  if (rawTokens.length === 0) return { ok: false, reason: "empty" };

  const tokens: Tok[] = rawTokens.map((raw) => ({ raw, norm: norm(raw), used: false, zone: "free" as const }));

  // 1. Date.
  let txnDate: IstDate = ctx.today;
  for (let i = 0; i < tokens.length; i++) {
    const hit = dateAt(tokens, i, ctx.today);
    if (hit === "invalid") return { ok: false, reason: "bad_date" };
    if (hit) {
      txnDate = hit.date;
      for (let k = 0; k < hit.consumed; k++) (tokens[i + k] as Tok).used = true;
      break;
    }
  }

  // 2. Amount: the first amount-like word that is not part of the date.
  let amountPaise: number | null = null;
  for (const tok of tokens) {
    if (tok.used) continue;
    const paise = parseAmountToken(tok.raw);
    if (paise !== null) {
      amountPaise = paise;
      tok.used = true;
      break;
    }
  }
  if (amountPaise === null) return { ok: false, reason: "no_amount" };

  // 3. Filler words and the markers that point at accounts ("from", "using", "to").
  let zone: Tok["zone"] = "free";
  for (const tok of tokens) {
    if (tok.used) continue;
    if (ACCOUNT_MARKERS.has(tok.norm)) {
      tok.used = true;
      zone = "from";
    } else if (TO_MARKERS.has(tok.norm)) {
      tok.used = true;
      zone = "to";
    } else if (FILLER.has(tok.norm)) {
      tok.used = true;
    } else {
      tok.zone = zone;
    }
  }
  const open = () => tokens.filter((t) => !t.used);

  // Well-known merchant words stay merchants unless an account marker points at them.
  const reserved = (tok: Tok) => tok.zone === "free" && (tok.norm in MERCHANT_HINTS || ctx.merchants.has(tok.norm));

  let from: Resolution = { status: "missing" };
  let to: Resolution = { status: "missing" };

  if (type === "expense" || type === "income") {
    const marked = open().filter((t) => t.zone === "from");
    const pool = marked.length > 0 ? marked : open().filter((t) => !reserved(t) && !(t.norm in CATEGORY_WORDS));
    const r = resolve(pool, ctx.accounts);
    from = r.resolution;
    r.matched.forEach((t) => (t.used = true));
  } else if (type === "bill_payment") {
    const sourceWords = open().filter((t) => t.zone === "from");
    const bank = resolve(sourceWords.length > 0 ? sourceWords : open(), ctx.accounts, "bank");
    // With "from ...", the words that named the bank are not card words; everything else may be the card.
    const cardWords = sourceWords.length > 0 ? open().filter((t) => !bank.matched.includes(t)) : open();
    const card = resolve(cardWords, ctx.accounts, "card");
    from = bank.resolution;
    to = card.resolution;
    [...bank.matched, ...card.matched].forEach((t) => (t.used = true));
  } else {
    // transfer: "5000 hdfc to sbi", "5000 from hdfc to sbi" or just "5000 hdfc sbi"
    const toWords = open().filter((t) => t.zone === "to");
    const explicitFrom = open().filter((t) => t.zone === "from");
    // With only "to", the words before it are the source: "5000 hdfc to sbi".
    const fromWords = explicitFrom.length > 0 ? explicitFrom : toWords.length > 0 ? open().filter((t) => t.zone === "free") : [];
    if (fromWords.length > 0 || toWords.length > 0) {
      const a = resolve(fromWords, ctx.accounts, "bank");
      const b = resolve(toWords, ctx.accounts, "bank");
      from = a.resolution;
      to = b.resolution;
      [...a.matched, ...b.matched].forEach((t) => (t.used = true));
    } else {
      const hits: { tok: Tok; id: string }[] = [];
      for (const tok of open()) {
        const ids = accountIdsFor(tok.norm, ctx.accounts, "bank");
        if (ids.length === 1) hits.push({ tok, id: ids[0] as string });
      }
      const distinct = hits.filter((h, i) => hits.findIndex((o) => o.id === h.id) === i);
      if (distinct[0]) from = { status: "found", id: distinct[0].id };
      if (distinct[1]) to = { status: "found", id: distinct[1].id };
      hits.forEach((h) => (h.tok.used = true));
    }
  }

  // 4. Category and merchant (expenses and income only).
  let categoryId: string | null = null;
  let merchant: string | null = null;
  let suggestedAccountId: string | null = null;

  if (type === "expense" || type === "income") {
    const kind = type;
    for (const tok of open()) {
      const direct = categoryFor(tok.norm, ctx.categories, kind);
      if (direct) {
        categoryId = direct.id;
        tok.used = true;
        break;
      }
    }
    if (!categoryId) {
      for (const tok of open()) {
        const name = CATEGORY_WORDS[tok.norm];
        const found = name ? categoryByName(name, ctx.categories, kind) : undefined;
        if (found) {
          // The everyday word ("dinner") stays in the merchant, so the entry still says what it was.
          categoryId = found.id;
          break;
        }
      }
    }

    const leftover = open().map((t) => t.raw);
    merchant = leftover.length > 0 ? titleCase(leftover.join(" ")).slice(0, 80) : null;

    // What you did last time with this merchant fills the gaps.
    const key = (merchant ?? "").toLowerCase();
    const memory = ctx.merchants.get(key) ?? leftover.map((w) => ctx.merchants.get(w.toLowerCase())).find(Boolean);
    if (memory) {
      if (!categoryId && memory.categoryId) categoryId = memory.categoryId;
      suggestedAccountId = memory.accountId;
    }
    if (!categoryId && kind === "expense") {
      const hint = leftover.map((w) => MERCHANT_HINTS[w.toLowerCase()]).find(Boolean);
      const found = hint ? categoryByName(hint, ctx.categories, kind) : undefined;
      if (found) categoryId = found.id;
    }
  }

  return { ok: true, entry: { type, amountPaise, txnDate, from, to, categoryId, merchant, suggestedAccountId } };
}
