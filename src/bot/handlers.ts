import { and, eq, isNull } from "drizzle-orm";
import { askAccount, botVoice, budgetNote, budgetsReply, categoriesReply, commitmentsLines, monthlyReviewLines, emergencyLine, runwayLine, swipeReply, whatIfLines, usualLabel, describeEntry, emiReply, goalsReply, holdsReply, investReply, loansReply, owedReply, recurringReply, type EntryFacts, type Need, shortDate } from "../alfred/botVoice";
import { daysBetween, inDays } from "../alfred/voice";
import { AppError, ConflictError, NotFoundError, RateLimitedError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { getAccount, listAccounts } from "../db/accounts";
import { loadEntryHints } from "../db/hints";
import { getHold } from "../db/holds";
import { listCategories } from "../db/categories";
import { getTransactionRow, lastTransactionRowBySource, toDto } from "../db/transactions";
import { telegramUpdates } from "../db/schema";
import { formatRupees } from "../domain/money";
import { type IstDate, todayIst } from "../domain/dates";
import { getMe } from "../services/auth";
import { getGoalRow, goalsSetAside } from "../db/goals";
import { setInstalmentAmount } from "../services/emi";
import { getHoldingRow } from "../db/holdings";
import { holdingsValue, listHoldings, setEntryUnits, setRate, setValue } from "../services/holdings";
import { unitWord, unitsQuestionFor } from "../services/holdingsJob";
import { parseQuantityE4 } from "../domain/holdings";
import { getCommitments } from "../services/commitments";
import { buildSalaryPlan, latestSalary } from "../services/salary";
import { getEmergencyFund } from "../services/emergency";
import { getFire } from "../services/fire";
import { fireFacts, focusFacts } from "../services/reviewJob";
import { fundOffer } from "../services/fundTalk";
import { getLadder } from "../services/ladder";
import { getRunway } from "../services/runway";
import { getHealth } from "../services/health";
import { previewBalance, settleBalance } from "../services/balanceCheck";
import { analyseStatement, recordCheck, rankCardsForToday, settleStatement, statementFacts } from "../services/cardTools";
import { checkinLog } from "../db/schema";
import { updateSettings } from "../services/settings";
import { addDays } from "../domain/dates";
import { newId, nowIso } from "../utils/id";
import { getLoan, listLoans, loansOutstanding, setInstalmentTotal, simulatePrepay } from "../services/loans";
import { addContribution, listGoals, removeContribution } from "../services/goals";
import { parseAmountToken } from "./parser";
import { createBalanceFix, createBalanceProposal, createEmiFix, createLoanFix, createStatementFix, createStatementProposal, createUnitsFix, deletePending as removePending, getBalanceProposal, getStatementProposal, getTransferProposal, takeAmountFix } from "./pending";
import { balanceOverview, setArchived, toAccountDto } from "../services/accounts";
import { getCashflow } from "../services/cashflow";
import { createCategory } from "../services/categories";
import { listPlans } from "../services/emi";
import { listRules } from "../services/recurring";
import { createDebt, deleteDebt, listDebts, settleDebt, updateDebt } from "../services/debts";
import { getDebtRow } from "../db/debts";
import { allotHold, createHold, deleteHold, listHolds, releaseHold } from "../services/holds";
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
  const [accountRows, categoryRows, hints] = await Promise.all([
    listAccounts(db, userId, { includeArchived: true }),
    listCategories(db, userId),
    loadEntryHints(db, userId, { merchantLimit: 300 }),
  ]);

  const merchants = new Map<string, MerchantMemory>();
  for (const m of hints.merchants) merchants.set(m.merchant.toLowerCase(), { categoryId: m.categoryId, accountId: m.accountId });
  const active = accountRows.filter((a) => !a.archivedAt);
  const liveCategories = categoryRows.filter((c) => !c.archivedAt);

  return {
    today,
    accounts: active.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    accountNames: new Map(accountRows.map((a) => [a.id, a.name])),
    categories: liveCategories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    categoryNames: new Map(categoryRows.map((c) => [c.id, c.name])),
    merchants,
    lastUsed: hints.lastUsedAccountIds,
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
function optionsFor(e: ParsedEntry, need: Need, c: BotContext, kind?: PendingEntry["kind"]): BotAccount[] {
  // Blocked and lent money moves through a bank account, so those only ever offer banks.
  const wantedKind = kind ? "bank" : e.type === "bill_payment" ? (need === "to" ? "card" : "bank") : e.type === "transfer" ? "bank" : null;
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

/** Blocks the amount in the chosen bank account. The title is whatever the line named, such as the IPO. */
async function recordHold(deps: BotDeps, who: Actor, entry: ParsedEntry, c: BotContext, to: Reply): Promise<void> {
  const from = idOf(entry.from);
  if (!from) throw new AppError("validation_failed", 422, "Missing account");
  try {
    const hold = await createHold(
      deps.db,
      who.userId,
      { accountId: from, title: (entry.merchant ?? "").trim().slice(0, 80) || "IPO application", amountPaise: entry.amountPaise, appliedDate: entry.txnDate },
      c.today,
    );
    const overview = balanceOverview(await listAccountsWithFigures(deps.db, who.userId, c.today), undefined, await goalsSetAside(deps.db, who.userId));
    await reply(deps, to, botVoice.holdRecorded(hold.title, hold.amountPaise, hold.accountName, overview.safeToSpendPaise), [[{ text: "Undo", data: `h:${hold.id}:u` }]]);
  } catch (error) {
    if (error instanceof ValidationError) return void (await reply(deps, to, botVoice.holdNeedsBank));
    throw error;
  }
}

/** Active blocks with an Allotted and a Not allotted button each. */
async function holdsView(deps: BotDeps, who: Actor, today: IstDate, note?: string): Promise<{ text: string; buttons: Button[][] } | null> {
  const items = await listHolds(deps.db, who.userId, today, "active");
  if (items.length === 0) return null;
  const short = (title: string) => (title.length > 16 ? `${title.slice(0, 15)}\u2026` : title);
  return {
    text: holdsReply(items, note),
    buttons: items.map((h) => [
      { text: `Allotted: ${short(h.title)}`, data: `h:${h.id}:a` },
      { text: `Not allotted: ${short(h.title)}`, data: `h:${h.id}:n` },
    ]),
  };
}

/** Notes money lent or borrowed. The person is whatever name the line carried; the account is a bank, or cash. */
async function recordDebt(deps: BotDeps, who: Actor, entry: ParsedEntry, c: BotContext, to: Reply, kind: "lent" | "borrowed", cash: boolean): Promise<void> {
  const name = (entry.merchant ?? "").trim();
  if (!name) return void (await reply(deps, to, botVoice.debtNeedsName));
  const from = idOf(entry.from);
  if (!cash && !from) throw new AppError("validation_failed", 422, "Missing account");
  const { person, debtId } = await createDebt(
    deps.db,
    who.userId,
    { name, direction: kind, amountPaise: entry.amountPaise, date: entry.txnDate, accountId: cash ? null : from },
    "telegram",
    c.today,
  );
  const accountName = !cash && from ? (c.accountNames.get(from) ?? null) : null;
  await reply(deps, to, botVoice.debtRecorded(kind === "lent", person.name, entry.amountPaise, accountName, person.trusted), [[{ text: "Undo", data: `f:${debtId}:u` }]]);
}

async function cmdOwed(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const o = await listDebts(deps.db, who.userId, today, "open");
  await deps.telegram.sendMessage(who.chatId, owedReply(o.people, o.owedToYouPaise, o.youOwePaise));
}

async function cmdGoals(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const o = await listGoals(deps.db, who.userId, today, "active");
  await deps.telegram.sendMessage(who.chatId, goalsReply(o.goals, o.setAsidePaise));
}

/** Puts money toward a goal: "/save 5000 laptop". Which goal is asked about when the words fit none or several. */
async function cmdSave(deps: BotDeps, who: Actor, arg: string, today: IstDate): Promise<void> {
  const [first, ...rest] = arg.trim().split(/\s+/);
  const paise = first ? parseAmountToken(first) : null;
  if (!paise) return void (await deps.telegram.sendMessage(who.chatId, botVoice.goalNeedsAmount));
  const { goals: active } = await listGoals(deps.db, who.userId, today, "active");
  if (active.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.goalNoGoals));
  const words = rest.join(" ").toLowerCase();
  const exact = active.filter((g) => g.name.toLowerCase() === words);
  const fits = exact.length ? exact : words ? active.filter((g) => g.name.toLowerCase().includes(words)) : active.length === 1 ? active : [];
  if (words && fits.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.goalNoMatch));
  if (fits.length !== 1) {
    await deps.telegram.sendMessage(who.chatId, botVoice.goalAskWhich(paise), rows((fits.length ? fits : active).slice(0, MAX_OPTIONS).map((g) => ({ text: g.name, data: `g:${g.id}:s:${paise}` }))));
    return;
  }
  await saveToGoal(deps, who, fits[0]!.id, paise, today, { chatId: who.chatId });
}

async function saveToGoal(deps: BotDeps, who: Actor, goalId: string, paise: number, today: IstDate, to: Reply): Promise<void> {
  const row = await getGoalRow(deps.db, who.userId, goalId);
  if (!row || row.status !== "active") return void (await reply(deps, to, botVoice.goalClosed));
  const before = await listGoals(deps.db, who.userId, today, "active");
  const known = new Set((before.goals.find((g) => g.id === goalId)?.contributions ?? []).map((x) => x.id));
  const goal = await addContribution(deps.db, who.userId, goalId, { amountPaise: paise }, today);
  const made = goal.contributions.find((x) => !known.has(x.id));
  await reply(deps, to, botVoice.goalSaved(goal.name, paise, goal.savedPaise, goal.targetPaise), made ? [[{ text: "Undo", data: `g:${goalId}:u:${made.id}` }]] : undefined);
}

/** What each /menu button runs: the same answers as the commands, so the menu is only a way to find them. */
const MENU: { id: string; label: string }[] = [
  { id: "balance", label: "Balance" },
  { id: "today", label: "Today" },
  { id: "due", label: "Card dues" },
  { id: "budget", label: "Budgets" },
  { id: "owed", label: "Owed" },
  { id: "goals", label: "Goals" },
  { id: "emi", label: "EMIs" },
  { id: "ipo", label: "IPO blocks" },
  { id: "recurring", label: "Recurring" },
  { id: "loans", label: "Loans" },
];

async function cmdMenu(deps: BotDeps, who: Actor): Promise<void> {
  await deps.telegram.sendMessage(who.chatId, botVoice.menu, rows(MENU.map((m) => ({ text: m.label, data: `m:${m.id}` }))));
}

async function runMenuItem(deps: BotDeps, who: Actor, id: string, today: IstDate): Promise<void> {
  switch (id) {
    case "balance":
      return await cmdBalance(deps, who, today);
    case "today":
      return await cmdToday(deps, who, today);
    case "due":
      return await cmdDue(deps, who, today);
    case "budget":
      return await cmdBudget(deps, who, today);
    case "owed":
      return await cmdOwed(deps, who, today);
    case "goals":
      return await cmdGoals(deps, who, today);
    case "emi":
      return await cmdEmi(deps, who, today);
    case "ipo":
      return await cmdIpo(deps, who, "", today);
    case "recurring":
      return await cmdRecurring(deps, who, today);
    case "loans":
      return await cmdLoans(deps, who);
    default:
      return void (await deps.telegram.sendMessage(who.chatId, botVoice.unknownCommand));
  }
}

/** The last full month in words: what came in, what went out, what was saved. */
async function cmdReview(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const view = await getHealth(deps.db, who.userId, today, "last");
  if (view.empty) return void (await deps.telegram.sendMessage(who.chatId, botVoice.reviewNothing));
  await deps.telegram.sendMessage(who.chatId, monthlyReviewLines({ ...view, from: view.period.from, to: view.period.to, emergency: await getEmergencyFund(deps.db, who.userId, today), fire: fireFacts(await getFire(deps.db, who.userId, today)), focus: focusFacts(await getLadder(deps.db, who.userId, today)) }).join("\n"));
}

/** What part-paying a loan would do: "/whatif 25000 home" (add "12%" to compare the same money invested). */
async function cmdWhatIf(deps: BotDeps, who: Actor, arg: string, today: IstDate): Promise<void> {
  const tokens = arg.split(/\s+/).filter(Boolean);
  const pct = tokens.find((t) => /^\d+(\.\d+)?%$/.test(t));
  const rest = tokens.filter((t) => t !== pct && t.toLowerCase() !== "prepay");
  const amountToken = rest.find((t) => (parseAmountToken(t) ?? 0) > 0);
  const amount = amountToken ? parseAmountToken(amountToken) : null;
  if (amount === null || amount === undefined) return void (await deps.telegram.sendMessage(who.chatId, botVoice.whatIfNeedsAmount));
  const { loans: active } = await listLoans(deps.db, who.userId, "active");
  if (active.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.whatIfNoLoans));
  const words = rest.filter((t) => t !== amountToken).join(" ").toLowerCase();
  const exact = active.filter((l) => l.name.toLowerCase() === words);
  const fits = exact.length ? exact : words ? active.filter((l) => l.name.toLowerCase().includes(words)) : active.length === 1 ? active : [];
  if (fits.length !== 1) return void (await deps.telegram.sendMessage(who.chatId, words ? botVoice.whatIfNoMatch : botVoice.whatIfWhich(String(amount / 100))));
  const loan = fits[0] as (typeof active)[number];
  const returnPct = pct ? Number.parseFloat(pct) : undefined;
  try {
    const [shorten, lower] = await Promise.all([
      simulatePrepay(deps.db, who.userId, loan.id, { amountPaise: amount, effect: "shorten", ...(returnPct !== undefined && { returnPct }) }, today),
      simulatePrepay(deps.db, who.userId, loan.id, { amountPaise: amount, effect: "lower" }, today),
    ]);
    await deps.telegram.sendMessage(
      who.chatId,
      whatIfLines({
        loanName: loan.name,
        amountPaise: amount,
        before: shorten.before,
        shorten: { after: shorten.after, monthsSaved: shorten.monthsSaved, interestSavedPaise: shorten.interestSavedPaise },
        lower: { after: lower.after, interestSavedPaise: lower.interestSavedPaise },
        invest: shorten.invest,
      }).join("\n"),
    );
  } catch (error) {
    if (error instanceof ValidationError) return void (await deps.telegram.sendMessage(who.chatId, error.details?.[0]?.message ?? botVoice.failure));
    throw error;
  }
}

