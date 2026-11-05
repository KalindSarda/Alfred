---
stage: api-schema
generated_by: dev-api-skill
stack:
  backend: typescript-cloudflare-workers-hono
  frontend: react-vite-tailwind-pwa
based_on: [.claude-sdlc/outputs/03-architecture.md, .claude-sdlc/outputs/01-requirements.md]
status: draft
---

# API & Schema — Personal Finance App

## Conventions
- **Stack idiom:** Hono routes, Zod schemas as the single source of truth (types inferred with `z.infer`, shared with `web/`). Every route validates input with `zValidator` and returns a typed body. Never accept or return untyped objects. Validation failures return 422 with field detail.
- **Base path / versioning:** plain `/api/*`, no version prefix (first-party PWA deployed together with the API). Add `/api/v2` only if a second client appears.
- **Auth:** session cookie `sid` (HttpOnly, Secure, SameSite=Lax, 30 days). Applied by one session middleware on the `/api` group; public routes are listed explicitly below. Every handler gets `userId` from context and passes it to services. Nothing reads a user id from the request body.
- **CSRF:** all non-GET `/api` requests must send `Content-Type: application/json` (except export GETs) and header `X-Requested-With: fin`; otherwise 403 `csrf_failed`. Combined with SameSite=Lax.
- **Money:** integer paise in INR (`amountPaise`), always a positive integer; sign comes from `type`. Never floats.
- **Dates:** `YYYY-MM-DD` IST calendar dates (`txnDate`); timestamps are ISO-8601 UTC strings. Months are `YYYY-MM`.
- **IDs:** opaque strings (ULID).
- **JSON naming:** camelCase on the wire; snake_case only in the DB.
- **Error envelope** (one shape everywhere, mapped centrally in `app.onError`):
  ```json
  { "error": { "code": "validation_failed", "message": "Human-readable", "details": [{ "path": "amountPaise", "message": "Must be > 0" }] } }
  ```
  `details` optional. Codes: `validation_failed` 422, `unauthenticated` 401, `csrf_failed` 403, `forbidden` 403, `not_found` 404, `conflict` 409, `rate_limited` 429 (with `Retry-After`), `invalid_code` 400, `internal` 500 (no internals leaked).
- **Pagination:** cursor-based for lists that can grow (transactions). Query `?limit=` (default 50, max 200) and `?cursor=`; response `{ items, nextCursor }` (`nextCursor` null at end). Cursor is an opaque base64 of `(txnDate, id)`; order is `txnDate desc, id desc`. Small bounded lists (accounts, categories, budgets) return `{ items }` unpaginated.
- **Tenant scoping:** a resource owned by another user returns 404 (never 403) to avoid leaking existence.
- **Sync only:** everything is request/response; no long-running jobs in v1 (export is built in-request at personal scale).
- **Idempotency:** `POST /api/transactions` accepts optional header `Idempotency-Key` (stored briefly) so retries from flaky mobile networks don't duplicate.
- **Docs:** generate OpenAPI from the Zod schemas (`@hono/zod-openapi`) and serve `GET /api/openapi.json` behind auth in non-production only. Keep the Postman collection in sync if one is added.

### Shared schemas (Zod)
```ts
const Paise = z.number().int().positive();
const IstDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Id = z.string().min(1);

export const TransactionType = z.enum(["expense", "income", "transfer"]);
export const TxnStatus = z.enum(["draft", "confirmed"]);

export const CreateTransaction = z.object({
  type: TransactionType,
  amountPaise: Paise,
  txnDate: IstDate,                       // defaults to today IST if omitted by bot; web sends it
  accountId: Id,                          // source account (bank or card)
  toAccountId: Id.optional(),             // required iff type === "transfer"
  categoryId: Id.nullable().optional(),   // null/omitted => Uncategorized; must be omitted for transfer
  merchant: z.string().trim().max(80).optional(),
  note: z.string().trim().max(280).optional(),
  status: TxnStatus.default("confirmed"),
}).superRefine((v, ctx) => {
  if (v.type === "transfer" && (!v.toAccountId || v.toAccountId === v.accountId))
    ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Transfer needs a different destination account" });
  if (v.type !== "transfer" && v.toAccountId)
    ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Only transfers have a destination" });
  if (v.type === "transfer" && v.categoryId)
    ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Transfers have no category" });
});

export const Transaction = z.object({
  id: Id, type: TransactionType, amountPaise: Paise, txnDate: IstDate,
  accountId: Id, toAccountId: Id.nullable(), categoryId: Id.nullable(),
  merchant: z.string().nullable(), note: z.string().nullable(),
  status: TxnStatus, source: z.enum(["web", "telegram", "seed", "ai"]),
  createdAt: z.string(), updatedAt: z.string(),
});

export const BankAccount = z.object({
  id: Id, kind: z.literal("bank"), name: z.string(), last4: z.string().regex(/^\d{4}$/).nullable(),
  openingBalancePaise: z.number().int(), countsTowardSafeToSpend: z.boolean(),
  balancePaise: z.number().int(), archived: z.boolean(),
});
export const CardAccount = z.object({
  id: Id, kind: z.literal("card"), name: z.string(), last4: z.string().regex(/^\d{4}$/).nullable(),
  creditLimitPaise: Paise, statementDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31), openingOutstandingPaise: z.number().int().min(0),
  archived: z.boolean(),
  // computed
  outstandingPaise: z.number().int(), unbilledPaise: z.number().int(),
  statementOutstandingPaise: z.number().int(), utilizationPct: z.number(),
  nextStatementDate: IstDate, nextDueDate: IstDate,
});
```
Error cases common to every authenticated endpoint: 401 `unauthenticated`, 403 `csrf_failed` (non-GET), 429 `rate_limited` on abuse.

## Endpoints

### Auth (public unless noted)

#### POST /api/auth/request-code
- **Purpose:** send a one-time login code to the linked Telegram chat (default) or email.
- **Request:** `{ email: string (email), channel?: "telegram" | "email" }` (channel defaults to telegram; falls back to email if no chat is linked).
- **Response 202:** `{ ok: true }` — identical whether or not the email is registered.
- **Errors:** 422 invalid email; 429 rate limit (per email and per IP). Never reveals account existence.
- **Auth:** public. CSRF header still required.

#### POST /api/auth/verify-code
- **Purpose:** exchange a code for a session.
- **Request:** `{ email: string, code: string /^\d{6}$/ }`
- **Response 200:** `{ user: { id, email, telegramLinked: boolean } }` + `Set-Cookie: sid=...`
- **Errors:** 400 `invalid_code` (wrong, expired, used or attempts exhausted; one message for all); 422; 429.
- **Auth:** public.

#### POST /api/auth/logout
- Deletes the current session, clears cookie. **200** `{ ok: true }`. Auth: session.

#### POST /api/auth/logout-all
- Deletes every session for the user. **200** `{ ok: true }`. Auth: session.

