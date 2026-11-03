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
    type: text("type", { enum: ["expense", "income", "transfer", "bill_payment", "investment"] }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    txnDate: text("txn_date").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id),
    toAccountId: text("to_account_id").references(() => accounts.id),
    categoryId: text("category_id").references(() => categories.id),
    merchant: text("merchant"),
    note: text("note"),
    status: text("status", { enum: ["draft", "confirmed"] }).notNull().default("confirmed"),
    source: text("source", { enum: ["web", "telegram", "seed", "ai", "emi"] }).notNull().default("web"),
    /** Set on the instalments an EMI plan adds by itself. No foreign key: plans and their entries are removed together in code. */
    emiPlanId: text("emi_plan_id"),
    emiInstalment: integer("emi_instalment"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("txn_user_date_idx").on(t.userId, t.txnDate, t.id),
    index("txn_user_account_date_idx").on(t.userId, t.accountId, t.txnDate),
    index("txn_user_to_account_idx").on(t.userId, t.toAccountId),
    index("txn_user_category_date_idx").on(t.userId, t.categoryId, t.txnDate),
    // An instalment can be created only once, and a deleted one is never created again.
    uniqueIndex("txn_emi_instalment_uq").on(t.emiPlanId, t.emiInstalment),
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
