import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Money is integer paise. Dates are IST "YYYY-MM-DD" text; timestamps are ISO-8601 UTC text.
 * Every user-owned table carries user_id (see 03-architecture.md, Data model).
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: text("created_at").notNull(),
  /** The owner invites people and removes access. The first user is the owner. */
  isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
  /** Set when the owner removes someone's access; their data stays and access can be restored. */
  disabledAt: text("disabled_at"),
});

/** An email the owner has allowed to sign in. The account is created the first time they ask for a code. */
export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** What the owner said to call them; becomes their name until they change it. */
  name: text("name"),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  acceptedAt: text("accepted_at"),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: ["bank", "card"] }).notNull(),
    name: text("name").notNull(),
    last4: text("last4"),
    // bank
    openingBalancePaise: integer("opening_balance_paise").notNull().default(0),
    countsTowardSafeToSpend: integer("counts_toward_safe_to_spend", { mode: "boolean" }).notNull().default(true),
    // card
    creditLimitPaise: integer("credit_limit_paise"),
    statementDay: integer("statement_day"),
    dueDay: integer("due_day"),
    openingOutstandingPaise: integer("opening_outstanding_paise").notNull().default(0),
    archivedAt: text("archived_at"),
    /** Demo/seed accounts, removed together by "clear demo data". */
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("accounts_user_name_uq").on(t.userId, t.name),
    check("accounts_card_fields", sql`${t.kind} = 'bank' OR (${t.creditLimitPaise} IS NOT NULL AND ${t.creditLimitPaise} > 0 AND ${t.statementDay} IS NOT NULL AND ${t.statementDay} BETWEEN 1 AND 31 AND ${t.dueDay} IS NOT NULL AND ${t.dueDay} BETWEEN 1 AND 31)`),
  ],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["expense", "income"] }).notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("categories_user_kind_name_uq").on(t.userId, t.kind, t.name)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    type: text("type", { enum: ["expense", "income", "transfer", "bill_payment", "investment", "investment_sale", "loan_payment", "debt_out", "debt_in"] }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    txnDate: text("txn_date").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id),
    toAccountId: text("to_account_id").references(() => accounts.id),
    categoryId: text("category_id").references(() => categories.id),
    merchant: text("merchant"),
    note: text("note"),
    status: text("status", { enum: ["draft", "confirmed"] }).notNull().default("confirmed"),
    source: text("source", { enum: ["web", "telegram", "seed", "ai", "emi", "recurring", "loan"] }).notNull().default("web"),
    /** Set on the entries a recurring rule adds by itself, with the date it was due. No foreign key: rules and their entries are handled together in code. */
    recurringRuleId: text("recurring_rule_id"),
    recurringOn: text("recurring_on"),
    /** Set on the instalments an EMI plan adds by itself. No foreign key: plans and their entries are removed together in code. */
    emiPlanId: text("emi_plan_id"),
    emiInstalment: integer("emi_instalment"),
    /** The holding an investment (a purchase) or an investment_sale (proceeds) belongs to. No foreign key: holdings and their entries are handled together in code. */
    holdingId: text("holding_id"),
    /** Set on the entries a loan instalment makes (interest and principal), with the due date. Managed under Loans. */
    loanId: text("loan_id"),
    loanOn: text("loan_on"),
    /** The quantity bought or sold (in 1/10,000 of a unit) on an entry linked to a holding counted by quantity. */
    unitsE4: integer("units_e4"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("txn_user_date_idx").on(t.userId, t.txnDate, t.id),
    index("txn_user_account_date_idx").on(t.userId, t.accountId, t.txnDate),
    index("txn_user_to_account_idx").on(t.userId, t.toAccountId),
    index("txn_user_category_date_idx").on(t.userId, t.categoryId, t.txnDate),
    index("txn_holding_idx").on(t.holdingId),
    // One interest entry and one principal entry per due date; a removed one is never created again.
    uniqueIndex("txn_loan_instalment_uq").on(t.loanId, t.loanOn, t.type),
    // An instalment can be created only once, and a deleted one is never created again.
    uniqueIndex("txn_emi_instalment_uq").on(t.emiPlanId, t.emiInstalment),
    // An occurrence of a recurring rule is created once, and a deleted one is never created again.
    uniqueIndex("txn_recurring_occurrence_uq").on(t.recurringRuleId, t.recurringOn),
    check("txn_amount_positive", sql`${t.amountPaise} > 0`),
    check(
      "txn_transfer_shape",
      sql`(${t.type} IN ('transfer', 'bill_payment') AND ${t.toAccountId} IS NOT NULL AND ${t.toAccountId} <> ${t.accountId} AND ${t.categoryId} IS NULL) OR (${t.type} NOT IN ('transfer', 'bill_payment') AND ${t.toAccountId} IS NULL)`,
    ),
  ],
);

