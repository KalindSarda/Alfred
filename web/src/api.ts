export interface FieldDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: FieldDetail[],
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    // fetch sends same-origin cookies by default, which is all the session needs.
    headers: { "X-Requested-With": "fin", "Content-Type": "application/json", ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: FieldDetail[] } } | null)?.error;
    const retry = Number(res.headers.get("Retry-After"));
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? res.statusText,
      err?.details,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("POST", path, body ?? {}, headers),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

/** Turns an API failure into text a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details?.length) return error.details.map((d) => d.message).join(". ");
    if (error.status === 429 && error.retryAfter) {
      const minutes = Math.ceil(error.retryAfter / 60);
      return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return error.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

// ---- Response types (mirror 05-api-schema.md) ----

export interface Me {
  id: string;
  email: string;
  /** What Alfred calls the user. */
  displayName: string;
  telegramLinked: boolean;
  isOwner: boolean;
  /** True until the first-run setup guide has been finished or skipped. */
  needsSetup: boolean;
  settings: { nudgeLeadDays: number; nudgeTimeIst: string };
}

export interface BankAccount {
  id: string;
  kind: "bank";
  name: string;
  last4: string | null;
  openingBalancePaise: number;
  countsTowardSafeToSpend: boolean;
  /** Part of the emergency fund. */
  isEmergency: boolean;
  balancePaise: number;
  blockedPaise: number;
  availablePaise: number;
  archived: boolean;
  entryCount: number;
}

export interface CardAccount {
  id: string;
  kind: "card";
  name: string;
  last4: string | null;
  creditLimitPaise: number;
  statementDay: number;
  dueDay: number;
  openingOutstandingPaise: number;
  archived: boolean;
  entryCount: number;
  outstandingPaise: number;
  unbilledPaise: number;
  statementOutstandingPaise: number;
  emiToComePaise: number;
  availableCreditPaise: number;
  utilizationPct: number;
  nextStatementDate: string;
  nextDueDate: string;
}

export type Account = BankAccount | CardAccount;

export interface BalanceOverview {
  totalInBanksPaise: number;
  countedPaise: number;
  setAsidePaise: number;
  blockedPaise: number;
  cardsOwedPaise: number;
  emiToComePaise: number;
  owedToYouPaise: number;
  youOwePaise: number;
  goalsSetAsidePaise: number;
  investmentsPaise: number;
  loansPaise: number;
  netWorthPaise: number;
  safeToSpendPaise: number;
}

export interface Hold {
  id: string;
  accountId: string;
  accountName: string;
  title: string;
  amountPaise: number;
  appliedDate: string;
  expectedDate: string | null;
  status: "active" | "allotted" | "released";
  resolvedAt: string | null;
  resolvedTxnId: string | null;
  overdue: boolean;
}

export interface EmiPlan {
  id: string;
  cardAccountId: string;
  cardName: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  totalPaise: number;
  months: number;
  instalmentPaise: number;
  scheduleAmountsPaise: number[];
  uneven: boolean;
  startMonth: string;
  status: "active" | "finished" | "cancelled";
  billedCount: number;
  billedPaise: number;
  toComePaise: number;
  nextDate: string | null;
  nextAmountPaise: number | null;
  locked: boolean;
}

export interface RecurringRule {
  id: string;
  title: string;
  type: "expense" | "income" | "investment";
  amountPaise: number;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  holdingId: string | null;
  frequency: "weekly" | "monthly" | "yearly";
  day: number;
  month: number | null;
  repeat: string;
  startDate: string;
  endDate: string | null;
  mode: "auto" | "draft";
  remindDaysBefore: number | null;
  status: "active" | "paused" | "ended";
  nextDate: string | null;
  upcoming: string[];
  entries: number;
}

export interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
  archived: boolean;
  isSystem: boolean;
  /** Spending that cannot stop, which the runway is measured against. */
  essential: boolean;
  entryCount: number;
}

export type TxnType = "expense" | "income" | "transfer" | "bill_payment" | "investment" | "investment_sale" | "loan_payment" | "debt_out" | "debt_in";