/** The salary day plan on request: for the latest salary credit, or where things stand when there is none. */
async function cmdSalary(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const plan = await buildSalaryPlan(deps.db, who.userId, today, await latestSalary(deps.db, who.userId, today), { chatId: who.chatId, nowMs: deps.now() });
  await deps.telegram.sendMessage(who.chatId, plan.text, plan.buttons.length > 0 ? plan.buttons : undefined);
}

/** The next step on the ladder, and how much could safely move into the emergency fund. */
async function cmdFund(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const offer = await fundOffer(deps.db, who.userId, today, { chatId: who.chatId, nowMs: deps.now() });
  await deps.telegram.sendMessage(who.chatId, offer.text, offer.buttons.length > 0 ? offer.buttons : undefined);
}

/** Which card to use today for an amount: the longest interest-free time first. */
async function cmdSwipe(deps: BotDeps, who: Actor, arg: string, today: IstDate): Promise<void> {
  const amount = arg
    .split(/\s+/)
    .map((t) => parseAmountToken(t))
    .find((p): p is number => p !== null && p > 0);
  if (amount === undefined) return void (await deps.telegram.sendMessage(who.chatId, botVoice.swipeNeedsAmount));
  const ranked = await rankCardsForToday(deps.db, who.userId, today, amount);
  if (ranked.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.swipeNoCards));
  await deps.telegram.sendMessage(who.chatId, swipeReply(amount, ranked));
}