export const merchantAliases = sqliteTable(
  "merchant_aliases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    alias: text("alias").notNull(),
    merchant: text("merchant").notNull(),
    defaultCategoryId: text("default_category_id").references(() => categories.id),
  },
  (t) => [uniqueIndex("merchant_aliases_user_alias_uq").on(t.userId, t.alias)],
);

/** Only the HMAC of the session token is stored, never the token itself. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** One-time login codes; only a keyed hash of the code is stored. */
export const loginCodes = sqliteTable(
  "login_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    codeHash: text("code_hash").notNull(),
    channel: text("channel", { enum: ["telegram", "email"] }).notNull(),
    expiresAt: text("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("login_codes_user_idx").on(t.userId, t.createdAt)],
);

/** Fixed-window counters. The key is a hash, so arbitrary emails or IPs are never stored in clear. */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: integer("window_start").notNull(),
});

export const telegramLinks = sqliteTable(
  "telegram_links",
  {
    userId: text("user_id").primaryKey().references(() => users.id),
    chatId: text("chat_id").notNull(),
    linkedAt: text("linked_at").notNull(),
  },
  (t) => [uniqueIndex("telegram_links_chat_uq").on(t.chatId)],
);

export const telegramLinkCodes = sqliteTable(
  "telegram_link_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    codeHash: text("code_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [uniqueIndex("telegram_link_codes_hash_uq").on(t.codeHash)],
);

/**
 * A half-finished entry from the bot (waiting for you to choose an account, or to confirm). Buttons carry only
 * this short id, because Telegram limits callback data to 64 bytes.
 */
export const botPending = sqliteTable(
  "bot_pending",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    chatId: text("chat_id").notNull(),
    payload: text("payload").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("bot_pending_expiry_idx").on(t.expiresAt)],
);

/** Telegram retries updates it thinks failed; remembering each update id makes handling idempotent. */
export const telegramUpdates = sqliteTable("telegram_updates", {
  updateId: integer("update_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
});

/**
 * One recurring monthly limit per expense category. "Monthly" means the user's own month (their start day),
 * so a budget always reads against the cycle they are living in.
 */
export const budgets = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    categoryId: text("category_id").notNull().references(() => categories.id),
    limitPaise: integer("limit_paise").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("budgets_user_category_uq").on(t.userId, t.categoryId), check("budgets_limit_positive", sql`${t.limitPaise} > 0`)],
);

/** A person money is lent to or borrowed from. A trusted person is never followed up with about what they owe. */
export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    /** The name in lower case and single-spaced, so "Rahul" and "rahul " are the same person. */
    nameKey: text("name_key").notNull(),
    trusted: integer("trusted", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("contacts_user_name_uq").on(t.userId, t.nameKey)],
);

/**
 * Money lent to someone (they owe you) or borrowed from someone (you owe them). When a bank account is chosen the
 * money moves through it as a debt_out or debt_in entry, never as spending or income; "cash or not tracked" records
 * only the debt. What is still owed is the amount less the payments.
 */
