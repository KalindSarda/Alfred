import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { askAccount, botVoice, budgetNote, budgetsReply, categoriesReply, describeEntry, type EntryFacts, type Need, shortDate } from "../alfred/botVoice";
import { daysBetween, inDays } from "../alfred/voice";
import { AppError, ConflictError, RateLimitedError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount, listAccounts } from "../db/accounts";
import { listCategories } from "../db/categories";
import { lastTransactionRowBySource, toDto } from "../db/transactions";
import { telegramUpdates, transactions } from "../db/schema";
import { formatRupees } from "../domain/money";
import { FLOW_TYPES } from "../domain/txnTypes";
import { type IstDate, todayIst } from "../domain/dates";
import { getMe } from "../services/auth";
import { balanceOverview, setArchived, toAccountDto } from "../services/accounts";
import { getCashflow } from "../services/cashflow";
import { createCategory } from "../services/categories";
import { budgetFor, listBudgets } from "../services/budgets";
import { getSummary } from "../services/dashboard";
import { createTransaction, getTransaction, listAccountsWithFigures, listTransactions, softDeleteTransaction, updateTransaction } from "../services/ledger";
import { enforceRateLimit } from "../services/rateLimit";
import { getSettings } from "../services/settings";
import { linkChat, userForChat } from "../services/telegramLink";
import { logger } from "../utils/logger";
import { createPending, deletePending, getPending, purgeExpiredPending, type PendingEntry, updatePending } from "./pending";
import {
  type BotAccount,
  type BotCategory,
  type EntryType,
  inferType,
  type MerchantMemory,
  type ParsedEntry,
  parseEntry,
  type ParseContext,
  type Resolution,
} from "./parser";
import type { Button, TelegramApi } from "./telegramApi";
import type { TelegramUpdateData } from "./update";

export interface BotDeps {
  db: Db;
  hmacKey: string;
  telegram: TelegramApi;
  /** Epoch milliseconds; injectable for tests. */
  now: () => number;
}

const rupees = (paise: number) => formatRupees(paise);
const MAX_OPTIONS = 8;

// ---------------------------------------------------------------------------------------------------------
// Context: what Alfred knows about you while parsing and describing.
// ---------------------------------------------------------------------------------------------------------

interface BotContext {
  today: IstDate;
  accounts: BotAccount[];
  accountNames: Map<string, string>;
  categories: BotCategory[];
  categoryNames: Map<string, string>;
  merchants: Map<string, MerchantMemory>;
  /** Account ids, most recently used first. */
  lastUsed: string[];
}