#### GET /api/me
- **Response 200:** `{ id, email, telegramLinked: boolean, settings: { nudgeLeadDays, nudgeTimeIst } }`. **Errors:** 401. Auth: session.

#### POST /api/telegram/link-code
- **Purpose:** generate a one-time code the user sends to the bot (`/start <code>`) to link their chat.
- **Response 201:** `{ code: string, expiresAt: string }` (shown once; only hash stored).
- **Errors:** 409 `conflict` if already linked (unlink first). Auth: session.

#### DELETE /api/telegram/link
- Unlinks the chat. **204**. Auth: session. (Email fallback must exist, so this is always allowed.)

### Accounts and cards

#### GET /api/accounts
- **Response 200:** `{ items: (BankAccount | CardAccount)[] }` with computed balances and card figures. Query `?includeArchived=true` optional. Auth: session.

#### POST /api/accounts
- **Request:** discriminated union on `kind`:
  - bank: `{ kind: "bank", name (1–40), last4?, openingBalancePaise (int, may be negative), countsTowardSafeToSpend? (default true) }`
  - card: `{ kind: "card", name, last4?, creditLimitPaise, statementDay (1–31), dueDay (1–31), openingOutstandingPaise (>=0, default 0) }`
- **Response 201:** the created account. **Errors:** 422; 409 duplicate name. Auth: session.

#### PATCH /api/accounts/:id
- Partial update of the fields above (not `kind`). Changing a card's statement/due day affects computed cycles only, never stored transactions. **200** account; 404; 422.

#### POST /api/accounts/:id/archive  /  POST /api/accounts/:id/unarchive
- Soft archive. **200** account. **409** `conflict` is not used; archived accounts keep history. 404.

### Transactions

#### GET /api/transactions
- **Query:** `limit`, `cursor`, `from` (IstDate), `to` (IstDate), `accountId`, `categoryId` (or `none` for uncategorized), `type`, `status`, `q` (text over merchant and note, max 80).
- **Response 200:** `{ items: Transaction[], nextCursor: string | null }`; excludes soft-deleted. **Errors:** 422 bad cursor/params. Auth: session.

#### POST /api/transactions
- **Purpose:** the single create contract shared with the Telegram bot.
- **Request:** `CreateTransaction`. **Headers:** optional `Idempotency-Key`.
- **Response 201:** `Transaction`.
- **Rules enforced in the service:** card bill payment is a `transfer` bank→card; `income` on a card reduces its owed; accounts must belong to the user and not be archived; category must exist, be unarchived and match kind (income vs expense).
- **Errors:** 422 schema or rule violations; 404 account/category not found. Auth: session.

#### GET /api/transactions/:id
- **200** `Transaction`; 404.

#### PATCH /api/transactions/:id
- **Request:** any subset of `CreateTransaction` fields (rules re-validated on the merged result). **200** `Transaction`; 404; 422.

#### DELETE /api/transactions/:id
- Soft delete (sets `deletedAt`). **204**; 404. Balances update immediately.

#### POST /api/transactions/:id/confirm
- Draft → confirmed (used by the later AI flow and the review queue). **200** `Transaction`; 409 if not a draft; 404.

#### POST /api/transactions/:id/restore
- Undo of soft delete (bot `/undo` uses the service; web uses this). **200**; 404.

### Categories

#### GET /api/categories
- **200** `{ items: { id, name, kind: "expense" | "income", archived, isSystem }[] }`. Auth: session.

#### POST /api/categories
- **Request:** `{ name (1–40), kind }`. **201**; **409** duplicate name within kind; 422.

#### PATCH /api/categories/:id
- Rename and/or archive: `{ name?, archived? }`. **200**; 404; 409. The seeded income category **Cashback** can be archived but not deleted or renamed (`isSystem`): 409 `conflict`.

### Budgets

#### GET /api/budgets?month=YYYY-MM
- **200** `{ month, items: { categoryId, limitPaise, spentPaise, remainingPaise, status: "ok" | "near" | "over" }[] }` (`near` ≥ 80%). `month` defaults to current IST month. Auth: session.

#### PUT /api/budgets/:categoryId/:month
- Upsert a limit. **Request:** `{ limitPaise: int >= 0 }` (0 removes the limit). **200** the budget item; 404 category; 422.

### Dashboard (read-only, aggregated in SQL)

Period param shared by dashboard endpoints: `period` = `7d | 30d | 90d | this_month | last_month | ytd` (default `30d`), resolved server-side in IST. Response echoes resolved `from`/`to`.

#### GET /api/dashboard/summary
- **200:** `{ period: { key, from, to }, safeToSpendPaise, incomePaise, expensePaise, netPaise, reviewCount }`. Safe-to-spend = flagged bank balances − total card owed (period-independent). Income/expense exclude transfers, drafts and deleted rows. Auth: session.

#### GET /api/dashboard/cashflow
- **Query:** `period`, optional `groupBy=category|merchant` (default category).
- **200:**
  ```ts
  { period, incomePaise, expensePaise, surplusPaise,
    sources: { categoryId: string|null, name: string, amountPaise: number, pctOfIncome: number }[],
    expenses: { categoryId: string|null, name: string, amountPaise: number, pctOfIncome: number }[], // null id => "Uncategorized"
    pnl: { income: PnlRow[], expenses: PnlRow[] } }   // PnlRow = row + optional `transactionsUrl`
  ```
  `surplusPaise` = income − expense (may be negative). Transfers excluded. The same payload feeds the Sankey and the Profit and loss view; rows expand by calling `GET /api/transactions` with the row's filters. Auth: session.

#### GET /api/dashboard/cashback?month=YYYY-MM
- **200** `{ month, totalPaise, perAccount: { accountId, name, amountPaise }[] }` derived from income entries in the Cashback category. Auth: session.

### Settings

#### GET /api/settings  /  PATCH /api/settings
- **Shape:** `{ nudgeLeadDays: int 1–7 (default 3), nudgeTimeIst: "HH:mm" (default "10:00"), sessionDays: int 1–90 (default 30) }`. PATCH takes a partial. **200**; 422. Note: the cron runs once daily at a fixed UTC time, so `nudgeTimeIst` is informational until a finer schedule exists (documented, not a bug).

### Demo data

#### POST /api/demo-data
- Seed dummy accounts/transactions (`source = "seed"`). **201** `{ created: number }`; 409 if real data already exists. Auth: session.

#### DELETE /api/demo-data
- Removes every `source = "seed"` row in one action. **200** `{ deleted: number }`.

### Export

#### GET /api/export/json
- **200** `application/json`, `Content-Disposition: attachment`: `{ exportedAt, version: 1, accounts, categories, transactions, budgets, settings }` (includes soft-deleted flag, excludes secrets, sessions and codes). Auth: session.

#### GET /api/export/csv
- **200** `text/csv`: one row per non-deleted transaction with IST date, type, amount in rupees (formatted from paise), account, to-account, category, merchant, note, status. Cells starting with `= + - @` are prefixed with `'` to prevent spreadsheet formula injection. Auth: session.