export const debts = sqliteTable(
  "debts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    contactId: text("contact_id").notNull().references(() => contacts.id),
    direction: text("direction", { enum: ["lent", "borrowed"] }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    date: text("date").notNull(),
    dueDate: text("due_date"),
    note: text("note"),
    /** The bank account the money moved through, and the entry it made; null for cash or untracked. */
    accountId: text("account_id").references(() => accounts.id),
    txnId: text("txn_id"),
    status: text("status", { enum: ["open", "settled"] }).notNull().default("open"),
    settledAt: text("settled_at"),
    /** Written off without being paid back. */
    forgiven: integer("forgiven", { mode: "boolean" }).notNull().default(false),
    /** The last day Alfred asked about it; the next ask is counted from here. */
    lastFollowupOn: text("last_followup_on"),
    followUpStopped: integer("follow_up_stopped", { mode: "boolean" }).notNull().default(false),
    /** Borrowed only: 0 nothing sent, 1 the day-before reminder sent, 2 the due-day one sent. */
    remindStage: integer("remind_stage").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("debts_user_status_idx").on(t.userId, t.status), check("debts_amount_positive", sql`${t.amountPaise} > 0`)],
);

/** A repayment against a debt, optionally through a bank account (and then with its own debt_in or debt_out entry). */
export const debtPayments = sqliteTable(
  "debt_payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    debtId: text("debt_id").notNull().references(() => debts.id),
    amountPaise: integer("amount_paise").notNull(),
    date: text("date").notNull(),
    accountId: text("account_id").references(() => accounts.id),
    txnId: text("txn_id"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("debt_payments_debt_idx").on(t.debtId), check("debt_payments_amount_positive", sql`${t.amountPaise} > 0`)],
);

/**
 * Something that repeats: rent, a subscription, salary, a SIP. On each due date an entry is added by itself, either
 * confirmed ("auto") or as a draft for the person to confirm or correct ("draft", for amounts that vary).
 */
export const recurringRules = sqliteTable(
  "recurring_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    type: text("type", { enum: ["expense", "income", "investment"] }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id),
    categoryId: text("category_id").references(() => categories.id),
    frequency: text("frequency", { enum: ["weekly", "monthly", "yearly"] }).notNull(),
    /** Weekly: 1 (Monday) to 7 (Sunday). Monthly and yearly: the day of the month, a day the month lacks becoming its last. */
    day: integer("day").notNull(),
    /** Yearly only: 1 to 12. */
    month: integer("month"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    mode: text("mode", { enum: ["auto", "draft"] }).notNull().default("auto"),
    /** Days ahead (1 to 7) to be told about the next one; null for no reminder. */
    remindDaysBefore: integer("remind_days_before"),
    /** The due date Alfred last reminded about, so he reminds once per occurrence. */
    lastRemindedFor: text("last_reminded_for"),
    /** Due dates that were skipped on purpose (a skipped one, or the days a pause covered), as a JSON list. */
    skipsJson: text("skips_json"),
    pausedAt: text("paused_at"),
    /** An investment rule (a SIP) can add to a holding: the entries it makes carry the link. */
    holdingId: text("holding_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("recurring_rules_user_idx").on(t.userId),
    check("recurring_amount_positive", sql`${t.amountPaise} > 0`),
    check("recurring_day_range", sql`${t.day} BETWEEN 1 AND 31`),
  ],
);

/**
 * A purchase converted to equal monthly instalments on a credit card (a phone on a 6-month EMI). The whole amount
 * stays owed on the card, but each statement asks only for that month's instalment, so the instalments are added as
 * ordinary expenses on the card, one a month, on the card's statement day.
 */
export const emiPlans = sqliteTable(
  "emi_plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    cardAccountId: text("card_account_id").notNull().references(() => accounts.id),
    title: text("title").notNull(),
    categoryId: text("category_id").references(() => categories.id),
    /** What the instalments add up to, interest included. */
    totalPaise: integer("total_paise").notNull(),
    months: integer("months").notNull(),
    instalmentPaise: integer("instalment_paise").notNull(),
    /** The month of the first instalment's statement, "YYYY-MM". */
    startMonth: text("start_month").notNull(),
    /** The exact amount of each instalment as a JSON list, when the bank's schedule is uneven (a smaller first one, a rounded last one). Null means an even split. */
    amountsJson: text("amounts_json"),
    createdAt: text("created_at").notNull(),
    /** Set when the plan was closed early; instalments already added stay. */
    cancelledAt: text("cancelled_at"),
  },
  (t) => [
    index("emi_plans_user_idx").on(t.userId),
    check("emi_total_positive", sql`${t.totalPaise} > 0`),
    check("emi_instalment_positive", sql`${t.instalmentPaise} > 0`),
    check("emi_months_range", sql`${t.months} BETWEEN 1 AND 60`),
  ],
);