/** A typed statement total becomes a question about the gap, or a thank-you when there is none. */
async function proposeStatement(deps: BotDeps, who: Actor, cardId: string, statementDate: string, billedPaise: number, today: IstDate): Promise<void> {
  try {
    const a = await analyseStatement(deps.db, who.userId, cardId, billedPaise, today);
    if (a.facts.statementDate !== statementDate) return void (await deps.telegram.sendMessage(who.chatId, botVoice.statementGone));
    if (a.bookAs === null) {
      await recordCheck(deps.db, who.userId, cardId, a.facts.statementDate, a.facts.expectedPaise, billedPaise, "matched");
      return void (await deps.telegram.sendMessage(who.chatId, botVoice.statementMatches));
    }
    const id = await createStatementProposal(deps.db, who.userId, who.chatId, cardId, billedPaise, deps.now());
    const gap = formatRupees(Math.abs(a.differencePaise));
    const label = a.bookAs === "fee" ? `Add ${gap} as Fees & Charges` : a.bookAs === "spending" ? `Add ${gap} as unlogged spending` : `Add ${gap} as a credit`;
    await deps.telegram.sendMessage(who.chatId, botVoice.statementGap(a.facts.cardName, a.facts.expectedPaise, billedPaise, a.reason), [
      [{ text: label, data: `s:${id}:b` }],
      [{ text: "Leave it", data: `s:${id}:n` }],
    ]);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) return void (await deps.telegram.sendMessage(who.chatId, botVoice.statementGone));
    throw error;
  }
}

async function cmdLoans(deps: BotDeps, who: Actor): Promise<void> {
  const o = await listLoans(deps.db, who.userId, "active");
  await deps.telegram.sendMessage(who.chatId, loansReply(o.loans));
}

/** The weekly check: a typed bank balance becomes a question about the gap, or a thank-you when there is none. */
async function proposeBalance(deps: BotDeps, who: Actor, accountId: string, typedPaise: number, today: IstDate): Promise<void> {
  try {
    const p = await previewBalance(deps.db, who.userId, accountId, typedPaise, today);
    if (p.differencePaise === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.balanceMatches));
    const lower = p.differencePaise < 0;
    const gap = Math.abs(p.differencePaise);
    const id = await createBalanceProposal(deps.db, who.userId, who.chatId, accountId, typedPaise, deps.now());
    await deps.telegram.sendMessage(who.chatId, (lower ? botVoice.balanceLower : botVoice.balanceHigher)(p.accountName, p.alfredPaise, p.typedPaise, gap), [
      [{ text: lower ? `Book ${formatRupees(gap)} as unlogged spending` : `Book ${formatRupees(gap)} as unrecorded income`, data: `b:${id}:s` }],
      [{ text: "Leave it", data: `b:${id}:n` }],
    ]);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) return void (await deps.telegram.sendMessage(who.chatId, botVoice.balanceGone));
    throw error;
  }
}