### Telegram (machine-facing, not under the session middleware)

#### POST /telegram/webhook
- **Purpose:** receive Telegram updates.
- **Request:** Telegram `Update` object, validated with a Zod subset (`message.text`, `message.chat.id`, `callback_query`).
- **Auth:** header `X-Telegram-Bot-Api-Secret-Token` must equal the Worker secret (constant-time compare), else 401 and no processing. Chat ID must equal the linked chat, otherwise the update is ignored silently (still 200 so Telegram doesn't retry). A `/start <code>` from an unlinked chat is the one exception, used only to complete linking.
- **Response:** always `200 {}` after auth, even when the command fails (errors are reported as a bot reply, not an HTTP error, to stop Telegram retries). Updates are deduplicated on `update_id`.
- **Commands (grammar owned by the bot service):** `/add <amount> [category] [merchant words]`, `/undo`, `/today`, `/balance`, `/due`, `/start <linkcode>`. Bot-created rows use the same `CreateTransaction` contract and `source = "telegram"`.

### Internal (no HTTP route)
- `scheduled(event, env)`: daily nudge job. Not exposed; documented here so it is not forgotten when reviewing the API surface.

## Example requests/responses

**Card bill payment (a transfer, never an expense)**
```http
POST /api/transactions
Content-Type: application/json
X-Requested-With: fin
Idempotency-Key: 01J9ZK3Q7M2X
Cookie: sid=…

{ "type": "transfer", "amountPaise": 4500000, "txnDate": "2026-11-10",
  "accountId": "acc_hdfc_bank", "toAccountId": "acc_hdfc_millennia", "note": "Oct bill" }
```
```http
201 Created
{ "id": "01J9ZK3Q8A", "type": "transfer", "amountPaise": 4500000, "txnDate": "2026-11-10",
  "accountId": "acc_hdfc_bank", "toAccountId": "acc_hdfc_millennia", "categoryId": null,
  "merchant": null, "note": "Oct bill", "status": "confirmed", "source": "web",
  "createdAt": "2026-11-10T04:41:12Z", "updatedAt": "2026-11-10T04:41:12Z" }
```
Effect: HDFC bank balance −₹45,000; Millennia owed −₹45,000; safe-to-spend unchanged; cash flow unchanged.

**Validation error**
```http
POST /api/transactions   { "type": "transfer", "amountPaise": 100, "txnDate": "2026-11-10", "accountId": "a1" }

422 Unprocessable Entity
{ "error": { "code": "validation_failed", "message": "Request validation failed",
  "details": [{ "path": "toAccountId", "message": "Transfer needs a different destination account" }] } }
```

**Wrong code**
```http
POST /api/auth/verify-code   { "email": "me@example.com", "code": "123456" }

400 Bad Request
{ "error": { "code": "invalid_code", "message": "That code is invalid or has expired" } }
```

## Notes for implementers and reviewers
- One Zod file per resource under `src/schemas/`; routes import them, never redefine.
- `userId` must come from the session middleware only; reviewers should flag any query lacking it.
- Webhook and auth routes need their own rate-limit and secret checks, since they sit outside normal session middleware.
- Open items: exact bot command grammar (dev-prompt/spec stage), default category list, OpenAPI exposure policy.

## Revision history
- 2026-10-27, after first user testing. Changes to the contract above (the code is the source of truth where they differ):
  - **New transaction type `bill_payment`.** Types are now `expense | income | transfer | bill_payment`. A transfer is bank to bank only; a bill payment is bank (accountId) to credit card (toAccountId). Both are "movements": no category, never counted as income or expense, excluded from cash flow and budgets. Transfers with a card on either side are rejected with 422 (`accountId` or `toAccountId` detail). Existing bank-to-card transfers were migrated to `bill_payment`.
  - **`GET /api/transactions`** adds filters `minAmountPaise`, `maxAmountPaise` (422 if min > max), and `categoryId` now accepts a comma-separated list plus `none`. `q` also matches category name and account names. The response gains `totals: { count, incomePaise, expensePaise }` for everything the filters match (ignores paging; sums only confirmed income and expense).
  - **`GET /api/accounts`** now returns `{ items, overview }`. `overview` = `{ totalInBanksPaise, countedPaise, setAsidePaise, cardsOwedPaise, netWorthPaise, safeToSpendPaise }` over active accounts (net worth = banks minus cards).
  - **`GET /api/dashboard/summary`**: `reviewCount` replaced by `uncategorizedCount` and `draftCount`; adds `previousExpensePaise` (equal-length period before).
  - **`GET /api/dashboard/review`** (new): `{ uncategorizedCount, draftCount }`, for the navigation badge.
  - **`GET /api/dashboard/cashflow?period=&groupBy=category|merchant`** (new): `{ period, groupBy, incomePaise, expensePaise, surplusPaise, income: Row[], expenses: Row[] }` with `Row = { key, categoryId, name, amountPaise, pctOfIncome }`. Replaces the `sources`/`pnl` shape sketched earlier; one payload feeds the Sankey, Profit and loss and breakdown cards.
  - **`GET /api/alfred/briefing`** (new): `{ greeting, subline, lines: [{ key, text, to? }], source: "template" | "ai", generatedAt, footer }`, built server-side from recorded facts by `src/alfred/voice.ts`. `source` becomes `"ai"` when the model phrases it.
  - **`/api/settings`** and **`/api/me`** add `displayName` (what Alfred calls the user; `null` in settings falls back to a name derived from the email).
- 2026-10-28, Telegram bot and Slice 7 (budgets and reminders). The code is the source of truth where it differs:
  - **Budgets** (`/api/budgets`, session): `GET /` returns `{ period: {from,to}, totalLimitPaise, totalSpentPaise, items: [{ categoryId, categoryName, limitPaise, spentPaise, remainingPaise, pct, status }] }` for the user's current cycle (the month starting on `periodStartDay`), most pressed first. `status` is `ok` below 80%, `near` from 80% up to the limit, `over` beyond it. Spent counts confirmed expenses only (bank or card), never drafts, deleted entries, income or movements. `PUT /:categoryId { limitPaise: int > 0 }` creates or replaces one budget and returns the same body as GET (422 for an income or archived category or a bad limit, 404 for another user's category). `DELETE /:categoryId` is 204, or 404 when there is none. One budget per category.
  - **Telegram commands** now: `/start`, `/help`, `/add`, `/income`, `/pay`, `/transfer`, `/undo`, `/today`, `/balance`, `/budget` (alias `/budgets`), `/due` (alias `/upcoming`), `/summary`, `/settings`, plus plain-text entries that are confirmed with a button tap. Inline-button callbacks: `p:` (account pick), `u:` (undo), `d:` (discard), `c:` (category pick), `k:` (confirm). A receipt for a spend in a budgeted category adds one line on what remains (or that it is close to, or over, the limit).
  - **Internal daily job** (`scheduled`, cron `30 4 * * *`, 10:00 IST): `runNudges` sends one combined Telegram reminder per linked user for cards with a statement balance due within `nudgeLeadDays`, once per card and due date (`nudge_log`, written only after the send succeeds), then `runMaintenance` purges expired sessions, login codes, link codes, pending bot state, rate-limit rows and old update ids. Local trigger: `curl "http://localhost:8787/__scheduled?cron=30+4+*+*+*"`.
  - **Briefing** gains a `budget` line (only when a budget is near or over; at most two named, the rest counted) linking to `/budgets`.
  - **Schema:** migration `0008_budgets_nudges` adds `budgets` and `nudge_log`.