/**
 * Money blocked in a bank account while it waits on something, such as an IPO application paid by UPI mandate.
 * It is not a transaction: the balance does not change until the money is really debited (allotted), but what
 * can be spent is lower while the block lasts. Released holds and allotted ones stay as history.
 */
export const holds = sqliteTable(
  "holds",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    accountId: text("account_id").notNull().references(() => accounts.id),
    title: text("title").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    appliedDate: text("applied_date").notNull(),
    /** When the outcome is due (the allotment date); Alfred asks then. */
    expectedDate: text("expected_date"),
    status: text("status", { enum: ["active", "allotted", "released"] }).notNull().default("active"),
    resolvedAt: text("resolved_at"),
    /** The investment entry created when the application was allotted. */
    resolvedTxnId: text("resolved_txn_id"),
    /** The day Alfred asked about the outcome, so he asks once. */
    remindedOn: text("reminded_on"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("holds_user_status_idx").on(t.userId, t.status), check("holds_amount_positive", sql`${t.amountPaise} > 0`)],
);

/** One row per card payment announced, so Alfred mentions each due date once however often the job runs. */
export const nudgeLog = sqliteTable(
  "nudge_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    cardAccountId: text("card_account_id").notNull().references(() => accounts.id),
    dueDate: text("due_date").notNull(),
    sentAt: text("sent_at").notNull(),
  },
  (t) => [uniqueIndex("nudge_log_card_due_uq").on(t.userId, t.cardAccountId, t.dueDate)],
);

/** Lets a retried POST /api/transactions (flaky mobile network) return the original instead of duplicating. */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull().references(() => users.id),
    key: text("key").notNull(),
    transactionId: text("transaction_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("idempotency_user_key_uq").on(t.userId, t.key)],
);

export const appSettings = sqliteTable("app_settings", {
  userId: text("user_id").primaryKey().references(() => users.id),
  nudgeLeadDays: integer("nudge_lead_days").notNull().default(3),
  nudgeTimeIst: text("nudge_time_ist").notNull().default("10:00"),
  sessionDays: integer("session_days").notNull().default(30),
  /** How Alfred addresses the user; when null a name is derived from the email. */
  displayName: text("display_name"),
  /** Day the user's month starts on (their payday, say). 1 means calendar months. */
  periodStartDay: integer("period_start_day").notNull().default(1),
  /** When the first-run setup guide was finished or skipped; null means it should still be offered. */
  onboardedAt: text("onboarded_at"),
});

/**
 * A savings goal. Money put toward it is only set aside: it stays in the bank, but is taken off safe-to-spend
 * while the goal is active. What has been saved is the sum of its contributions.
 */
export const goals = sqliteTable(
  "goals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    targetPaise: integer("target_paise").notNull(),
    targetDate: text("target_date"),
    status: text("status", { enum: ["active", "achieved", "archived"] }).notNull().default("active"),
    achievedAt: text("achieved_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("goals_user_status_idx").on(t.userId, t.status), check("goals_target_positive", sql`${t.targetPaise} > 0`)],
);

/** Money put toward a goal (positive) or taken back out of it (negative). */
export const goalContributions = sqliteTable(
  "goal_contributions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    goalId: text("goal_id").notNull().references(() => goals.id),
    amountPaise: integer("amount_paise").notNull(),
    date: text("date").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("goal_contributions_goal_idx").on(t.goalId), check("goal_contributions_nonzero", sql`${t.amountPaise} <> 0`)],
);

/**
 * Something owned that is worth money: shares, an IPO allotment, gold, crypto. Its value is typed by hand
 * (holding_values); what was put in comes from the investment entries linked to it, plus what was invested
 * before Alfred tracked it.
 */