export interface DebtPayment {
  id: string;
  amountPaise: number;
  date: string;
  accountName: string | null;
  note: string | null;
}

export interface Debt {
  id: string;
  direction: "lent" | "borrowed";
  amountPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  date: string;
  dueDate: string | null;
  note: string | null;
  status: "open" | "settled";
  forgiven: boolean;
  accountName: string | null;
  overdue: boolean;
  followUpStopped: boolean;
  nextFollowUp: string | null;
  payments: DebtPayment[];
}

export interface Person {
  contactId: string;
  name: string;
  trusted: boolean;
  owedToYouPaise: number;
  youOwePaise: number;
  debts: Debt[];
}

export interface DebtsOverview {
  owedToYouPaise: number;
  youOwePaise: number;
  people: Person[];
}

export interface Transaction {
  id: string;
  type: TxnType;
  amountPaise: number;
  txnDate: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  merchant: string | null;
  note: string | null;
  holdingId: string | null;
  status: "draft" | "confirmed";
  source: "web" | "telegram" | "seed" | "ai" | "emi" | "recurring" | "loan" | "check";
}

export interface Summary {
  period: { key: string; from: string; to: string };
  safeToSpendPaise: number;
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  previousExpensePaise: number;
  uncategorizedCount: number;
  draftCount: number;
}

export interface CashflowRow {
  key: string;
  categoryId: string | null;
  name: string;
  amountPaise: number;
  pctOfIncome: number;
}

export interface Cashflow {
  period: { key: string; from: string; to: string };
  groupBy: "category" | "merchant";
  incomePaise: number;
  expensePaise: number;
  surplusPaise: number;
  income: CashflowRow[];
  expenses: CashflowRow[];
}

export interface BudgetItem {
  categoryId: string;
  categoryName: string;
  limitPaise: number;
  spentPaise: number;
  remainingPaise: number;
  pct: number;
  status: "ok" | "near" | "over";
}

export interface Budgets {
  period: { from: string; to: string };
  totalLimitPaise: number;
  totalSpentPaise: number;
  items: BudgetItem[];
}

export interface BriefingLine {
  key: string;
  text: string;
  to?: string;
}

export interface Briefing {
  greeting: string;
  subline: string;
  lines: BriefingLine[];
  source: "template" | "ai";
  generatedAt: string;
  footer: string;
}

export interface Settings {
  nudgeLeadDays: number;
  nudgeTimeIst: string;
  sessionDays: number;
  displayName: string | null;
  periodStartDay: number;
  logNudge: boolean;
  balanceCheck: boolean;
  /** The evening check-in is paused through this day. */
  logNudgeUntil: string | null;
  morningPush: boolean;
  monthlyReview: boolean;
  emergencyMonths: number;
  emergencyTargetPaise: number | null;
  emergencyHorizonMonths: number;
  medicalTargetPaise: number | null;
  costlyDebtBp: number;
}

/** A card ranked for a purchase today: the longest time before the bill first. */
export interface RankedCard {
  id: string;
  name: string;
  statementDate: string;
  dueDate: string;
  days: number;
  availableCreditPaise: number;
  utilizationPct: number;
  fits: boolean;
  waitDate: string | null;
  waitDays: number | null;
}

export interface StatementFacts {
  cardId: string;
  cardName: string;
  statementDate: string;
  dueDate: string;
  expectedPaise: number;
  previousUnpaidPaise: number;
}

export interface StatementAnalysis {
  differencePaise: number;
  kind: "matches" | "fee_gst" | "interest" | "unrecorded" | "credit";
  reason: string;
  bookAs: "fee" | "spending" | "credit" | null;
  facts: StatementFacts;
  billedPaise: number;
}

export interface StatementSettled {
  kind: "fee" | "spending" | "credit" | null;
  bookedPaise: number;
  cardName: string;
}

export interface BalancePreview {
  accountId: string;
  accountName: string;
  alfredPaise: number;
  typedPaise: number;
  /** The bank's figure less Alfred's: negative means spending that was not logged. */
  differencePaise: number;
}