/** Gives the quantity a purchase into a holding bought, then says what is held now. */
async function fixUnits(deps: BotDeps, who: Actor, txnId: string, unitsE4: number, today: IstDate): Promise<void> {
  try {
    const txn = await getTransactionRow(deps.db, who.userId, txnId);
    if (!txn?.holdingId) return void (await deps.telegram.sendMessage(who.chatId, botVoice.unitsGone));
    const h = await setEntryUnits(deps.db, who.userId, txn.holdingId, txnId, unitsE4, today);
    const word = unitWord(h.unitLabel);
    await deps.telegram.sendMessage(who.chatId, botVoice.unitsSet(h.name, `${unitsE4 / 10_000} ${word}`, `${h.unitsHeldE4 / 10_000} ${word}`));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) return void (await deps.telegram.sendMessage(who.chatId, botVoice.unitsGone));
    throw error;
  }
}

/** Sets what the bank took for one loan instalment, then says what is still owed. */
async function fixLoanAmount(deps: BotDeps, who: Actor, loanId: string, on: string, paise: number): Promise<void> {
  try {
    const loan = await setInstalmentTotal(deps.db, who.userId, loanId, on, paise);
    await deps.telegram.sendMessage(who.chatId, botVoice.loanFixed(loan.name, paise, loan.outstandingPaise));
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) return void (await deps.telegram.sendMessage(who.chatId, botVoice.loanGone));
    throw error;
  }
}

/** Sets what the statement shows for one EMI entry, then says how much is still to come. */
async function fixEmiAmount(deps: BotDeps, who: Actor, txnId: string, paise: number, today: IstDate, to?: Reply): Promise<void> {
  const say = (text: string) => (to ? reply(deps, to, text) : deps.telegram.sendMessage(who.chatId, text).then(() => undefined));
  const txn = await getTransactionRow(deps.db, who.userId, txnId);
  if (!txn || txn.source !== "emi" || !txn.emiPlanId || txn.emiInstalment === null) return await say(botVoice.emiGone);
  try {
    const plan = await setInstalmentAmount(deps.db, who.userId, txn.emiPlanId, txn.emiInstalment, paise, today);
    await say(botVoice.emiFixed(plan.title, txn.emiInstalment, paise, plan.toComePaise));
  } catch (error) {
    if (error instanceof ConflictError) return await say(botVoice.emiClosed);
    if (error instanceof NotFoundError) return await say(botVoice.emiGone);
    throw error;
  }
}

async function cmdInvest(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const o = await listHoldings(deps.db, who.userId, today, "active");
  await deps.telegram.sendMessage(who.chatId, investReply(o.holdings));
}

/** Types what a holding is worth now: "/value tata 15200". Which one is asked about when the words fit none or several. */
async function cmdValue(deps: BotDeps, who: Actor, arg: string, today: IstDate): Promise<void> {
  const tokens = arg.trim().split(/\s+/).filter(Boolean);
  // The amount is the last word that reads as one, or else the first ("/value 15200 tata").
  const last = tokens.length > 0 ? parseAmountToken(tokens[tokens.length - 1] as string) : null;
  const first = tokens.length > 1 ? parseAmountToken(tokens[0] as string) : null;
  const paise = last !== null ? last : first;
  const words = (last !== null ? tokens.slice(0, -1) : tokens.slice(1)).join(" ").toLowerCase();
  if (paise === null || tokens.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.valueNeedsAmount));
  const { holdings: active } = await listHoldings(deps.db, who.userId, today, "active");
  if (active.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.valueNoHoldings));
  const exact = active.filter((h) => h.name.toLowerCase() === words);
  const fits = exact.length ? exact : words ? active.filter((h) => h.name.toLowerCase().includes(words)) : active.length === 1 ? active : [];
  if (words && fits.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.valueNoMatch));
  if (fits.length !== 1) {
    await deps.telegram.sendMessage(who.chatId, botVoice.valueAskWhich(paise), rows((fits.length ? fits : active).slice(0, MAX_OPTIONS).map((h) => ({ text: h.accountName && active.filter((x) => x.name === h.name).length > 1 ? `${h.name} (${h.accountName})` : h.name, data: `i:${h.id}:v:${paise}` }))));
    return;
  }
  await setHoldingValue(deps, who, fits[0]!.id, paise, today, { chatId: who.chatId });
}

async function setHoldingValue(deps: BotDeps, who: Actor, holdingId: string, paise: number, today: IstDate, to: Reply): Promise<void> {
  try {
    // Counted by quantity, the number typed is the rate (gold: for 10 g); otherwise it is what the whole holding is worth.
    const row = await getHoldingRow(deps.db, who.userId, holdingId);
    const h = row?.tracking === "units" ? await setRate(deps.db, who.userId, holdingId, { ratePaise: paise }, today) : await setValue(deps.db, who.userId, holdingId, { valuePaise: paise }, today);
    await reply(deps, to, botVoice.valueSet(h.name, h.valuePaise, h.gainPaise));
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) return await reply(deps, to, botVoice.valueClosed);
    throw error;
  }
}

async function cmdRecurring(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const rules = await listRules(deps.db, who.userId, today);
  await deps.telegram.sendMessage(
    who.chatId,
    recurringReply(rules.map((r) => ({ title: r.title, type: r.type, amountPaise: r.amountPaise, accountName: r.accountName, repeat: r.repeat, nextDate: r.nextDate, mode: r.mode, status: r.status }))),
  );
}

async function cmdEmi(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  await deps.telegram.sendMessage(who.chatId, emiReply(await listPlans(deps.db, who.userId, today)));
}

