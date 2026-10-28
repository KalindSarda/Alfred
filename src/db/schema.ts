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
    type: text("type", { enum: ["expense", "income", "transfer", "bill_payment"] }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    txnDate: text("txn_date").notNull(),
    accountId: text("account_id").notNull().references(() => accounts.id),
    toAccountId: text("to_account_id").references(() => accounts.id),
    categoryId: text("category_id").references(() => categories.id),
    merchant: text("merchant"),
    note: text("note"),
    status: text("status", { enum: ["draft", "confirmed"] }).notNull().default("confirmed"),
    source: text("source", { enum: ["web", "telegram", "seed", "ai"] }).notNull().default("web"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("txn_user_date_idx").on(t.userId, t.txnDate, t.id),
    index("txn_user_account_date_idx").on(t.userId, t.accountId, t.txnDate),
    index("txn_user_to_account_idx").on(t.userId, t.toAccountId),
    index("txn_user_category_date_idx").on(t.userId, t.categoryId, t.txnDate),
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

export const telegramLinkCodes = sqliteTable("telegram_link_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

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
});