export interface BalanceSettled {
  kind: "spending" | "income" | "none";
  bookedPaise: number;
  accountName: string;
  balancePaise: number;
}

export interface GoalContribution {
  id: string;
  amountPaise: number;
  date: string;
  note: string | null;
}

export interface Goal {
  id: string;
  name: string;
  targetPaise: number;
  targetDate: string | null;
  status: "active" | "achieved" | "archived";
  savedPaise: number;
  remainingPaise: number;
  progressPct: number;
  monthlyNeededPaise: number | null;
  needsAttention: boolean;
  achievedAt: string | null;
  contributions: GoalContribution[];
}

export interface GoalsOverview {
  setAsidePaise: number;
  goals: Goal[];
}

export interface NetWorthPoint {
  month: string;
  asOf: string;
  netWorthPaise: number;
  investmentsPaise: number;
  loansPaise: number;
  banksPaise: number;
  cardsOwedPaise: number;
  emiToComePaise: number;
  owedToYouPaise: number;
  youOwePaise: number;
}

export interface EntryHints {
  /** One per merchant, the one used most recently first. */
  merchants: { merchant: string; categoryId: string | null; accountId: string; count: number }[];
  /** Accounts, the one used most recently first. */
  lastUsedAccountIds: string[];
}

export interface HoldingEntry {
  id: string;
  kind: "buy" | "sell";
  amountPaise: number;
  date: string;
  accountName: string | null;
  note: string | null;
  /** The quantity (1/10,000 units) when counted by quantity; null when missing, 0 when part of the quantity at the switch. */
  unitsE4: number | null;
}

export interface HoldingLot {
  id: string;
  date: string;
  unitsE4: number;
  costPaise: number;
  note: string | null;
}

export interface Holding {
  id: string;
  name: string;
  /** The key of its investment kind, and the kind's name. */
  kind: string;
  kindName: string;
  status: "active" | "closed";
  isEmergency: boolean;
  countsForFire: boolean;
  openingInvestedPaise: number;
  investedPaise: number;
  soldPaise: number;
  valuePaise: number;
  valueDate: string | null;
  staleDays: number | null;
  gainPaise: number;
  gainPct: number | null;
  entries: HoldingEntry[];
  values: { date: string; valuePaise: number; ratePaise: number | null }[];
  tracking: "value" | "units";
  unitLabel: string | null;
  unitOne: string | null;
  ratePer: number;
  unitsHeldE4: number;
  ratePaise: number | null;
  avgCostPaise: number | null;
  lots: HoldingLot[];
  missingUnits: number;
}

/** Something dated that is going to leave before the next salary. */
export interface Commitment {
  key: string;
  date: string;
  title: string;
  amountPaise: number;
  source: "card" | "emi" | "loan" | "recurring" | "debt" | "insurance";
  accountId: string | null;
  accountName: string | null;
  accountKind: "bank" | "card" | null;
  /** Already held back by safe-to-spend (a card bill), so not taken off again. */
  counted: boolean;
}

export interface CommitmentsView {
  from: string;
  /** The window ends just before this day. */
  until: string;
  basis: "salary" | "month";
  safeToSpendPaise: number;
  freeToSpendPaise: number;
  commitmentsPaise: number;
  items: Commitment[];
  shortfalls: { commitment: Commitment; balancePaise: number; shortByPaise: number }[];
}

/** A kind of investment (Gold, Silver, Mutual fund). A kind with a unit can be counted by quantity times a rate quoted for `ratePer` units. */
export interface HoldingKind {
  id: string;
  key: string;
  name: string;
  unit: string | null;
  unitOne: string | null;
  ratePer: 1 | 10 | 100 | 1000;
  archived: boolean;
  isSystem: boolean;
  holdingCount: number;
  locked: boolean;
}

export interface HoldingsOverview {
  totalValuePaise: number;
  totalInvestedPaise: number;
  gainPaise: number;
  holdings: Holding[];
}