async function loadContext(db: Db, userId: string, today: IstDate): Promise<BotContext> {
  const [accountRows, categoryRows, merchantRows, usedRows] = await Promise.all([
    listAccounts(db, userId, { includeArchived: true }),
    listCategories(db, userId),
    db
      .select({ merchant: transactions.merchant, categoryId: transactions.categoryId, accountId: transactions.accountId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), sql`${transactions.merchant} IS NOT NULL`, inArray(transactions.type, [...FLOW_TYPES])))
      .orderBy(desc(transactions.createdAt))
      .limit(300),
    db
      .select({ accountId: transactions.accountId, last: sql<string>`MAX(${transactions.createdAt})` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
      .groupBy(transactions.accountId)
      .orderBy(desc(sql`MAX(${transactions.createdAt})`)),
  ]);

  const merchants = new Map<string, MerchantMemory>();
  for (const row of merchantRows) {
    const key = (row.merchant ?? "").trim().toLowerCase();
    if (key && !merchants.has(key)) merchants.set(key, { categoryId: row.categoryId, accountId: row.accountId });
  }
  const active = accountRows.filter((a) => !a.archivedAt);
  const liveCategories = categoryRows.filter((c) => !c.archivedAt);

  return {
    today,
    accounts: active.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    accountNames: new Map(accountRows.map((a) => [a.id, a.name])),
    categories: liveCategories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    categoryNames: new Map(categoryRows.map((c) => [c.id, c.name])),
    merchants,
    lastUsed: usedRows.map((r) => r.accountId),
  };
}

const parseContext = (c: BotContext): ParseContext => ({ today: c.today, accounts: c.accounts, categories: c.categories, merchants: c.merchants });

const idOf = (r: Resolution): string | null => (r.status === "found" ? r.id : null);

function factsOf(entry: ParsedEntry, c: BotContext): EntryFacts {
  const from = idOf(entry.from);
  const to = idOf(entry.to);
  return {
    type: entry.type,
    amountPaise: entry.amountPaise,
    merchant: entry.merchant,
    categoryName: entry.categoryId ? (c.categoryNames.get(entry.categoryId) ?? null) : null,
    fromName: from ? (c.accountNames.get(from) ?? null) : null,
    toName: to ? (c.accountNames.get(to) ?? null) : null,
    txnDate: entry.txnDate,
    today: c.today,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Entries: from a typed line to a recorded transaction.
// ---------------------------------------------------------------------------------------------------------

function nextNeed(e: ParsedEntry): Need | null {
  if (e.type === "bill_payment") {
    if (e.to.status !== "found") return "to";
    if (e.from.status !== "found") return "from";
    return null;
  }
  if (e.type === "transfer") {
    if (e.from.status !== "found") return "from";
    if (e.to.status !== "found") return "to";
    return null;
  }
  return e.from.status !== "found" ? "from" : null;
}

/** The accounts worth offering for a question: the ones that fit, the likely one first. */
function optionsFor(e: ParsedEntry, need: Need, c: BotContext): BotAccount[] {
  const wantedKind = e.type === "bill_payment" ? (need === "to" ? "card" : "bank") : e.type === "transfer" ? "bank" : null;
  const resolution = need === "from" ? e.from : e.to;
  const otherId = idOf(need === "from" ? e.to : e.from);

  let pool = c.accounts.filter((a) => (wantedKind ? a.kind === wantedKind : true) && a.id !== otherId);
  if (resolution.status === "ambiguous") pool = pool.filter((a) => resolution.ids.includes(a.id));

  const rank = (a: BotAccount) => {
    if (a.id === e.suggestedAccountId) return -1;
    const used = c.lastUsed.indexOf(a.id);
    return used === -1 ? 1000 : used;
  };
  return [...pool].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_OPTIONS);
}

function rows(buttons: Button[], perRow = 2): Button[][] {
  const out: Button[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
}

interface Reply {
  chatId: string;
  /** When set, the existing message is edited instead of sending a new one. */
  messageId?: number;
}

async function reply(deps: BotDeps, to: Reply, text: string, buttons?: Button[][]): Promise<void> {
  if (to.messageId !== undefined) await deps.telegram.editMessage(to.chatId, to.messageId, text, buttons);
  else await deps.telegram.sendMessage(to.chatId, text, buttons);
}

interface Actor {
  userId: string;
  chatId: string;
}

async function recordEntry(deps: BotDeps, who: Actor, entry: ParsedEntry, c: BotContext, to: Reply): Promise<void> {
  const from = idOf(entry.from);
  const target = idOf(entry.to);
  if (!from) throw new AppError("validation_failed", 422, "Missing account");
  const movement = entry.type === "transfer" || entry.type === "bill_payment";

  const txn = await createTransaction(
    deps.db,
    who.userId,
    {
      type: entry.type,
      amountPaise: entry.amountPaise,
      txnDate: entry.txnDate,
      accountId: from,
      ...(movement && target && { toAccountId: target }),
      ...(!movement && { categoryId: entry.categoryId, merchant: entry.merchant }),
    },
    { source: "telegram" },
  );

  const summary = describeEntry(factsOf(entry, c));
  const notes: string[] = [];
  if (entry.type === "bill_payment" && target) {
    const figures = await listAccountsWithFigures(deps.db, who.userId, c.today);
    const card = figures.find((a) => a.id === target);
    if (card?.kind === "card") notes.push(botVoice.cardOwes(card.name, card.summary.owedPaise));
  } else if (!movement && !entry.categoryId) {
    notes.push(botVoice.uncategorized);
  } else if (entry.type === "expense" && entry.categoryId) {
    // A budget on this category? Say what is left, now that this spend is counted.
    const budget = await budgetFor(deps.db, who.userId, entry.categoryId, c.today);
    if (budget) notes.push(budgetNote(budget.categoryName, budget.remainingPaise, budget.status));
  }
  const extra = notes.length > 0 ? notes.join(" ") : undefined;

  const buttons: Button[] = [{ text: "Undo", data: `u:${txn.id}` }];
  if (!movement && !entry.categoryId) buttons.push({ text: "Set category", data: `c:${txn.id}` });
  await reply(deps, to, botVoice.recorded(summary, extra), [buttons]);
}

/** Moves an entry forward: ask for what is missing, ask for confirmation, or record it. */
async function advance(deps: BotDeps, who: Actor, c: BotContext, pending: PendingEntry, pendingId: string | null, to: Reply): Promise<void> {
  const { entry, mode } = pending;
  const need = nextNeed(entry);

  if (need) {
    const options = optionsFor(entry, need, c);
    if (options.length === 0) {
      if (pendingId) await deletePending(deps.db, pendingId);
      await reply(deps, to, c.accounts.length === 0 ? botVoice.noAccountsYet : botVoice.noMatchingAccount);
      return;
    }
    const id = pendingId ?? (await createPending(deps.db, who.userId, who.chatId, pending, deps.now()));
    if (pendingId) await updatePending(deps.db, id, pending);
    const buttons = [...rows(options.map((a) => ({ text: a.name, data: `p:${id}:a:${a.id}` }))), [{ text: "Cancel", data: `p:${id}:no` }]];
    await reply(deps, to, askAccount(entry.type, need, describeEntry(factsOf(entry, c))), buttons);
    return;
  }

  if (mode === "text") {
    const id = pendingId ?? (await createPending(deps.db, who.userId, who.chatId, pending, deps.now()));
    if (pendingId) await updatePending(deps.db, id, pending);
    await reply(deps, to, botVoice.confirm(describeEntry(factsOf(entry, c))), [
      [{ text: "Record it", data: `p:${id}:ok` }, { text: "Cancel", data: `p:${id}:no` }],
    ]);
    return;
  }

  if (pendingId) await deletePending(deps.db, pendingId);
  await recordEntry(deps, who, entry, c, to);
}

async function startEntry(deps: BotDeps, who: Actor, text: string, type: EntryType, mode: PendingEntry["mode"]): Promise<void> {
  const c = await loadContext(deps.db, who.userId, todayIst(new Date(deps.now())));
  const parsed = parseEntry(text, type, parseContext(c));
  if (!parsed.ok) {
    const message = parsed.reason === "bad_date" ? botVoice.badDate : botVoice.noAmount;
    await deps.telegram.sendMessage(who.chatId, message);
    return;
  }
  await advance(deps, who, c, { mode, entry: parsed.entry }, null, { chatId: who.chatId });
}

// ---------------------------------------------------------------------------------------------------------
// Questions: balance, due dates, today, summary, settings.
// ---------------------------------------------------------------------------------------------------------

async function cmdBalance(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const figures = await listAccountsWithFigures(deps.db, who.userId, today);
  if (figures.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.noAccountsYet));
  const dtos = figures.map(toAccountDto);
  const overview = balanceOverview(figures);

  const banks = dtos.filter((a) => a.kind === "bank");
  const cards = dtos.filter((a) => a.kind === "card");
  const lines = ["Here is where things stand."];
  if (banks.length) {
    lines.push("", "Bank accounts");
    for (const b of banks) if (b.kind === "bank") lines.push(`${b.name}: ${rupees(b.balancePaise)}${b.countsTowardSafeToSpend ? "" : " (set aside)"}`);
  }
  if (cards.length) {
    lines.push("", "Credit cards");
    for (const k of cards) if (k.kind === "card") lines.push(`${k.name}: owes ${rupees(k.outstandingPaise)}, due ${shortDate(k.nextDueDate)}`);
  }
  lines.push("", `Safe to spend: ${rupees(overview.safeToSpendPaise)}, as recorded.`);
  if (overview.setAsidePaise > 0) lines.push(`Set aside, not counted: ${rupees(overview.setAsidePaise)}.`);
  lines.push(`Net worth: ${rupees(overview.netWorthPaise)} (banks minus cards).`);
  await deps.telegram.sendMessage(who.chatId, lines.join("\n"));
}

/** The account list with one button per account: Archive for active ones, Restore for archived ones. */
async function accountsView(deps: BotDeps, who: Actor, today: IstDate, note?: string): Promise<{ text: string; buttons: Button[][] } | null> {
  const figures = await listAccountsWithFigures(deps.db, who.userId, today, { includeArchived: true });
  if (figures.length === 0) return null;
  const dtos = figures.map((f) => toAccountDto(f));
  const active = dtos.filter((a) => !a.archived);
  const archived = dtos.filter((a) => a.archived);

  const lines: string[] = note ? [note, ""] : [];
  lines.push("Your accounts. Tap one to archive it.");
  const banks = active.filter((a) => a.kind === "bank");
  const cards = active.filter((a) => a.kind === "card");
  if (banks.length) {
    lines.push("", "Bank accounts");
    for (const b of banks) if (b.kind === "bank") lines.push(`${b.name}: ${rupees(b.balancePaise)}`);
  }
  if (cards.length) {
    lines.push("", "Credit cards");
    for (const k of cards) if (k.kind === "card") lines.push(`${k.name}: owes ${rupees(k.outstandingPaise)}`);
  }
  if (archived.length) lines.push("", `Archived: ${archived.map((a) => a.name).join(", ")}.`);
  lines.push("", "Adding, editing, merging and deleting are in the app, under Accounts and cards.");

  const buttons: Button[][] = [
    ...active.map((a) => [{ text: `Archive ${a.name}`, data: `a:${a.id}:x` }]),
    ...archived.map((a) => [{ text: `Restore ${a.name}`, data: `a:${a.id}:r` }]),
  ];
  return { text: lines.join("\n"), buttons };
}

async function cmdAccounts(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const view = await accountsView(deps, who, today);
  if (!view) return void (await deps.telegram.sendMessage(who.chatId, botVoice.noAccountsYet));
  await deps.telegram.sendMessage(who.chatId, view.text, view.buttons);
}

async function cmdDue(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const figures = await listAccountsWithFigures(deps.db, who.userId, today);
  const cards = figures
    .flatMap((a) => (a.kind === "card" ? [a] : []))
    .sort((a, b) => a.summary.nextDueDate.localeCompare(b.summary.nextDueDate));
  if (cards.length === 0) return void (await deps.telegram.sendMessage(who.chatId, "You have no credit cards on record."));
  const pending = cards.filter((c) => c.summary.statementOutstandingPaise > 0);
  if (pending.length === 0) return void (await deps.telegram.sendMessage(who.chatId, "No card payments are pending."));
  const lines = ["Card payments coming up:"];
  for (const c of pending) {
    lines.push(`${c.name}: ${rupees(c.summary.statementOutstandingPaise)} due ${shortDate(c.summary.nextDueDate)} (${inDays(daysBetween(today, c.summary.nextDueDate))})`);
  }
  await deps.telegram.sendMessage(who.chatId, lines.join("\n"));
}

async function cmdToday(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const [list, figures, settings] = await Promise.all([
    listTransactions(deps.db, who.userId, { from: today, to: today, limit: 50 }),
    listAccountsWithFigures(deps.db, who.userId, today),
    getSettings(deps.db, who.userId),
  ]);
  const c = await loadContext(deps.db, who.userId, today);
  const spent = list.items.filter((t) => t.type === "expense" && t.status === "confirmed");
  const lines: string[] = [];
  if (list.items.length === 0) {
    lines.push(`Nothing recorded for today, ${shortDate(today)}, yet.`);
  } else {
    const total = spent.reduce((s, t) => s + t.amountPaise, 0);
    lines.push(`Today, ${shortDate(today)}: ${rupees(total)} spent across ${spent.length} ${spent.length === 1 ? "entry" : "entries"}.`);
    for (const t of list.items.slice(0, 8)) {
      const label = t.merchant ?? (t.categoryId ? c.categoryNames.get(t.categoryId) : null) ?? (t.type === "bill_payment" ? "Card payment" : t.type === "transfer" ? "Transfer" : "Entry");
      lines.push(`${label}: ${rupees(t.amountPaise)}${t.type === "income" ? " received" : ""}`);
    }
  }
  const soon = figures
    .flatMap((a) => (a.kind === "card" ? [a] : []))
    .filter((k) => k.summary.statementOutstandingPaise > 0 && daysBetween(today, k.summary.nextDueDate) <= settings.nudgeLeadDays + 4)
    .sort((a, b) => a.summary.nextDueDate.localeCompare(b.summary.nextDueDate));
  if (soon.length) {
    lines.push("", "Coming up:");
    for (const k of soon) lines.push(`${k.name}: ${rupees(k.summary.statementOutstandingPaise)} due ${shortDate(k.summary.nextDueDate)} (${inDays(daysBetween(today, k.summary.nextDueDate))})`);
  }
  await deps.telegram.sendMessage(who.chatId, lines.join("\n"));
}

const SUMMARY_PERIODS: Record<string, { key: "cycle" | "7d" | "last_month" | "ytd"; label: string }> = {
  "": { key: "cycle", label: "your month so far" },
  month: { key: "cycle", label: "your month so far" },
  week: { key: "7d", label: "the last seven days" },
  lastmonth: { key: "last_month", label: "last month" },
  year: { key: "ytd", label: "this year so far" },
};

async function cmdSummary(deps: BotDeps, who: Actor, arg: string, today: IstDate): Promise<void> {
  const period = SUMMARY_PERIODS[arg.trim().toLowerCase().replace(/\s+/g, "")] ?? SUMMARY_PERIODS[""]!;
  const [summary, flow] = await Promise.all([
    getSummary(deps.db, who.userId, period.key, today),
    getCashflow(deps.db, who.userId, period.key, "category", today),
  ]);
  const lines = [
    `For ${period.label} (${shortDate(summary.period.from)} to ${shortDate(summary.period.to)}):`,
    `Income ${rupees(summary.incomePaise)}, expenses ${rupees(summary.expensePaise)}, net ${rupees(summary.netPaise)}.`,
  ];
  const top = flow.expenses.slice(0, 5);
  if (top.length) {
    lines.push("", "Where it went:");
    for (const r of top) lines.push(`${r.name}: ${rupees(r.amountPaise)}${flow.incomePaise > 0 ? ` (${r.pctOfIncome}% of income)` : ""}`);
  }
  await deps.telegram.sendMessage(who.chatId, lines.join("\n"));
}

async function cmdBudget(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const overview = await listBudgets(deps.db, who.userId, today);
  await deps.telegram.sendMessage(who.chatId, budgetsReply(overview.period, overview.items, overview.totalSpentPaise, overview.totalLimitPaise));
}

/** "/category" lists; "/category add Pets" adds an expense category; "/category add income Freelance" an income one. */
async function cmdCategory(deps: BotDeps, who: Actor, arg: string): Promise<void> {
  const add = /^add\s+([\s\S]*)$/i.exec(arg);
  if (!add) {
    const rows = (await listCategories(deps.db, who.userId)).filter((c) => !c.archivedAt);
    const names = (kind: "expense" | "income") => rows.filter((c) => c.kind === kind).map((c) => c.name);
    return void (await deps.telegram.sendMessage(who.chatId, categoriesReply(names("expense"), names("income"))));
  }
  let rest = (add[1] ?? "").trim();
  const kind = /^income\s+/i.test(rest) ? "income" : "expense";
  if (kind === "income") rest = rest.replace(/^income\s+/i, "");
  const name = rest.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 40) return void (await deps.telegram.sendMessage(who.chatId, botVoice.categoryBadName));
  try {
    const created = await createCategory(deps.db, who.userId, { name, kind });
    await deps.telegram.sendMessage(who.chatId, botVoice.categoryAdded(created.name, kind));
  } catch (error) {
    if (error instanceof ConflictError) return void (await deps.telegram.sendMessage(who.chatId, botVoice.categoryExists(name)));
    throw error;
  }
}

async function cmdSettings(deps: BotDeps, who: Actor): Promise<void> {
  const [settings, me] = await Promise.all([getSettings(deps.db, who.userId), getMe(deps.db, who.userId)]);
  await deps.telegram.sendMessage(
    who.chatId,
    [
      `I call you ${me.displayName}.`,
      `I remind you ${settings.nudgeLeadDays} ${settings.nudgeLeadDays === 1 ? "day" : "days"} before a card payment is due.`,
      `Your month starts on day ${settings.periodStartDay}.`,
      "",
      "These can be changed in the app, under More.",
    ].join("\n"),
  );
}

async function cmdUndo(deps: BotDeps, who: Actor, c: BotContext): Promise<void> {
  const row = await lastTransactionRowBySource(deps.db, who.userId, "telegram");
  if (!row) return void (await deps.telegram.sendMessage(who.chatId, botVoice.nothingToUndo));
  await deps.telegram.sendMessage(who.chatId, botVoice.askRemove(summaryOfTxn(toDto(row), c)), [
    [{ text: "Remove it", data: `d:${row.id}:y` }, { text: "Keep it", data: `d:${row.id}:n` }],
  ]);
}

function summaryOfTxn(t: ReturnType<typeof toDto>, c: BotContext): string {
  return describeEntry({
    type: t.type,
    amountPaise: t.amountPaise,
    merchant: t.merchant,
    categoryName: t.categoryId ? (c.categoryNames.get(t.categoryId) ?? null) : null,
    fromName: c.accountNames.get(t.accountId) ?? null,
    toName: t.toAccountId ? (c.accountNames.get(t.toAccountId) ?? null) : null,
    txnDate: t.txnDate,
    today: c.today,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Messages and buttons.
// ---------------------------------------------------------------------------------------------------------

async function handleLinking(deps: BotDeps, chatId: string, argument: string): Promise<void> {
  const nowSeconds = Math.floor(deps.now() / 1000);
  // Guessing codes from an unknown chat is limited, and stays silent when it is.
  try {
    await enforceRateLimit(deps.db, deps.hmacKey, { bucket: "tg-link", subject: chatId, limit: 10, windowSeconds: 3600 }, nowSeconds);
  } catch (error) {
    if (error instanceof RateLimitedError) return;
    throw error;
  }
  const userId = await linkChat(deps.db, deps.hmacKey, argument, chatId, deps.now());
  if (!userId) return void (await deps.telegram.sendMessage(chatId, botVoice.linkFailed));
  const me = await getMe(deps.db, userId);
  await deps.telegram.sendMessage(chatId, botVoice.welcome(me.displayName, new Date(deps.now())));
}

async function handleMessage(deps: BotDeps, message: NonNullable<TelegramUpdateData["message"]>): Promise<void> {
  if (message.chat.type && message.chat.type !== "private") return;
  const text = (message.text ?? "").trim();
  if (!text) return;
  const chatId = String(message.chat.id);
  const command = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  const name = command?.[1]?.toLowerCase();
  const arg = (command?.[2] ?? "").trim();

  const userId = await userForChat(deps.db, chatId);
  if (!userId) {
    // An unlinked chat is ignored, apart from the one message that can link it.
    if (name === "start" && arg) await handleLinking(deps, chatId, arg);
    return;
  }

  const who: Actor = { userId, chatId };
  const today = todayIst(new Date(deps.now()));

  try {
    if (!command) return await startEntry(deps, who, text, inferType(text), "text");
    switch (name) {
      case "start": {
        if (arg) return await handleLinking(deps, chatId, arg);
        const me = await getMe(deps.db, userId);
        return void (await deps.telegram.sendMessage(chatId, botVoice.alreadyLinked(me.displayName, new Date(deps.now()))));
      }
      case "help":
        return void (await deps.telegram.sendMessage(chatId, botVoice.help));
      case "add":
        return await startEntry(deps, who, arg, "expense", "command");
      case "income":
        return await startEntry(deps, who, arg, "income", "command");
      case "pay":
        return await startEntry(deps, who, arg, "bill_payment", "command");
      case "transfer":
        return await startEntry(deps, who, arg, "transfer", "command");
      case "undo":
        return await cmdUndo(deps, who, await loadContext(deps.db, userId, today));
      case "today":
        return await cmdToday(deps, who, today);
      case "balance":
        return await cmdBalance(deps, who, today);
      case "due":
      case "upcoming":
        return await cmdDue(deps, who, today);
      case "summary":
        return await cmdSummary(deps, who, arg, today);
      case "budget":
      case "budgets":
        return await cmdBudget(deps, who, today);
      case "accounts":
        return await cmdAccounts(deps, who, today);
      case "category":
      case "categories":
        return await cmdCategory(deps, who, arg);
      case "settings":
        return await cmdSettings(deps, who);
      default:
        return void (await deps.telegram.sendMessage(chatId, botVoice.unknownCommand));
    }
  } catch (error) {
    await failed(deps, chatId, error);
  }
}

/** Says plainly that it failed, and never that it worked. */
async function failed(deps: BotDeps, chatId: string, error: unknown, replaces?: Reply): Promise<void> {
  logger.error("bot_handler_failed", { error: error instanceof Error ? error.message : "unknown" });
  try {
    // When a button press fails, the message that carried the button changes too, so no stale buttons remain.
    if (replaces?.messageId !== undefined) await deps.telegram.editMessage(chatId, replaces.messageId, botVoice.failure);
    else await deps.telegram.sendMessage(chatId, botVoice.failure);
  } catch {
    // Telegram itself is unreachable; nothing more to do.
  }
}

async function handleCallback(deps: BotDeps, query: NonNullable<TelegramUpdateData["callback_query"]>): Promise<void> {
  const message = query.message;
  if (!message || !query.data) return void (await deps.telegram.answerCallback(query.id));
  const chatId = String(message.chat.id);
  const userId = await userForChat(deps.db, chatId);
  if (!userId) return void (await deps.telegram.answerCallback(query.id));

  const who: Actor = { userId, chatId };
  const to: Reply = { chatId, messageId: message.message_id };
  const c = await loadContext(deps.db, userId, todayIst(new Date(deps.now())));
  const [kind, id, action, argument] = query.data.split(":");

  try {
    if (kind === "p" && id) {
      const pending = await getPending(deps.db, userId, chatId, id, deps.now());
      if (!pending) {
        await reply(deps, to, botVoice.expired);
      } else if (action === "no") {
        await deletePending(deps.db, id);
        await reply(deps, to, botVoice.cancelled);
      } else if (action === "ok") {
        await deletePending(deps.db, id);
        await recordEntry(deps, who, pending.entry, c, to);
      } else if (action === "a" && argument) {
        const need = nextNeed(pending.entry);
        const allowed = need ? optionsFor(pending.entry, need, c).some((a) => a.id === argument) : false;
        if (!need || !allowed) {
          await reply(deps, to, botVoice.noMatchingAccount);
        } else {
          const entry: ParsedEntry = { ...pending.entry, [need]: { status: "found", id: argument } as Resolution };
          await advance(deps, who, c, { mode: pending.mode, entry }, id, to);
        }
      }
    } else if (kind === "u" && id) {
      const t = await getTransaction(deps.db, userId, id).catch(() => null);
      if (!t) await reply(deps, to, botVoice.alreadyRemoved);
      else {
        await softDeleteTransaction(deps.db, userId, id);
        await reply(deps, to, botVoice.removed(summaryOfTxn(t, c)));
      }
    } else if (kind === "d" && id) {
      const t = await getTransaction(deps.db, userId, id).catch(() => null);
      if (!t) await reply(deps, to, botVoice.alreadyRemoved);
      else if (action === "y") {
        await softDeleteTransaction(deps.db, userId, id);
        await reply(deps, to, botVoice.removed(summaryOfTxn(t, c)));
      } else {
        await reply(deps, to, botVoice.cancelled);
      }
    } else if (kind === "c" && id) {
      const t = await getTransaction(deps.db, userId, id).catch(() => null);
      if (!t || (t.type !== "expense" && t.type !== "income")) {
        await reply(deps, to, botVoice.alreadyRemoved);
      } else {
        const options = c.categories.filter((cat) => cat.kind === t.type).slice(0, 12);
        await reply(deps, to, botVoice.askCategory, rows(options.map((cat) => ({ text: cat.name, data: `k:${id}:${cat.id}` }))));
      }
    } else if (kind === "a" && id && (action === "x" || action === "r")) {
      const today = todayIst(new Date(deps.now()));
      const account = await getAccount(deps.db, userId, id);
      if (!account) {
        await reply(deps, to, botVoice.alreadyRemoved);
      } else {
        let note: string;
        try {
          await setArchived(deps.db, userId, id, action === "x", today);
          note = action === "x" ? botVoice.accountArchived(account.name) : botVoice.accountRestored(account.name);
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
          note = botVoice.accountNotArchived(account.name, error.message);
        }
        const view = await accountsView(deps, who, today, note);
        if (view) await reply(deps, to, view.text, view.buttons);
        else await reply(deps, to, note);
      }
    } else if (kind === "k" && id && action) {
      const t = await updateTransaction(deps.db, userId, id, { categoryId: action }).catch(() => null);
      const name = c.categoryNames.get(action);
      if (!t || !name) await reply(deps, to, botVoice.failure);
      else await reply(deps, to, botVoice.filed(summaryOfTxn(t, c)), [[{ text: "Undo", data: `u:${id}` }]]);
    }
  } catch (error) {
    await failed(deps, chatId, error, to);
  } finally {
    await deps.telegram.answerCallback(query.id).catch(() => undefined);
  }
}

/** Entry point for every Telegram update. Idempotent: an update that was already handled is skipped. */
export async function handleUpdate(deps: BotDeps, update: TelegramUpdateData): Promise<void> {
  const inserted = await deps.db
    .insert(telegramUpdates)
    .values({ updateId: update.update_id, receivedAt: new Date(deps.now()).toISOString() })
    .onConflictDoNothing()
    .returning({ id: telegramUpdates.updateId });
  if (inserted.length === 0) return;

  await purgeExpiredPending(deps.db, deps.now());
  if (update.callback_query) await handleCallback(deps, update.callback_query);
  else if (update.message) await handleMessage(deps, update.message);
}