- 2026-10-28, Slice 8 (export and hardening):
  - **`GET /api/export/json`** returns `{ exportedAt, version: 1, accounts, categories, transactions, budgets, settings }` as an attachment (`alfred-export-<date>.json`). Rows are the stored columns without `userId`; deleted transactions are included (`deletedAt` set). **`GET /api/export/csv`** (`alfred-transactions-<date>.csv`) has `date,type,amount_rupees,account,to_account,category,merchant,note,status`, one row per non-deleted entry, oldest first, amounts as positive rupees without grouping, CRLF line ends, formula-looking cells prefixed with `'`. Both need a session and share a limit of 10 per hour per user (429 with `Retry-After`).
  - **Security headers** on every Worker response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. The static app gets its own set, with a Content-Security-Policy that allows only same-origin scripts, from `web/public/_headers`.
  - **Rate limits reviewed:** sign-in code requests (per IP and per email), code attempts (per IP and per code), Telegram link attempts (per chat) and exports (per user) are limited; the webhook is protected by its secret. Other session routes are not rate limited, by design for a single user.
- 2026-10-29, Slice 9a (category management):
  - **`GET /api/categories`** items gain `entryCount` (live entries filed under the category). **`DELETE /api/categories/:id`** (204) removes a category only when no live entry uses it (409 with the count otherwise, and 409 for the system category); its budget is removed with it, merchant shortcuts lose their default, and already-deleted entries are detached. **`POST /api/categories/:id/merge { intoId }`** (200 `{ movedEntries }`) moves every entry and merchant shortcut into another category of the same kind and removes the source; the target keeps its own budget, and the source's budget moves across only when the target has none. 422 for the same category, a different kind or an archived target; 409 for the system category as source; 404 for another user's category.
  - **Telegram:** `/category` lists active categories; `/category add <name>` adds an expense category and `/category add income <name>` an income one (alias `/categories`). Renaming, merging and deleting stay in the app (More, Categories).
- 2026-10-29, Slice 9b (account and card management):
  - **`GET /api/accounts`** items gain `entryCount` (live entries touching the account; a transfer or bill payment counts for both ends). **`DELETE /api/accounts/:id`** (204) removes an account only when no live entry touches it (409 with the count otherwise); entries already deleted go with it. **`POST /api/accounts/:id/merge { intoId }`** (200 `{ movedEntries, removedTransfers }`) moves every entry to another account of the same kind and removes the source. The target keeps its own name, limit and statement days; the source's opening balance (bank) or opening amount owed (card) is added to the target's. Transfers between the two cancel out, so they are removed permanently; balances and totals are unchanged. 422 for a different kind, the same account or an archived target; 404 for another user's account. Merging an archived account into an active one adds its figures to the totals.
  - **Telegram:** `/accounts` lists active accounts and cards with an Archive button each, archived ones with Restore (callbacks `a:<id>:x` and `a:<id>:r`, scoped to the signed-in user). A card that still owes money cannot be archived and the bot says why. Creating, editing, merging and deleting stay in the app.
- 2026-10-29, Slice 9c (invites, people, first-run setup). Migration `0009_people_invites`: `invites` table, `users.is_owner` and `users.disabled_at`, `app_settings.onboarded_at`. The migration marks the earliest user as owner and marks users who already have accounts as set up.
  - **Sign-up is invite-only.** `POST /api/auth/request-code` for an email with no account but a pending invitation creates the account (settings and default categories) and sends the code; for any other unknown email nothing happens and the response is identical (202). A person whose access was removed gets no code, cannot verify an earlier one, and any existing session stops working at once.
  - **`GET /api/me`** adds `isOwner` and `needsSetup` (true until setup is finished or skipped). **`POST /api/me/onboarded`** marks it done and returns the same body as `GET /api/me`.
  - **`/api/people`** (owner only, 403 otherwise): `GET /` returns `{ members: [{ id, email, name, isOwner, disabled, createdAt }], invites: [{ id, email, createdAt }] }` (pending invitations only). `POST /invites { email }` (201 `{ invite, emailed }`) creates or refreshes an invitation and emails it; 409 if the person already has an account; limited to 20 a day (429). `DELETE /invites/:id` (204) withdraws a pending one (404 otherwise). `POST /:id/disable` removes access (sessions and unused codes are deleted, data kept) and `POST /:id/enable` restores it; both return the people list. `DELETE /:id` (204) permanently deletes a person and everything they own, only after access was removed (409 otherwise). The owner cannot be removed (409).
  - A person whose access was removed is ignored by the Telegram bot and skipped by the daily reminders.
- 2026-10-29, invitation wording and invitee name. Migration `0010_invite_name` adds `invites.name`. **`POST /api/people/invites`** accepts an optional `name` (trimmed, up to 40 characters; empty means none; 422 if longer). The invitation email greets them by name ("Good day, Priya.") and is written in Alfred's own voice; when they first sign in their display name starts as that name. Pending invitations in `GET /api/people` carry `name`. Inviting again keeps the earlier name unless a new one is given.
- 2026-10-30, Slice 9d (sign-out, invite link, delete my account):
  - **`DELETE /api/me`** with `{ email }` (strict; the address must match the account's, case-insensitively, else 422 with a detail on `email`) permanently deletes the signed-in person and everything they own, clears the session cookie and returns 204. The owner gets 409 (the owner's account cannot be deleted from the app). Limited to 5 attempts an hour (429). The invitation record stays, so the address gets nothing until the owner invites it again; they then start with an empty ledger.
  - **Invitation link** is `<site>/#invite=<email>`. The address sits in the URL fragment, which browsers never send to a server, so it appears in no log. The app uses it to pre-fill sign-in, or, when the browser is signed in as someone else, to show a notice with "Sign out and continue". The email button reads "Open ledger".
  - Web: sign out and sign out everywhere now return to the sign-in screen at once (the cached "me" is set to null before other cached data is dropped).