/** One foundation: its ideal, how far along the person is, and where they stand. */
export interface FoundationRow {
  key: "starter" | "debt" | "cover" | "lifestyle" | "essentials" | "medical" | "fire";
  title: string;
  ideal: string;
  pct: number | null;
  status: "ok" | "building" | "attention";
  detail: string;
  amountPaise: number | null;
}

/** What runs alongside in a month. */
export interface Flows {
  investingPaise: number;
  premiumsPaise: number;
  leftOverPaise: number | null;
  leftOverLeanPaise: number | null;
  early: boolean;
}

export interface LadderView {
  rows: FoundationRow[];
  /** The one row to look at first, by rule; null when nothing needs attention. */
  attention: FoundationRow | null;
  costlyDebtBp: number;
  flows: Flows;
}

/** How much could safely move into the emergency fund today, and from where to where. */
export interface TransferView {
  none: "no_target" | "fund_complete" | "no_destination" | "no_source" | "no_history" | "nothing_movable" | null;
  amountPaise: number;
  movablePaise: number;
  cushionPaise: number;
  remainingPaise: number | null;
  freeToSpendPaise: number;
  until: string;
  daysLeft: number;
  gapPaise: number | null;
  from: { id: string; name: string; availablePaise: number } | null;
  to: { id: string; name: string; countsTowardSafeToSpend: boolean } | null;
}

/** A health or life cover the person holds, or has through work. */
export interface Policy {
  id: string;
  kind: "health" | "term" | "other";
  source: "personal" | "employer";
  insurer: string;
  coverPaise: number;
  premiumPaise: number;
  frequency: "yearly" | "half_yearly" | "quarterly" | "monthly";
  renewalDate: string;
  nextDueDate: string;
  daysToDue: number;
  note: string | null;
  status: "active" | "lapsed";
}

/** The protection check: the answers, the policies, and where there is no cover. */
export interface ProtectionView {
  profile: { dependants: "yes" | "no" | "partly" | "unknown"; employerHealth: "yes" | "no" | "unknown" };
  policies: Policy[];
  gaps: { key: string; severity: "high" | "medium" | "info"; title: string; detail: string }[];
  yearlyPremiumPaise: number;
}

/** Where financial independence stands: the number, the corpus toward it, and when the assumptions reach it. */
export interface FireView {
  assumptions: {
    ageNow: number | null;
    targetAge: number | null;
    monthlySpendPaise: number | null;
    spendIsDefault: boolean;
    withdrawalRateBp: number;
    inflationBp: number;
    returnBp: number;
    monthlySavingPaise: number | null;
    savingIsDefault: boolean;
    stepupBp: number;
  };
  early: boolean;
  basedOnDays: number;
  corpus: {
    totalPaise: number;
    bankPaise: number;
    holdingsPaise: number;
    holdings: { id: string; name: string; kindName: string; paise: number; counts: boolean; inEmergencyFund: boolean }[];
    emergencyNotMarked: boolean;
  };
  numberPaise: number | null;
  progressPct: number | null;
  projection: { months: number | null; years: number | null; year: number | null; age: number | null; reached: boolean } | null;
  coastPaise: number | null;
  coastReached: boolean | null;
  requiredSavingPaise: number | null;
  sensitivity: { key: "saving" | "spend" | "return"; months: number | null; deltaMonths: number | null }[];
}

/** Where the emergency fund stands: the target, what is flagged as the fund, and what is still missing. */
export interface FundLayer {
  targetPaise: number;
  fundedPaise: number;
  gapPaise: number;
  topUpPaise: number;
}

/** One way of judging the fund: months of spending (or a typed target) for living costs, plus the medical amount on top. */
export interface FundTarget {
  livingPaise: number | null;
  medicalPaise: number;
  totalPaise: number | null;
  fundedPaise: number;
  gapPaise: number | null;
  pct: number | null;
  /** Months to close the gap at a typical and at a lean month's surplus; null when nothing is left over, 0 when nothing is missing. */
  monthsAtTypical: number | null;
  monthsAtCautious: number | null;
}