async function cmdIpo(deps: BotDeps, who: Actor, arg: string, today: IstDate): Promise<void> {
  if (arg) return await startEntry(deps, who, arg, "expense", "command", "hold");
  const view = await holdsView(deps, who, today);
  if (!view) return void (await deps.telegram.sendMessage(who.chatId, botVoice.noHolds));
  await deps.telegram.sendMessage(who.chatId, view.text, view.buttons);
}

/** Moves an entry forward: ask for what is missing, ask for confirmation, or record it. */
async function advance(deps: BotDeps, who: Actor, c: BotContext, pending: PendingEntry, pendingId: string | null, to: Reply): Promise<void> {
  const { entry, mode, kind, cash } = pending;
  // A loan in cash needs no account.
  const need = cash ? null : nextNeed(entry);

  if (need) {
    const options = optionsFor(entry, need, c, kind);
    if (options.length === 0) {
      if (pendingId) await deletePending(deps.db, pendingId);
      await reply(deps, to, c.accounts.length === 0 ? botVoice.noAccountsYet : botVoice.noMatchingAccount);
      return;
    }
    const id = pendingId ?? (await createPending(deps.db, who.userId, who.chatId, pending, deps.now()));
    if (pendingId) await updatePending(deps.db, id, pending);
    const cashButton = kind === "lent" || kind === "borrowed" ? [[{ text: "Cash or not tracked", data: `p:${id}:a:cash` }]] : [];
    const buttons = [...rows(options.map((a) => ({ text: a.name, data: `p:${id}:a:${a.id}` }))), ...cashButton, [{ text: "Cancel", data: `p:${id}:no` }]];
    const summary = describeEntry(factsOf(entry, c));
    await reply(deps, to, kind === "hold" ? botVoice.askHoldAccount(summary) : kind ? botVoice.askDebtAccount(summary) : askAccount(entry.type, need, summary), buttons);
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
  if (kind === "hold") await recordHold(deps, who, entry, c, to);
  else if (kind) await recordDebt(deps, who, entry, c, to, kind, cash === true);
  else await recordEntry(deps, who, entry, c, to);
}

async function startEntry(deps: BotDeps, who: Actor, text: string, type: EntryType, mode: PendingEntry["mode"], kind?: PendingEntry["kind"]): Promise<void> {
  const c = await loadContext(deps.db, who.userId, todayIst(new Date(deps.now())));
  // Money is blocked in a bank account, so a word like "hdfc" can only mean the bank.
  const parseCtx = kind ? { ...parseContext(c), accounts: c.accounts.filter((a) => a.kind === "bank") } : parseContext(c);
  // "cash" says a loan did not go through a bank account.
  const cash = (kind === "lent" || kind === "borrowed") && /\b(cash|untracked)\b/i.test(text);
  const parsed = parseEntry(cash ? text.replace(/\b(cash|untracked)\b/gi, " ") : text, type, parseCtx);
  if (!parsed.ok) {
    const message = parsed.reason === "bad_date" ? botVoice.badDate : botVoice.noAmount;
    await deps.telegram.sendMessage(who.chatId, message);
    return;
  }
  await advance(deps, who, c, { mode, entry: parsed.entry, ...(kind && { kind }), ...(cash && { cash: true }) }, null, { chatId: who.chatId });
}

// ---------------------------------------------------------------------------------------------------------
// Questions: balance, due dates, today, summary, settings.
// ---------------------------------------------------------------------------------------------------------

async function cmdBalance(deps: BotDeps, who: Actor, today: IstDate): Promise<void> {
  const figures = await listAccountsWithFigures(deps.db, who.userId, today);
  if (figures.length === 0) return void (await deps.telegram.sendMessage(who.chatId, botVoice.noAccountsYet));
  const dtos = figures.map((f) => toAccountDto(f));
  const overview = balanceOverview(figures, undefined, await goalsSetAside(deps.db, who.userId), await holdingsValue(deps.db, who.userId, today), await loansOutstanding(deps.db, who.userId));

  const banks = dtos.filter((a) => a.kind === "bank");
  const cards = dtos.filter((a) => a.kind === "card");
  const lines = ["Here is where things stand."];
  if (banks.length) {
    lines.push("", "Bank accounts");
    for (const b of banks) {
      if (b.kind !== "bank") continue;
      const blocked = b.blockedPaise > 0 ? `, ${rupees(b.blockedPaise)} blocked` : "";
      lines.push(`${b.name}: ${rupees(b.balancePaise)}${blocked}${b.countsTowardSafeToSpend ? "" : " (set aside)"}`);
    }
  }
  if (cards.length) {
    lines.push("", "Credit cards");
    for (const k of cards) {
      if (k.kind !== "card") continue;
      const emi = k.emiToComePaise > 0 ? `, ${rupees(k.emiToComePaise)} in EMIs to come` : "";
      lines.push(`${k.name}: owes ${rupees(k.outstandingPaise)}, due ${shortDate(k.nextDueDate)}${emi}`);
    }
  }
  lines.push("", `Safe to spend: ${rupees(overview.safeToSpendPaise)}, as recorded.`);
  if (overview.blockedPaise > 0) lines.push(`Blocked for applications, not spendable: ${rupees(overview.blockedPaise)}.`);
  if (overview.goalsSetAsidePaise > 0) lines.push(`Put toward goals, not spendable: ${rupees(overview.goalsSetAsidePaise)}.`);
  if (overview.setAsidePaise > 0) lines.push(`Set aside, not counted: ${rupees(overview.setAsidePaise)}.`);
  if (overview.emiToComePaise > 0) lines.push(`EMIs still to be billed: ${rupees(overview.emiToComePaise)}. Net worth counts them; safe to spend does not, until they are billed.`);
  lines.push(`Net worth: ${rupees(overview.netWorthPaise)} (banks minus cards).`);
  const run = runwayLine(await getRunway(deps.db, who.userId, today));
  if (run) lines.push(run);
  const fund = emergencyLine(await getEmergencyFund(deps.db, who.userId, today));
  if (fund) lines.push(fund);
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
  lines.push("", "Adding, editing, merging and deleting are in the app, under Accounts and commitments.");

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
  const view = await getCommitments(deps.db, who.userId, today);
  const coming = view.items.filter((i) => !i.counted);
  if (cards.length === 0 && coming.length === 0) return void (await deps.telegram.sendMessage(who.chatId, "You have no credit cards on record."));
  const pending = cards.filter((c) => c.summary.statementOutstandingPaise > 0);
  if (pending.length === 0 && coming.length === 0) return void (await deps.telegram.sendMessage(who.chatId, "No card payments are pending."));
  const lines: string[] = [];
  if (pending.length > 0) {
    lines.push("Card payments coming up:");
    for (const c of pending) {
      lines.push(`${c.name}: ${rupees(c.summary.statementOutstandingPaise)} due ${shortDate(c.summary.nextDueDate)} (${inDays(daysBetween(today, c.summary.nextDueDate))})`);
    }
  }
  if (coming.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...commitmentsLines({ until: view.until, basis: view.basis, items: coming, safeToSpendPaise: view.safeToSpendPaise, freeToSpendPaise: view.freeToSpendPaise, commitmentsPaise: view.commitmentsPaise }));
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
      const label = t.merchant ?? (t.categoryId ? c.categoryNames.get(t.categoryId) : null) ?? (t.type === "bill_payment" ? "Card payment" : t.type === "transfer" ? "Transfer" : t.type === "investment" ? "Investment" : "Entry");
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
      settings.logNudge ? "I look in about 10:45 in the evening if nothing has been logged that day." : "I shall not check in on you in the evening.",
      settings.balanceCheck ? "On Sunday nights I ask what your banks show." : "I shall not ask for your bank balances on Sundays.",
      settings.monthlyReview ? "On the first morning of each month I send you a review of the one just ended." : "I shall not send a monthly review.",
      settings.morningPush ? "I send your briefing here each morning when something needs attention." : "I shall not send a morning briefing here unless you ask me to, in Settings.",
      "",
      "These can be changed in the app, under Everything, then Settings.",
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
    // An investment reads like a spend in a short summary: the amount, what it was for, and the account.
    type: t.type === "investment" || t.type === "investment_sale" || t.type === "loan_payment" || t.type === "debt_out" || t.type === "debt_in" ? "expense" : t.type,
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
    if (!command) {
      // After "Different amount", the next message is the figure from the statement.
      const waiting = await takeAmountFix(deps.db, userId, chatId, deps.now());
      if (waiting) {
        if (waiting.kind === "units") {
          const units = parseQuantityE4(text);
          if (units !== null) return await fixUnits(deps, who, waiting.txnId, units, today);
        } else if (waiting.kind === "statement") {
          const paise = parseAmountToken(text);
          if (paise !== null) return await proposeStatement(deps, who, waiting.cardId, waiting.statementDate, paise, today);
        } else if (waiting.kind === "balance") {
          const paise = parseAmountToken(text);
          if (paise !== null) return await proposeBalance(deps, who, waiting.accountId, paise, today);
        } else {
          const paise = parseAmountToken(text);
          if (paise !== null) return waiting.kind === "emi" ? await fixEmiAmount(deps, who, waiting.txnId, paise, today) : await fixLoanAmount(deps, who, waiting.loanId, waiting.on, paise);
        }
      }
      return await startEntry(deps, who, text, inferType(text), "text");
    }
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
      case "owed":
        return await cmdOwed(deps, who, today);
      case "lent":
        return await startEntry(deps, who, arg, "expense", "command", "lent");
      case "borrowed":
        return await startEntry(deps, who, arg, "expense", "command", "borrowed");
      case "recurring":
        return await cmdRecurring(deps, who, today);
      case "goals":
        return await cmdGoals(deps, who, today);
      case "loans":
        return await cmdLoans(deps, who);
      case "swipe":
        return await cmdSwipe(deps, who, arg, today);
      case "salary":
        return await cmdSalary(deps, who, today);
      case "whatif":
        return await cmdWhatIf(deps, who, arg, today);
      case "review":
        return await cmdReview(deps, who, today);
      case "fund":
        return await cmdFund(deps, who, today);
      case "invest":
      case "investments":
        return await cmdInvest(deps, who, today);
      case "value":
        return await cmdValue(deps, who, arg, today);
      case "menu":
        return await cmdMenu(deps, who);
      case "save":
        return await cmdSave(deps, who, arg, today);
      case "emi":
        return await cmdEmi(deps, who, today);
      case "ipo":
        return await cmdIpo(deps, who, arg, today);
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
        if (pending.kind === "hold") await recordHold(deps, who, pending.entry, c, to);
        else await recordEntry(deps, who, pending.entry, c, to);
      } else if (action === "a" && argument) {
        const need = nextNeed(pending.entry);
        const wantsCash = argument === "cash" && (pending.kind === "lent" || pending.kind === "borrowed");
        const allowed = need ? optionsFor(pending.entry, need, c, pending.kind).some((a) => a.id === argument) : false;
        if (wantsCash) {
          await advance(deps, who, c, { mode: pending.mode, entry: pending.entry, kind: pending.kind as "lent" | "borrowed", cash: true }, id, to);
        } else if (!need || !allowed) {
          await reply(deps, to, botVoice.noMatchingAccount);
        } else {
          const entry: ParsedEntry = { ...pending.entry, [need]: { status: "found", id: argument } as Resolution };
          await advance(deps, who, c, { mode: pending.mode, entry, ...(pending.kind && { kind: pending.kind }) }, id, to);
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
    } else if (kind === "f" && id && (action === "p" || action === "a" || action === "l" || action === "s" || action === "u")) {
      // A loan: a follow-up answered, or a just-noted loan undone.
      const today = todayIst(new Date(deps.now()));
      const row = await getDebtRow(deps.db, userId, id);
      const overview = await listDebts(deps.db, userId, today, "all");
      const person = overview.people.find((p) => p.debts.some((d) => d.id === id));
      const debt = person?.debts.find((d) => d.id === id);
      if (!row || !person || !debt) {
        await reply(deps, to, botVoice.debtSettled);
      } else if (action === "u") {
        if (debt.payments.length > 0) await reply(deps, to, botVoice.debtHasPayments);
        else {
          await deleteDebt(deps.db, userId, id);
          await reply(deps, to, botVoice.debtUndone);
        }
      } else if (row.status !== "open") {
        await reply(deps, to, botVoice.debtSettled);
      } else if (action === "p") {
        const banks = c.accounts.filter((a) => a.kind === "bank").slice(0, MAX_OPTIONS);
        await reply(deps, to, botVoice.askPaidAccount(person.name, debt.outstandingPaise), [
          ...rows(banks.map((a) => ({ text: a.name, data: `f:${id}:a:${a.id}` }))),
          [{ text: "Cash or not tracked", data: `f:${id}:a:cash` }],
        ]);
      } else if (action === "a") {
        const accountId = argument === "cash" ? null : (argument ?? null);
        if (accountId !== null && !c.accounts.some((a) => a.id === accountId && a.kind === "bank")) {
          await reply(deps, to, botVoice.noMatchingAccount);
        } else {
          const owed = debt.outstandingPaise;
          await settleDebt(deps.db, userId, id, { accountId }, "telegram", today);
          await reply(deps, to, botVoice.paidInFull(person.name, owed, accountId ? (c.accountNames.get(accountId) ?? null) : null));
        }
      } else if (action === "l") {
        await reply(deps, to, botVoice.followUpLater);
      } else {
        await updateDebt(deps.db, userId, id, { followUpStopped: true }, today);
        await reply(deps, to, botVoice.followUpStopped(person.name));
      }
    } else if (kind === "e" && id && (action === "y" || action === "d")) {
      // "Does your statement agree?" for an instalment Alfred just added.
      const txn = await getTransactionRow(deps.db, userId, id);
      if (!txn || txn.source !== "emi" || !txn.emiPlanId || txn.emiInstalment === null) {
        await reply(deps, to, botVoice.emiGone);
      } else if (action === "y") {
        await reply(deps, to, botVoice.emiAgrees);
      } else {
        await createEmiFix(deps.db, userId, chatId, id, deps.now());
        await reply(deps, to, botVoice.emiAskAmount(txn.merchant ?? "that plan", txn.emiInstalment));
      }
    } else if (kind === "l" && id && (action === "y" || action === "d") && argument) {
      // "Does that agree with your bank?" for a loan instalment Alfred just added.
      const loan = await getLoan(deps.db, userId, id).catch(() => null);
      const known = loan?.instalments.some((i) => i.loanOn === argument);
      if (!loan || !known) {
        await reply(deps, to, botVoice.loanGone);
      } else if (action === "y") {
        await reply(deps, to, botVoice.loanAgrees);
      } else {
        await createLoanFix(deps.db, userId, chatId, id, argument, deps.now());
        await reply(deps, to, botVoice.loanAskAmount(loan.name, argument));
      }
    } else if (kind === "z" && (id === "n" || id === "p")) {
      // The evening check-in: "Nothing today", or "Pause a week".
      const today = todayIst(new Date(deps.now()));
      if (id === "n") {
        await deps.db.insert(checkinLog).values({ id: newId(), userId, kind: "none_today", day: today, createdAt: nowIso() }).onConflictDoNothing();
        await reply(deps, to, botVoice.noneToday);
      } else {
        const until = addDays(today, 7);
        await updateSettings(deps.db, userId, { logNudgeUntil: until });
        await reply(deps, to, botVoice.logPaused(until));
      }
    } else if (kind === "y" && id) {
      // One of the usual spends, offered by the evening check-in: recorded again for today.
      const today = todayIst(new Date(deps.now()));
      const template = await getTransactionRow(deps.db, userId, id);
      if (!template || template.deletedAt !== null || template.type !== "expense" || !["web", "telegram", "ai"].includes(template.source)) {
        await reply(deps, { chatId }, botVoice.expired);
      } else {
        const txn = await createTransaction(
          deps.db,
          userId,
          { type: "expense", amountPaise: template.amountPaise, txnDate: today, accountId: template.accountId, categoryId: template.categoryId, merchant: template.merchant, note: template.note },
          { source: "telegram" },
        );
        await reply(deps, { chatId }, botVoice.recorded(summaryOfTxn(txn, c)), [[{ text: "Undo", data: `u:${txn.id}` }]]);
      }
    } else if (kind === "b" && id && (action === "y" || action === "d")) {
      // The weekly balance check: "Yes, it matches" or "Different".
      const account = await getAccount(deps.db, userId, id);
      if (!account || account.kind !== "bank" || account.archivedAt) {
        await reply(deps, to, botVoice.balanceGone);
      } else if (action === "y") {
        await reply(deps, to, botVoice.balanceMatches);
      } else {
        await createBalanceFix(deps.db, userId, chatId, id, deps.now());
        await reply(deps, to, botVoice.balanceAskAmount(account.name));
      }
    } else if (kind === "b" && id && (action === "s" || action === "n")) {
      // What to do about the gap the person's bank balance showed.
      const proposal = await getBalanceProposal(deps.db, userId, chatId, id, deps.now());
      if (!proposal) {
        await reply(deps, to, botVoice.balanceGone);
      } else {
        await removePending(deps.db, id);
        if (action === "n") {
          await reply(deps, to, botVoice.balanceLeft);
        } else {
          const done = await settleBalance(deps.db, userId, proposal.accountId, proposal.typedPaise, todayIst(new Date(deps.now())));
          await reply(deps, to, done.kind === "none" ? botVoice.balanceMatches : botVoice.balanceBooked(done.kind, done.bookedPaise, done.accountName, done.balancePaise));
        }
      }
    } else if (kind === "t" && id && (action === "y" || action === "n")) {
      // A suggested move into the emergency fund: "Record" once the money has moved at the bank, or "Not now".
      const proposal = await getTransferProposal(deps.db, userId, chatId, id, deps.now());
      if (!proposal) {
        await reply(deps, to, botVoice.expired);
      } else {
        await removePending(deps.db, id);
        if (action === "n") {
          await reply(deps, to, botVoice.transferLeft);
        } else {
          const [from, dest] = await Promise.all([getAccount(deps.db, userId, proposal.fromId), getAccount(deps.db, userId, proposal.toId)]);
          if (!from || !dest || from.kind !== "bank" || dest.kind !== "bank" || from.archivedAt || dest.archivedAt) {
            await reply(deps, to, botVoice.balanceGone);
          } else {
            const today = todayIst(new Date(deps.now()));
            const txn = await createTransaction(deps.db, userId, { type: "transfer", amountPaise: proposal.amountPaise, txnDate: today, accountId: from.id, toAccountId: dest.id }, { source: "telegram" });
            const fund = emergencyLine(await getEmergencyFund(deps.db, userId, today));
            await reply(deps, to, [botVoice.transferRecorded(rupees(proposal.amountPaise), from.name, dest.name), fund].filter(Boolean).join("\n"), [[{ text: "Undo", data: `u:${txn.id}` }]]);
          }
        }
      }
    } else if (kind === "s" && id && (action === "y" || action === "d") && argument) {
      // The statement question the day after a statement: "Yes, it matches" or "Different".
      const today = todayIst(new Date(deps.now()));
      const facts = await statementFacts(deps.db, userId, id, today).catch(() => null);
      if (!facts || facts.statementDate !== argument) {
        await reply(deps, to, botVoice.statementGone);
      } else if (action === "y") {
        await recordCheck(deps.db, userId, id, facts.statementDate, facts.expectedPaise, facts.expectedPaise, "matched");
        await reply(deps, to, botVoice.statementMatches);
      } else {
        await createStatementFix(deps.db, userId, chatId, id, facts.statementDate, deps.now());
        await reply(deps, to, botVoice.statementAskAmount(facts.cardName));
      }
    } else if (kind === "s" && id && (action === "b" || action === "n")) {
      // What to do about the gap the statement total showed.
      const proposal = await getStatementProposal(deps.db, userId, chatId, id, deps.now());
      if (!proposal) {
        await reply(deps, to, botVoice.statementGone);
      } else {
        await removePending(deps.db, id);
        if (action === "n") {
          const today = todayIst(new Date(deps.now()));
          const facts = await statementFacts(deps.db, userId, proposal.cardId, today).catch(() => null);
          if (facts) await recordCheck(deps.db, userId, proposal.cardId, facts.statementDate, facts.expectedPaise, proposal.billedPaise, "left");
          await reply(deps, to, botVoice.statementLeft);
        } else {
          const done = await settleStatement(deps.db, userId, proposal.cardId, proposal.billedPaise, todayIst(new Date(deps.now())));
          await reply(deps, to, done.kind === null ? botVoice.statementMatches : botVoice.statementBooked(done.kind, done.bookedPaise, done.cardName));
        }
      }
    } else if (kind === "q" && id) {
      // "Tell me": the next message is how much a purchase into a holding bought.
      const question = await unitsQuestionFor(deps.db, userId, id);
      if (!question) {
        await reply(deps, to, botVoice.unitsGone);
      } else {
        await createUnitsFix(deps.db, userId, chatId, id, deps.now());
        await reply(deps, to, botVoice.unitsAskNumber(question.word));
      }
    } else if (kind === "i" && id && action === "v") {
      // An investment chosen from several for "/value".
      const paise = Number(argument);
      if (Number.isSafeInteger(paise) && paise >= 0) await setHoldingValue(deps, who, id, paise, todayIst(new Date(deps.now())), to);
      else await reply(deps, to, botVoice.valueNoMatch);
    } else if (kind === "m" && id && MENU.some((m) => m.id === id)) {
      // A button on /menu: answers as the command would.
      await runMenuItem(deps, who, id, todayIst(new Date(deps.now())));
    } else if (kind === "g" && id && (action === "s" || action === "u")) {
      // Money put toward a goal: chosen from several goals, or just noted and undone.
      const today = todayIst(new Date(deps.now()));
      if (action === "s") {
        const paise = Number(argument);
        if (Number.isSafeInteger(paise) && paise > 0) await saveToGoal(deps, who, id, paise, today, to);
        else await reply(deps, to, botVoice.goalNoMatch);
      } else {
        try {
          await removeContribution(deps.db, userId, id, argument ?? "", today);
          await reply(deps, to, botVoice.goalUndone);
        } catch (error) {
          if (error instanceof NotFoundError || error instanceof ConflictError) await reply(deps, to, botVoice.goalClosed);
          else throw error;
        }
      }
    } else if (kind === "r" && id && (action === "ok" || action === "no")) {
      // A draft that a recurring rule added, being confirmed or discarded.
      const t = await getTransaction(deps.db, userId, id).catch(() => null);
      if (!t || t.source !== "recurring" || t.status !== "draft") {
        await reply(deps, to, botVoice.recurringSettled);
      } else if (action === "ok") {
        await updateTransaction(deps.db, userId, id, { status: "confirmed" });
        await reply(deps, to, botVoice.recurringConfirmed(t.merchant ?? "That entry"));
        // A SIP into gold, a fund or shares counted by quantity: ask how much it bought.
        const question = await unitsQuestionFor(deps.db, userId, id);
        if (question) await deps.telegram.sendMessage(chatId, question.text, [[{ text: "Tell me", data: `q:${id}` }]]);
      } else {
        await softDeleteTransaction(deps.db, userId, id);
        await reply(deps, to, botVoice.recurringDiscarded(t.merchant ?? "That entry"));
      }
    } else if (kind === "h" && id && (action === "a" || action === "n" || action === "u")) {
      const today = todayIst(new Date(deps.now()));
      let note: string;
      try {
        if (action === "u") {
          const row = await getHold(deps.db, userId, id);
          if (!row || row.status !== "active") throw new ConflictError("settled");
          await deleteHold(deps.db, userId, id);
          return await reply(deps, to, botVoice.holdRemoved);
        }
        if (action === "a") {
          const r = await allotHold(deps.db, userId, id, {}, "telegram", today);
          note = botVoice.holdAllotted(r.hold.title, r.transaction.amountPaise, r.hold.accountName);
        } else {
          const h = await releaseHold(deps.db, userId, id, today);
          note = botVoice.holdReleased(h.title, h.amountPaise, h.accountName);
        }
      } catch (error) {
        if (!(error instanceof ConflictError || error instanceof NotFoundError)) throw error;
        note = botVoice.holdAlreadySettled;
      }
      const view = await holdsView(deps, who, today, note);
      await reply(deps, to, view?.text ?? note, view?.buttons);
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