export const holdings = sqliteTable(
  "holdings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    /** The `key` of one of the person's holding_kinds (the built-in ones keep the keys stock, fund, gold, crypto, other). */
    kind: text("kind").notNull(),
    /** Invested before it was tracked here, with no bank entry. */
    openingInvestedPaise: integer("opening_invested_paise").notNull().default(0),
    /** value: the worth is typed. units: the worth is the quantity held times a typed rate. */
    tracking: text("tracking", { enum: ["value", "units"] }).notNull().default("value"),
    /** Held before tracking, in 1/10,000 of a unit (only when tracked by quantity). */
    openingUnitsE4: integer("opening_units_e4").notNull().default(0),
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("holdings_user_status_idx").on(t.userId, t.status), check("holdings_opening_nonnegative", sql`${t.openingInvestedPaise} >= 0`)],
);

/**
 * A kind of investment the person can choose: Gold, Silver, Mutual fund. A kind with a unit (g, units, shares, coins) lets a
 * holding be counted by quantity times a rate quoted for `ratePer` units; a kind without one is valued by typing.
 * `holdings.kind` stores the `key`: the built-in kinds keep their old names, custom kinds get a generated id.
 */
export const holdingKinds = sqliteTable(
  "holding_kinds",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    unit: text("unit"),
    ratePer: integer("rate_per").notNull().default(1),
    /** Stock (what an IPO allotment creates) and Other (the fallback) cannot be deleted, merged away or archived. */
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("holding_kinds_user_key_uq").on(t.userId, t.key), check("holding_kinds_rate_per", sql`${t.ratePer} IN (1, 10, 100, 1000)`)],
);

/** A purchase made before tracking, with no bank entry: its quantity, what it cost and the day. Only for holdings counted by quantity. */
export const holdingLots = sqliteTable(
  "holding_lots",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    holdingId: text("holding_id").notNull().references(() => holdings.id),
    date: text("date").notNull(),
    unitsE4: integer("units_e4").notNull(),
    costPaise: integer("cost_paise").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("holding_lots_holding_idx").on(t.holdingId), check("holding_lots_positive", sql`${t.unitsE4} > 0 AND ${t.costPaise} >= 0`)],
);

/** What a holding was worth on a day, as typed. One per holding per day: a second value that day replaces the first. */
export const holdingValues = sqliteTable(
  "holding_values",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    holdingId: text("holding_id").notNull().references(() => holdings.id),
    date: text("date").notNull(),
    valuePaise: integer("value_paise").notNull(),
    /** The rate typed (for the holding's rate quantity), when it is counted by quantity. */
    ratePaise: integer("rate_paise"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("holding_values_day_uq").on(t.holdingId, t.date), check("holding_values_nonnegative", sql`${t.valuePaise} >= 0`)],
);

/**
 * A bank loan. What is still owed is `principalPaise` (outstanding when tracking began) less the principal repaid since,
 * which comes from the loan_payment entries; interest is each month's outstanding at the rate. Instalments are added on
 * the due date from the paying bank.
 */
export const loans = sqliteTable(
  "loans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    lender: text("lender"),
    kind: text("kind", { enum: ["home", "car", "personal", "education", "other"] }).notNull(),
    /** The bank account the instalments are paid from. */
    accountId: text("account_id").notNull().references(() => accounts.id),
    dueDay: integer("due_day").notNull(),
    /** Outstanding when Alfred began tracking it. */
    principalPaise: integer("principal_paise").notNull(),
    anchorDate: text("anchor_date").notNull(),
    /** Yearly rate in basis points: 16.5% is 1650. */
    ratePctBp: integer("rate_pct_bp").notNull(),
    emiPaise: integer("emi_paise").notNull(),
    /** The first instalment Alfred adds. */
    firstDueDate: text("first_due_date").notNull(),
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("loans_user_status_idx").on(t.userId, t.status),
    check("loans_principal_positive", sql`${t.principalPaise} > 0`),
    check("loans_emi_positive", sql`${t.emiPaise} > 0`),
    check("loans_due_day", sql`${t.dueDay} BETWEEN 1 AND 31`),
  ],
);