/** What is left over each month after spending and after what already goes into investing and loan principal. */
export interface FundPace {
  typicalPaise: number;
  cautiousPaise: number;
  spentPaise: number;
  investingPaise: number;
  /** Complete months it rests on; 0 when it rests on the recent weeks scaled to a month. */
  cycles: number;
  early: boolean;
}

export interface EmergencyFund {
  months: number;
  horizonMonths: number;
  essentialsBurnPaise: number | null;
  lifestyleBurnPaise: number | null;
  monthsOnEssentials: number | null;
  monthsOnLifestyle: number | null;
  targets: { lifestyle: FundTarget; essentials: FundTarget };
  verdict: "none" | "building" | "essentials" | "complete";
  pace: FundPace | null;
  monthsIfSpendingLess: number | null;
  /** The lifestyle goal, which the ladder and the transfer suggestion work toward. */
  burnPaise: number | null;
  targetPaise: number | null;
  targetBasis: "burn" | "manual" | null;
  living: FundLayer | null;
  medical: FundLayer | null;
  fundedPaise: number;
  bankPaise: number;
  holdingsPaise: number;
  nothingFlagged: boolean;
  gapPaise: number | null;
  topUpPaise: number | null;
  fundedMonths: number | null;
  progressPct: number | null;
  liquidPaise: number;
  liquidMonths: number | null;
  early: boolean;
  basedOnDays: number;
  accounts: { id: string; name: string; paise: number }[];
  holdings: { id: string; name: string; paise: number }[];
}

/** How a month looked: what came in, what had to be spent, what was chosen, and what was saved. */
export interface MoneyHealth {
  period: { kind: "last" | "current"; from: string; to: string };
  empty: boolean;
  incomePaise: number;
  needsPaise: number;
  wantsPaise: number;
  spentPaise: number;
  savingsPaise: number;
  investedPaise: number;
  principalRepaidPaise: number;
  emiPaise: number;
  savingsRatePct: number | null;
  needsPct: number | null;
  wantsPct: number | null;
  emiBurdenPct: number | null;
  savingsBand: "strong" | "fair" | "low" | null;
  emiBand: "comfortable" | "stretched" | "heavy" | null;
  utilizationPct: number | null;
  runway: { months: number | null; burnPaise: number | null; solid: boolean; basedOnDays: number };
  netWorth: { endPaise: number; changePaise: number } | null;
}

/** How many months the bank money would last at what must be spent. */
export interface Runway {
  liquidPaise: number;
  burnPaise: number | null;
  months: number | null;
  basedOnDays: number;
  /** False when it rests on fewer than 60 days: an early estimate. */
  solid: boolean;
  windowFrom: string;
  essentialPaise: number;
}

export interface PrepayOutlook {
  months: number;
  interestPaise: number;
  emiPaise: number;
  lastDate: string | null;
}

/** What a part-payment would do to a loan, without recording it. */
export interface PrepaySim {
  loanName: string;
  amountPaise: number;
  effect: "shorten" | "lower";
  before: PrepayOutlook;
  after: PrepayOutlook;
  monthsSaved: number;
  interestSavedPaise: number;
  invest: { returnPct: number; months: number; gainPaise: number } | null;
}

export interface LoanInstalment {
  loanOn: string;
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
}

export interface Loan {
  id: string;
  name: string;
  lender: string | null;
  kind: "home" | "car" | "personal" | "education" | "other";
  accountId: string;
  accountName: string;
  dueDay: number;
  ratePct: number;
  emiPaise: number;
  status: "active" | "closed";
  outstandingPaise: number;
  repaidPaise: number;
  interestPaidPaise: number;
  monthsLeft: number;
  payoffDate: string | null;
  interestToGoPaise: number;
  nextDueDate: string | null;
  nextInstalment: { interestPaise: number; principalPaise: number; totalPaise: number } | null;
  instalments: LoanInstalment[];
}

export interface LoansOverview {
  totalOutstandingPaise: number;
  monthlyEmiPaise: number;
  loans: Loan[];
}

export interface LoanScheduleRow {
  n: number;
  date: string;
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
  balancePaise: number;
}