- 2026-11-03, Slice 10 (blocked funds and the investment type). Migration `0011_holds` adds `holds`.
  - **`investment` transaction type:** money leaving a bank account for shares, IPOs or funds. Bank only, no category, no destination (422 otherwise). It lowers the bank balance but is never income or expense: excluded from cash flow, summary totals, budgets, the uncategorised count and the review badge. `GET /api/transactions?type=investment` and the CSV export carry it.
  - **Blocked funds (`/api/holds`, session):** a hold is money blocked in a bank account (an IPO application paid by UPI mandate). `GET /` (`?status=active|all`, default active; active first by soonest outcome date, then history) returns `{ items: [{ id, accountId, accountName, title, amountPaise, appliedDate, expectedDate, status: active|allotted|released, resolvedAt, resolvedTxnId, overdue }] }`. `POST /` `{ accountId, title, amountPaise, appliedDate?, expectedDate? }` (201; bank accounts only, not archived). `PATCH /:id` edits an active hold (409 once settled). `POST /:id/release` (not allotted: nothing debited). `POST /:id/allot { amountPaise?, date? }` records an `investment` on the account for the blocked amount or a lower one (422 if higher), settles the hold and returns `{ hold, transaction }`; if the entry cannot be made the hold stays active. Settling is atomic, so only one of two simultaneous requests wins (the other gets 409). `DELETE /:id` removes a mistaken active or released hold (409 if allotted). 404 for another person's hold.
  - **Figures:** bank account DTOs gain `blockedPaise` and `availablePaise` (balance less blocked). `BalanceOverview` gains `blockedPaise` (blocked in accounts counted toward safe-to-spend); **`safeToSpendPaise` = counted balances - blocked - card owed** here and in `GET /api/dashboard/summary`. Net worth and total-in-banks are unchanged (blocked money is still yours).
  - Holds follow their account: merging accounts moves them, deleting an account is refused while any is active, deleting demo data or a person removes them, and the JSON export gains `holds`.
  - **Daily job:** for each active hold whose `expectedDate` has arrived and that was not yet asked about, one Telegram message "Was it allotted?" with Allotted / Not allotted buttons (callbacks `h:<id>:a` and `h:<id>:n`), once per outcome date.
  - **Telegram:** `/ipo` lists active blocks with buttons; `/ipo 15000 hdfc tata tech` blocks an amount (the account words can only mean a bank; the usual account question appears if unclear; Undo removes it). `/balance` shows blocked amounts. The Alfred briefing gains a `blocked` line.
