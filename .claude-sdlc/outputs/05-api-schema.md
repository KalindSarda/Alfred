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