- 2026-11-03, Slice 11 (card EMI plans). Migration `0012_emi_plans` adds `emi_plans` and, on `transactions`, `emi_plan_id` and `emi_instalment` (unique together, so an instalment is created once and a deleted one is not recreated). `transactions.source` gains `emi`.
  - **Model:** a purchase converted to equal monthly instalments on a credit card. The whole amount stays held against the card's limit, but each statement asks only for that month's instalment, so each instalment is added automatically as an ordinary **expense on the card**, dated on the card's statement day (clamped in short months), merchant = the plan's name, note "EMI 2 of 6", the plan's category, source `emi`. Spending in cash flow and budgets is therefore spread over the instalment months. The original purchase is not also logged.
  - **`/api/emi-plans` (session):** `GET /` returns `{ items: [{ id, cardAccountId, cardName, title, categoryId, categoryName, totalPaise, months, instalmentPaise, startMonth, status: active|finished|cancelled, billedCount, billedPaise, toComePaise, nextDate, nextAmountPaise, locked }] }`, running plans first. `POST /` `{ cardAccountId, title, categoryId?, totalPaise, months (1-60), instalmentPaise?, startMonth "YYYY-MM", replacesTransactionId? }` (201): `totalPaise` is the amount converted; when `instalmentPaise` is given (an instalment that includes interest) the plan's total becomes instalment times months. Without it the total is split evenly in whole paise with the remainder on the last instalment. Instalments whose statement date has already come are added at once (backfill). `replacesTransactionId` soft-deletes an expense already logged on the same card for this purchase (422 if it is not one, 404 if unknown). `PATCH /:id` changes the name and category (also on instalments already added); amounts, months and start month only while no instalment exists (409 afterwards). `POST /:id/cancel` closes the plan early (foreclosure): instalments added stay, nothing further is added or owed here. `DELETE /:id` removes a plan with no instalments (409 otherwise). 422 for a bank or archived card, an income or archived category, months out of range, an unreachable instalment or extra fields; 404 for another person's card, plan or transaction.
  - **Figures:** card DTOs gain `emiToComePaise` (instalments not yet billed) and `availableCreditPaise` (limit minus owed minus emiToCome); `utilizationPct` counts what the EMIs still hold back. `BalanceOverview` gains `emiToComePaise`; **net worth subtracts it, safe-to-spend does not** (instalments reduce safe-to-spend as they are billed), and `cardsOwedPaise` stays the billed amount. Statement and due amounts need no special case: each statement holds that month's instalment plus other spending.
  - Plans follow their card: merging cards moves them (their instalments then follow the target's statement day); a card with a running plan cannot be deleted or archived; the person-delete and the JSON export (`emiPlans`) cover them.
  - **Daily job:** adds due instalments for everyone before card reminders are worked out, with catch-up for missed days.
  - **Telegram:** `/emi` lists running plans with progress, what is still to come and the next instalment; `/balance` shows EMIs on the card and in total. The briefing gains an `emi` line.
- 2026-11-04, EMI plan corrections. `PATCH /api/emi-plans/:id` can now change the amounts, months and start month at any time while the plan is open: instalments already added are removed and re-added from the new details (409 on a closed plan; reopen it first). New `POST /api/emi-plans/:id/reopen` (409 if not closed) reopens a closed plan and adds instalments that have since come due. `DELETE /api/emi-plans/:id` with `?instalments=remove` deletes the plan together with the instalment entries it added (without the flag, 409 when instalments exist).
- 2026-11-04, EMI plans with the bank's own amounts. Migration `0013_emi_amounts` adds `emi_plans.amounts_json`. `POST /api/emi-plans` and `PATCH /api/emi-plans/:id` accept `instalmentsPaise: number[]`, every instalment's exact amount in order (length must equal `months`, all positive; 422 otherwise). The plan's total is their sum, and `totalPaise` becomes optional when this is given. This covers real schedules where the first instalment is smaller (part-month interest) and the last is rounded. `GET` plans gain `uneven` (typed schedule) and `scheduleAmountsPaise` (every instalment in order). Changing `months`, `totalPaise` or `instalmentPaise` without a list goes back to an even split; changing only `startMonth` keeps a typed schedule.
- 2026-11-05, Slice 12 (web only, no API change). The Accounts page has two views, **Accounts** (net worth, banks, cards) and **Commitments** (blocked funds, EMI plans, and the later recurring, lent and borrowed, and goals sections), chosen by `?view=commitments` in the address. The briefing lines for blocked funds and EMIs link to `/accounts?view=commitments`.
- 2026-11-05, Slice 13 (recurring entries). Migration `0014_recurring_rules` adds `recurring_rules` and, on `transactions`, `recurring_rule_id` and `recurring_on` (unique together: a due date gets one entry, and a deleted one is not recreated); `transactions.source` gains `recurring`.
  - **Model:** a rule repeats an `expense`, `income` or `investment` (investment from a bank only, no category) on an account: weekly (`day` 1 Monday to 7 Sunday), monthly (`day` 1-31, a day the month lacks becomes its last) or yearly (`month` + `day`; 29 Feb falls on the 28th in common years). `mode` is `auto` (a confirmed entry, merchant = the rule's title, note "Recurring") or `draft` (the same as a draft that does not count until confirmed). Optional `endDate` and `remindDaysBefore` (1-7).
  - **`/api/recurring` (session):** `GET /` returns `{ items: [{ id, title, type, amountPaise, accountId, accountName, categoryId, categoryName, frequency, day, month, repeat, startDate, endDate, mode, remindDaysBefore, status: active|paused|ended, nextDate, upcoming (next three), entries }] }`, running first by soonest date. `POST /` creates (201); a `startDate` in the past adds the missed entries at once, at most the latest 36. `PATCH /:id` changes anything except the kind: the new amount, account, category and mode apply to later entries; changing how it repeats starts the new pattern from today (no duplicates). `POST /:id/pause`, `/resume` (the due dates that fell during the pause are skipped, not added later), `/skip` (leaves the next due date out once). `DELETE /:id` removes the rule; entries it made stay. 422 for impossible dates or days, an archived account, an investment on a card or with a category, or a category of the wrong kind; 404 for another person's rule or account.
  - **Daily job** (10:00 IST, before card reminders): adds every due date up to today that has no entry (catch-up for missed days), then sends one Telegram message per new draft with **Confirm** and **Discard** buttons (callbacks `r:<entryId>:ok` / `:no`, only for drafts a rule made), and one reminder `remindDaysBefore` days ahead per occurrence. Disabled people are skipped.
  - Rules follow their account: merging accounts moves them, an account with a rule cannot be deleted, nor archived while a rule is running; deleting or merging a category clears or carries the rules' category; the person-delete and JSON export (`recurringRules`) cover them.
  - **Telegram:** `/recurring` lists what repeats, soonest first. The briefing gains a `recurring` line for the soonest entry within a week.
- 2026-11-05, Plan tab (web layout only, no API change). The **Budgets** tab is now **Plan**, with views **Budgets** and **Recurring** chosen by `?view=recurring` (`/plan`); the old `/budgets` address redirects to `/plan`. Recurring moved there from Commitments; savings goals will join as a third view. The briefing's `budget` line links to `/plan` and its `recurring` line to `/plan?view=recurring`.
- 2026-11-05, Slice 14 (lent and borrowed). Migration `0015_debts` adds `contacts` (people, unique per user by lower-cased name, with `trusted`), `debts` and `debt_payments`; `transactions.type` gains `debt_out` and `debt_in`.
  - **Model:** a debt is money lent to or borrowed from a person. Money may move through a bank account (optional per entry; omit `accountId` for cash or not tracked). Lending through a bank writes a `debt_out` entry on it and borrowing a `debt_in`; each repayment writes the opposite entry. Debt entries are bank-only, have no category and are **never income or expense** (excluded from cash flow, summary totals, budgets and the review badge). They cannot be created or edited through `/api/transactions` (422; use `/api/debts`), and `GET /api/transactions?type=debt_out|debt_in` and the export carry them.
  - **`/api/debts` (session):** `GET /` (`?status=open|all`, default open) returns `{ owedToYouPaise, youOwePaise, people: [{ contactId, name, trusted, owedToYouPaise, youOwePaise, debts: [{ id, direction: lent|borrowed, amountPaise, paidPaise, outstandingPaise, date, dueDate, note, status: open|settled, forgiven, accountName, overdue, followUpStopped, nextFollowUp, payments: [{ id, amountPaise, date, accountName, note }] }] }] }`, people with the most owed first. `POST /` `{ name, direction, amountPaise, date?, dueDate?, note?, accountId? }` (201, returns the person; a name seen before is the same person, case-insensitively; a due date before the date or a date in the future is 422; `accountId` must be an active bank). `PATCH /:id` `{ dueDate?, note?, followUpStopped? }` (a changed due date restarts follow-ups and reminders). `POST /:id/payments` `{ amountPaise, date?, accountId?, note? }` (422 if more than outstanding; the debt settles when fully paid). `DELETE /:id/payments/:paymentId` removes a repayment and its bank entry. `POST /:id/settle` `{ date?, accountId? }` records the outstanding amount as paid in full. `POST /:id/forgive` closes it without money moving (written off when lent). `DELETE /:id` removes a debt with no repayments (409 otherwise) and its bank entry. 409 for a settled debt where a change is not allowed; 404 for another person's debt.
  - **`PATCH /api/contacts/:id` `{ trusted }`** marks a person trusted (lent money is only recorded, Alfred never follows up) and returns the open overview.
  - **Figures:** `BalanceOverview` gains `owedToYouPaise` and `youOwePaise`. **Net worth** = banks - cards owed - EMIs to come + owed to you - you owe; **safe-to-spend is unchanged by debts** beyond the bank balance itself (lending through a bank lowers it by the amount lent; borrowing raises it).
  - Debts follow their account: merging accounts repoints them; person-delete removes them; the JSON export gains `contacts`, `debts`, `debtPayments`.
  - **Daily job** (10:00 IST, before nudges): for money **lent** to someone not trusted and not stopped, one Telegram message "still owes you ... Has it been paid?" with **Paid in full / Later / Stop following up** on the due date, or 30 days after lending if there is none, then every 14 days until dealt with (callbacks `f:<id>:p|l|s`; a failed send is retried next day). For money **borrowed** with a due date, a reminder the day before and on the day (once each; only the later one if both days were missed).
  - **Telegram:** `/owed` lists who owes you and whom you owe; `/lent 5000 hdfc rahul` and `/borrowed 8000 sbi asha` record one (bank words as in other entries, or `cash`; the account question offers Cash or not tracked; Undo removes it unless repayments exist). Paid in full asks where the money came in, or cash.
  - Web: Accounts, **Commitments** view gains **Lent and borrowed** (people list, add sheet, per-person sheet with part payments, paid in full, write off, due date, stop following up, trusted toggle); net worth shows owed to you and you owe.
- 2026-11-05, Slice 15 (savings goals and the net worth trend). Migration `0016_goals` adds `goals` and `goal_contributions`.
  - **Model:** a goal has a name (unique among active goals, case-insensitively), `targetPaise` and an optional `targetDate`. Money put toward it is only **set aside**: it stays in the bank and no bank entry is made. What is saved is the sum of its contributions (positive adds, negative takes back; never below zero). Active goals' totals are taken off safe-to-spend; achieved and archived goals release theirs. Net worth is unchanged.
  - **`/api/goals` (session):** `GET /` (`?status=active|all`, default active) returns `{ setAsidePaise, goals: [{ id, name, targetPaise, targetDate, status: active|achieved|archived, savedPaise, remainingPaise, progressPct, monthlyNeededPaise (null with no date or once reached), needsAttention (not reached and the date is within 30 days or passed), achievedAt, contributions: [{ id, amountPaise, date, note }] }] }`, active first by soonest date. `POST /` `{ name, targetPaise, targetDate? }` (201). `PATCH /:id` (409 once closed). `POST /:id/contributions` `{ amountPaise (signed, non-zero), date?, note? }` (201; 422 if it would take more out than is saved or the date is in the future; 409 on a closed goal). `DELETE /:id/contributions/:contributionId` (409 if removing it would leave a negative total). `POST /:id/achieve` and `/archive` (release the set-aside). `DELETE /:id` only with no contributions (409 otherwise; archive instead). 404 for another person's goal.
  - **Figures:** `BalanceOverview` gains `goalsSetAsidePaise`; **`safeToSpendPaise` = counted banks - blocked - goals set aside - card owed** in `GET /api/accounts` and `GET /api/dashboard/summary`. Person-delete removes goals; the JSON export gains `goals` and `goalContributions`.
  - **Net worth trend:** `GET /api/dashboard/networth?months=12` (1 to 24) returns `{ points: [{ month, asOf, netWorthPaise, banksPaise, cardsOwedPaise, emiToComePaise, owedToYouPaise, youOwePaise }] }`, oldest first, one per month end (today for the current month), computed on read from the ledger as of each date: balances and card owing from entries dated on or before, EMI instalments after that date (from the plan's first instalment, until closed early), loans outstanding then. Months before the first entry are left out; the latest point equals the headline net worth.
  - **Telegram:** `/goals` lists progress, monthly pace and what is held back; `/save 5000 laptop` puts money toward a goal (the only goal needs no name; a part of a name matches, an exact name wins; several fits ask with buttons `g:<goalId>:s:<paise>`; Undo `g:<goalId>:u:<entryId>`). `/balance` shows the amount put toward goals. The briefing gains a `goals` line (linking to `/plan?view=goals`) and says when balances no longer cover the set-aside.
  - Web: Plan gains a **Goals** view (`?view=goals`); Accounts shows a "Put toward goals" row and a **Net worth over time** chart.
- 2026-11-05, Slice 16 (finding things; web layout plus one briefing line, no migration).
  - **Home** is the first tab (was "Cash flow") and gains shortcut tiles under the briefing: Lent and borrowed, EMI plans, Blocked for IPOs, Savings goals, Budgets, Recurring, each with a live status from `GET /api/accounts` and `GET /api/goals`.
  - **Everything** replaces "More" as the fifth tab (`/more`): every feature in groups (Today, Money, Plan, Tidy up, You) with a one-line description. The old More page is **Settings** at `/settings` (name, month start, card reminders, Telegram, people, data export, setup guide, demo data, sign out, delete account). One list in `web/src/features.ts` feeds both this page and the search.
  - **Find anything:** a search sheet opened from the sidebar, the phone's top bar, or `/` / Ctrl+K. It ranks features by title and keywords, shows recently used ones when empty, and ends with "Search entries for ..." (`/transactions?q=`).
  - **Deep links:** a "#section" in the address scrolls to that card once it has loaded (`#lent`, `#emi`, `#blocked`, `#trend`, and on Settings `#data`, `#telegram`, `#people`, `#month`, `#reminders`, `#demo`, `#signout`, `#delete`).
  - **Briefing:** a `debts` line when a loan is past its due date ("Rahul still owes you ... which was due 10 Oct"; with others, "N more loans are overdue too"), linking to `/accounts?view=commitments#lent`. The sample-data line now points to Settings.
  - **Telegram:** `/menu` shows buttons (callbacks `m:<name>`) for Balance, Today, Card dues, Budgets, Owed, Goals, EMIs, IPO blocks and Recurring; each answers like its command. Messages that said "under More" now say "under Everything, then Settings".
- 2026-11-05, Slice 17 (easier EMI entry; no migration).
  - **Calculator:** the EMI form works out each month's instalment from the amount converted, months and yearly rate (level instalment on a reducing balance, the last month clearing what is left; no rate gives an even split), shows one editable row per month and the total payable. A processing fee with a GST percentage and an optional "GST on the interest" switch (off by default) are added to the form. The same maths (`src/domain/emiCalc.ts`) will serve bank loans. The schedule is still stored as each month's amount only (`amounts_json`); rate, fee and GST are not kept.
  - **`POST /api/emi-plans`** accepts optional `feePaise` (the fee with its GST) and `feeDate` (not in the future; default today): one confirmed expense "<plan> EMI processing fee" is added on the card in the same batch, filed under Fees & Charges. It is never part of the instalments, so "still to come" is unaffected. A refused fee date adds no plan.
  - **`PATCH /api/emi-plans/:id/instalments/:n { amountPaise }`** sets one month to what the bank billed: the schedule, the plan's total and (for a month already billed) the entry follow; an even plan becomes uneven. 422 for a month outside 1 to months or a bad amount, 409 on a closed plan, 404 for another person's plan. The plan card gains a **Schedule** list with an Edit per month.
  - **Daily job:** adding instalments is now `runEmiCheckIns` (`src/services/emiJob.ts`): for each instalment it newly adds, one Telegram message "<plan>, instalment 2 of 6: ₹20,500 has been added to <card>. Does your statement agree?" with **Yes, it agrees** and **Different amount** (callbacks `e:<entryId>:y|d`). Different amount waits for the next message, an amount such as 20100 or 20,100.50, then corrects that month as above and says how much is still to come; any other message carries on as a normal entry and the wait is dropped. Months added when a plan is created are not asked about. The question is best effort: a send that fails is not repeated.
- 2026-11-05, Slice 18 (easier adding on the web; no migration).
  - **`GET /api/entry-hints` (session):** `{ merchants: [{ merchant, categoryId, accountId, count }], lastUsedAccountIds: [] }`. One entry per merchant (matched case-insensitively, the text as last typed), most recently used first, up to 100, with the category and account of its latest income or expense and how many of the latest 300 entries named it; accounts ordered by most recent use. Deleted entries, entries without a merchant, movements between accounts and instalments Alfred adds for EMI plans are left out. Telegram builds its merchant memory from the same query.
  - **New-entry form:** a one-line add at the top ("450 swiggy hdfc yesterday") is read with the same parser as Telegram and fills the type, amount, date, account, category and merchant below, with a sentence saying what it understood; Enter adds. The account starts on the one used most recently (not the first); a merchant seen before brings its usual category and account unless either was chosen by hand; the most used merchants appear as one-tap chips and known merchants are suggested as you type. Editing an existing entry looks as before.
- 2026-11-05, Slice 19 (investments). Migration `0017_holdings` adds `holdings` and `holding_values`, `transactions.holding_id` and `recurring_rules.holding_id`; `transactions.type` gains `investment_sale`.
  - **Model:** a holding is something owned and valued by hand: `kind` stock (stock or IPO), gold, crypto or other; `openingInvestedPaise` is what was put in before Alfred tracked it (no bank entry). **Put in** = opening + the investment entries linked to it; **sold** = the sale entries linked to it. **Worth** = the latest value typed on or before the day, plus purchases and less sales dated after it (with no value yet: put in less sold), never below nothing. **Gain** = worth + sold - put in, as a percentage of what was put in (one decimal). Buying or selling on the same day as the latest value moves that value, since the order within a day is unknown.
  - **`/api/holdings` (session):** `GET /` (`?status=active|all`, default active) returns `{ totalValuePaise, totalInvestedPaise, gainPaise, holdings: [{ id, name, kind, status, openingInvestedPaise, investedPaise, soldPaise, valuePaise, valueDate, staleDays, gainPaise, gainPct, entries: [{ id, kind: buy|sell, amountPaise, date, accountName, note }], values: [{ date, valuePaise }] (newest 12) }] }`, active first, largest first. `POST /` `{ name, kind, investedPaise?, valuePaise?, valueDate? }` (201; name unique among active, case-insensitively). `PATCH /:id` name and kind. `POST /:id/value { valuePaise, date? }` (not in the future; the same day replaces). `POST /:id/buy { amountPaise, accountId, date?, note? }` records an `investment` entry out of a bank account, linked. `POST /:id/sell { amountPaise, accountId, date?, note?, closeOut? }` records an `investment_sale` into a bank account (422 when nothing is left to sell); `closeOut` also closes the holding. `POST /:id/close` (value goes to nothing from today) and `/reopen`. `DELETE /:id` only with no entries linked (409 otherwise). 404 for another person's holding.
  - **Entries:** `investment_sale` brings money into a bank account, is never income, and is excluded from cash flow, summary, budgets and the review badge. It cannot be created or edited through `/api/transactions` (422, 409), but can be deleted. `investment` accepts an optional `holdingId` on create and edit (an active holding of the same person, only on investments; changing the type lets go of it). Transactions now carry `holdingId`.
  - **Connections:** an IPO marked allotted creates an active Stock holding of that name (or adds to the one that exists), linked and valued at what was paid. A recurring investment rule accepts `holdingId`, and the entries it makes carry it.
  - **Figures:** `BalanceOverview` gains `investmentsPaise` and **net worth adds it** (safe-to-spend is unchanged); the net worth trend points gain `investmentsPaise`, from the value as it stood at each month end. Export gains `holdings` and `holdingValues`; deleting a person removes them.
  - **Telegram:** `/invest` lists holdings with value, gain and how old the value is; `/value tata 15200` (or `/value 15200 tata`) types a value; the name matches exactly, or by part of it; several fits ask with buttons `i:<id>:v:<paise>`. `/balance` counts investments in net worth. On the 1st of each month (IST) Alfred lists each active holding and asks for fresh values (best effort, once). The briefing gains an `investments` line when any value is older than 35 days or missing.
  - **Web:** Accounts gains a third view, **Investments** (`?view=investments`): worth now, put in and gain, each holding with Update value, Buy more, Sell, Edit, Close, and its history. The Invest entry form and recurring investment rules gain a holding choice; sale rows in Transactions open Investments. Net worth card, Home strip and a Home tile show investments.
- 2026-11-05, Slice 20 (bank loans). Migration `0018_loans` adds `loans` and, on `transactions`, `loan_id` and `loan_on` (unique with the type: one interest entry and one principal entry per due date, and a removed one is not recreated); `transactions.type` gains `loan_payment` and `source` gains `loan`.
  - **Model:** a loan has a name, lender, kind (home, car, personal, education, other), the paying bank, a due day, the yearly rate in basis points, an EMI, `principalPaise` (outstanding when tracking began) and `anchorDate`, and a first due date. **What is owed** = that principal less the `loan_payment` entries so far, so corrections, prepayments and removed instalments stay consistent. Each month's **interest** = outstanding x rate / 12; **principal** = the EMI less interest; the last instalment clears what is left (a sliver under half a percent of the EMI is folded in).
  - **Entries:** an instalment is two entries from the paying bank on the due date: the interest as an `expense` under the category "Loan interest" (created for the person at the first loan) and the principal as a `loan_payment`, never income or expense, excluded from cash flow, summary, budgets and the review badge. Both have source `loan`. They cannot be created, edited or deleted through `/api/transactions` (422 or 409, "managed under Loans").
  - **`/api/loans` (session):** `GET /` (`?status=active|all`) returns `{ totalOutstandingPaise, monthlyEmiPaise, loans: [{ id, name, lender, kind, accountId, accountName, dueDay, ratePct, emiPaise, status, outstandingPaise, repaidPaise, interestPaidPaise, monthsLeft, payoffDate, interestToGoPaise, nextDueDate, nextInstalment, instalments (latest 12, newest first) }] }`. `POST /` `{ name, lender?, kind, accountId (a bank), principalPaise (owed now), ratePct, months | emiPaise, dueDay, asOf?, firstDueDate? }` (201): with `months` the EMI is calculated (the same formula as card EMIs); an EMI that cannot beat a month's interest is refused; instalments that fell due since `asOf` are added at once. `PATCH /:id` name, lender, kind, bank, due day, EMI. `GET /:id/schedule` the rows still to run. `POST /:id/prepay { amountPaise, date?, effect: shorten|lower }` records a `loan_payment` ("Prepayment"); lowering recalculates the EMI over the months that were left. `POST /:id/rate { ratePct, keep: emi|tenure }` applies from now: keeping the end date changes the EMI, keeping the EMI moves the end date. `POST /:id/foreclose { chargesPaise?, date? }` pays the whole outstanding, records charges as an expense under Fees & Charges, closes the loan. `PATCH /:id/instalments/:on { totalPaise }` sets what the bank took (interest stays, principal takes the rest); `DELETE /:id/instalments/:on` removes one that did not happen. `DELETE /:id` only with nothing recorded (409 otherwise). A loan clears and closes itself when nothing is owed. 404 for another person's loan.
  - **Figures:** `BalanceOverview` gains `loansPaise` (the outstanding of active loans) and **net worth subtracts it**; safe-to-spend is unchanged (as for EMIs). Net worth trend points gain `loansPaise`. Export gains `loans`; deleting a person removes them.
  - **Daily job:** `runLoanCheckIns` adds due instalments (catching up in order, at most 36) and, for each it adds, asks on Telegram "Home loan: ₹32,500 was taken from HDFC Bank (interest ..., principal ...). Does that agree with your bank?" with **Yes, it agrees** and **Different amount** (callbacks `l:<loanId>:y|d:<due date>`). Different amount waits for the next message, an amount, and corrects that instalment; any other message carries on as a normal entry. Instalments added when a loan is created are not asked about; a failed send is not repeated.
  - **Telegram:** `/loans` lists what is owed, the EMI, the next date and months left; `/menu` gains Loans; `/balance` counts loans in net worth. The briefing gains a `loans` line when an instalment is due within a week.
  - **Web:** Accounts, Commitments gains a **Bank loans** card (`#loans`): add a loan (the EMI is worked out and editable, with a preview of how long it runs and the interest), part-pay, change rate, schedule, instalments with a correction per row, pay off. Net worth card, Home strip and a Home tile show loans; loan entries in Transactions open the card.
