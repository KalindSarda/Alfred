---
stage: architecture
generated_by: design-architect-skill
stack:
  backend: typescript-cloudflare-workers-hono   # Hono + Zod, D1 (SQLite) + Drizzle, Vitest, Cron Trigger
  frontend: react-vite-tailwind-pwa             # TypeScript, served as static assets from the same Worker
based_on: [.claude-sdlc/outputs/01-requirements.md, .claude-sdlc/outputs/02-feasibility.md]
status: draft
---

# Architecture — Personal Finance App

## Overview
A single-user (multi-user-ready) personal finance system deployed as **one Cloudflare Worker** that does three jobs: serves the JSON API and the static React PWA, receives the Telegram webhook, and runs one daily cron for due-date nudges. All state lives in **D1 (SQLite)**. Web and Telegram are two front doors onto the same service layer, so there is exactly one way to create a transaction.

```
iPhone PWA (React) ──HTTPS──┐
                            ▼
Telegram ──webhook──►  Cloudflare Worker (Hono)  ◄── Cron Trigger (daily, 04:30 UTC = 10:00 IST)
                       routes (thin, Zod-validated)
                            │
                       services (business logic)
                            │            └──► Telegram Bot API (replies, nudges, login codes)
                       domain (pure fns)  └──► Gmail SMTP (email fallback codes, worker-mailer)
                            │
                       db layer (Drizzle, always scoped by user_id)
                            ▼
                        D1 (SQLite)
```

Request path, bot logging: Telegram POST → verify secret-token header → check chat ID against linked chat (ignore otherwise) → parse command (`/add 450 food swiggy`) → resolve gaps with inline buttons (pending state in `bot_pending`) → `ledger.createTransaction` → reply.
Request path, web: browser → session cookie → Zod validation → service → SQL (aggregation done in SQL) → JSON.
Nudge path: cron → for each card, compute due date (IST, month-end clamped) → if within lead time and not in `nudge_log` → send Telegram message → write log row. Catch-up on any later run, no duplicates.

## Components & responsibilities
Repo layout (TypeScript equivalent of the default thin-router / service / data layering; `test/` mirrors `src/`):

```
finance-tracker/
├── AGENTS.md / CLAUDE.md        # money rules for the coding agent (paise, transfers, safe-to-spend, clamping)
├── wrangler.toml                # D1 binding, cron, static assets, no secrets
├── .dev.vars.example            # documents secrets; real .dev.vars gitignored
├── drizzle/                     # generated migrations
├── src/
│   ├── index.ts                 # Hono app, error handler, `fetch` + `scheduled` exports
│   ├── config/                  # env parsing/Zod-validated bindings and constants, by domain
│   ├── routes/                  # thin: auth, accounts, transactions, categories, budgets,
│   │                            #       dashboard, telegram, export, settings
│   ├── schemas/                 # Zod request/response schemas (shared with web via types)
│   ├── services/                # ledger, cards, safeToSpend, cashflow, budgets, nudges,
│   │                            # bot (parser + handlers), auth (otp, session), email, export
│   ├── domain/                  # PURE functions, no Worker deps: paise, IST dates,
│   │                            # card cycle + clamp, safe-to-spend math
│   ├── db/                      # Drizzle schema + user-scoped query helpers (userId required)
│   ├── middleware/              # session auth, rate limit, request id
│   └── utils/logger.ts          # structured JSON logging
├── web/                         # React + Vite + Tailwind PWA (builds to dist, served as assets)
└── test/                        # Vitest: domain, services, tenant isolation, bot parser
```

| Component | Does | Does NOT |
|---|---|---|
| `routes/` | Parse/validate input (Zod), call one service, shape output | Contain business rules or SQL |
| `services/ledger` | Create/edit/soft-delete transactions, enforce type rules (transfer ≠ expense, income on card reduces owed), compute balances | Know about HTTP or Telegram |
| `services/cards` | Statement window, unbilled, outstanding, due date, utilization | Store card numbers (only nickname and last 4) |
| `services/safeToSpend` | Flagged bank balances − total card owed | Use salary dates, due dates or payment timing |
| `services/cashflow` | SQL aggregates for Sankey and P&L; period resolution | Count transfers; render charts |
| `services/bot` | Command grammar, inline-button flows, replies | Write to DB except via `ledger` |
| `services/auth` | OTP issue/verify, sessions, Telegram link codes, log out everywhere | Store passwords or raw codes |
| `services/nudges` | Decide which cards need a message, dedupe via `nudge_log` | Run outside the cron/`scheduled` entry |
| `domain/` | Deterministic math and date rules | Touch D1, fetch, or env |
| `db/` | Only place that queries; every helper takes `userId` | Expose unscoped queries |
| `web/` | Dashboard, transactions, accounts/cards, budgets, settings, quick add | Hold source-of-truth data (all server-side) |

## Data model
All tables carry `user_id` and all access goes through user-scoped helpers. Money is integer paise; dates are IST calendar dates (`YYYY-MM-DD`) plus UTC timestamps for audit.

- **users**: id, email (unique), created_at.
- **sessions**: id, user_id, token_hash, expires_at (30 days), created_at, last_seen.
- **login_codes**: id, user_id, code_hash (HMAC with server secret), channel (telegram|email), expires_at (5 min), attempts, used_at.
- **rate_limits**: key (email or IP + bucket), count, window_start. Used for code-request throttling.
- **telegram_links**: user_id, chat_id (unique), linked_at; **telegram_link_codes**: user_id, code_hash, expires_at, used_at.
- **accounts**: id, user_id, kind (`bank`|`card`), name, last4 (nullable), opening_balance_paise (bank) / opening_outstanding_paise (card), counts_toward_safe_to_spend (bank, default true), credit_limit_paise, statement_day, due_day (card only), archived_at.
- **categories**: id, user_id, name, kind (expense|income), archived_at. Seed includes income category **Cashback**.
- **transactions**: id, user_id, type (`expense`|`income`|`transfer`), amount_paise (>0), txn_date, account_id, to_account_id (transfers only), category_id (nullable → "Uncategorized" node), merchant, note, status (`draft`|`confirmed`), source (`web`|`telegram`|`seed`|`ai-later`), created_at, updated_at, deleted_at. One row per transfer or bill payment. Transfer = bank → bank; bill payment = bank → card (own type since 2026-10-27).
- **merchant_aliases**: user_id, alias, canonical merchant, default_category_id (for later AI layer).
- **budgets**: user_id, category_id, month (`YYYY-MM`), limit_paise.
- **nudge_log**: user_id, card_account_id, due_date, sent_at (unique on card + due_date).
- **bot_pending**: id, user_id, payload (JSON draft), expires_at; callback data carries only the short id (Telegram limit).
- **app_settings**: user_id, nudge_lead_days (default 3), nudge_time, session_days.

Indexes: `(user_id, txn_date)`, `(user_id, account_id, txn_date)`, `(user_id, category_id, txn_date)`, partial index on `deleted_at IS NULL` pattern, unique keys above. Needed because D1 free tier meters rows scanned.

Derived, never stored: account balance, card outstanding, unbilled spend, utilization, safe-to-spend, summaries.
- Bank balance = opening + income − expense ± transfers.
- Card owed = opening outstanding + expense on card − income on card − transfers into card.
- **Safe-to-spend = Σ balance(bank accounts flagged) − Σ owed(all cards)**.
- Cash-flow views: only confirmed, non-deleted income/expense; transfers excluded; uncategorized shown as own node; surplus = income − expense.

Demo/seed mode: dummy rows are tagged `source = 'seed'` so one action clears them.

## API boundaries
- **External, browser-facing**: REST/JSON under `/api/*`, same origin as the PWA, session cookie (HttpOnly, Secure, SameSite=Lax). Resource groups: auth, accounts, transactions, categories, budgets, dashboard (cashflow, summary, accounts-and-cards), settings, export (JSON, CSV), telegram link. Detail belongs to `dev-api-skill`.
- **External, machine-facing**: `POST /telegram/webhook` guarded by Telegram secret-token header (and an unguessable path segment); chat-ID allowlist after that.
- **Internal only**: `scheduled` handler (nudges); services never exposed directly.
- Single shared contract: `ledger.createTransaction` input schema used by web route and bot handler; later AI layer will create `status='draft'` only.
- Unauthenticated surface limited to `/api/auth/request-code`, `/api/auth/verify-code`, webhook, static assets.

## Integration points
| System | Use | Known / unknown |
|---|---|---|
| Telegram Bot API | Webhook in; replies, nudges, login codes out | Well understood; messages not E2E encrypted (accepted; log only amount/merchant/category) |
| Gmail SMTP (dedicated sender, app password) via **worker-mailer** | Email fallback and recovery login codes over TCP 465/587 | **Unknown:** library behaviour under Workers limits, spam placement. Pin version, review it, test real delivery in the first build slice. Fallback: Resend or Brevo over HTTPS |
| Cloudflare D1, Cron, static assets | Storage, scheduling, hosting | Free-tier limits per feasibility doc |
| Groq (later) | NL → draft transactions, Whisper voice | Additive; not in v1 |

## Chosen stack & rationale
Confirmed by the user on 2026-10-26 and unchanged from `02-feasibility.md`. The team's default Python/FastAPI was rejected for this project: free Python hosts sleep, which breaks the few-seconds Telegram requirement, and no free always-on option exists.

### Backend
**TypeScript on Cloudflare Workers; Hono (routing), Zod (validation at every boundary), Drizzle ORM on D1 with migrations, Vitest for tests.** Translation of the default conventions: Pydantic → Zod; `Depends()` → Hono context/middleware with bindings passed into services explicitly; centralized exception handler → `app.onError` mapping domain errors (`NotFoundError`, `ForbiddenError`, `ValidationError`) to one JSON error shape `{error:{code,message}}`; pytest → Vitest (pure `domain/` tests need no Worker runtime); OpenAPI → generated from Zod (e.g. `@hono/zod-openapi`) or hand-maintained, decided in `dev-api-skill`. Because Drizzle sits inside `db/`, `services/` hold logic and call `db/` helpers (a real data layer, unlike the default template). Pin every dependency to an exact version. Keep code portable (Hono and Drizzle run on Node + SQLite/Postgres) to limit vendor lock-in.

### Frontend
**React + Vite + TypeScript + Tailwind, installable PWA**, built to static assets served by the Worker (same origin, no CORS or cross-site cookies). Left nav on desktop, bottom tab bar on mobile (Cash flow, Transactions, Budgets, Accounts and cards, More) plus a "New" quick-add. Sankey via d3-sankey or Recharts for desktop; Profit and loss table is the mobile default. Server state via TanStack Query; no data kept authoritative on the device. No web push (reminders go through Telegram). Hard stance: do not copy Sure/SharkFin code, logos or assets.

## Non-functional design
- **Auth/security:** OTP 6 digits, 5-minute expiry, single use, stored as HMAC with a Worker secret, max 5 wrong attempts per code, rate limit per email and per IP, uniform response whether or not the email exists, codes only to the registered email or linked chat. Sessions: random 256-bit token, only its hash stored, 30-day expiry, log out everywhere deletes all rows. First user created by a one-time deploy-time seed (no signup route); first login by email, then link Telegram. Cheap hashing only (HMAC-SHA256), so the 10 ms CPU limit is not an issue. Secrets (bot token, webhook secret, HMAC key, SMTP app password) are Worker secrets, never in git. Strict CSP, parameterized queries only via Drizzle, Zod on every input.
- **Tenant safety:** `db/` helpers cannot be called without `userId`; Vitest suite creates two users and asserts no cross-reads or cross-writes.
- **Scaling:** personal scale (thousands of rows a year). Aggregation in SQL, indexed access, no N+1. Single Worker; revisit only if multi-user growth appears.
- **Atomicity:** transfer and multi-row writes use `D1.batch()`.
- **Observability:** structured JSON logs with request id, Workers observability enabled, error log on every webhook and cron failure; no card numbers or codes in logs.
- **Durability:** user-triggered JSON + CSV export (decided: no scheduled export to Telegram, to avoid shipping the full ledger over a non-E2E channel). D1 Time Travel (7 days) is a bonus, not a backup.
- **Privacy:** only nickname + last four digits stored; only minimal text would ever reach an LLM.
- **Testing emphasis:** domain money rules (balances, transfers, card cycle clamp, safe-to-spend), bot parser, tenant isolation. Strategy detail goes to `test-evaluation-skill`.
- **Delivery order:** (1) auth + ledger + domain tests, (2) Telegram logging, (3) web views and cash flow dashboard, (4) cards + due-date nudges, (5) budgets + safe-to-spend polish, (6) export, PWA install on the real iPhone early.

## Open risks
1. **Email transport:** worker-mailer on Workers TCP sockets and Gmail deliverability are unproven. Do a delivery test in slice 1; fall back to Resend/Brevo if flaky.
2. **Free-tier policy change** (Cloudflare, Groq). Mitigated by portability and manual export.
3. **10 ms CPU limit:** keep request handlers light; avoid big JSON transforms or per-row loops over large result sets.
4. **Month-end clamping** for statement/due days (e.g. 30th in February) must be implemented once in `domain/` and tested.
5. **Telegram callback data limit (64 bytes):** use short ids pointing to `bot_pending`; expire stale rows.
6. **D1 write atomicity:** use `batch()` for transfers and edits that touch several rows.
7. **Cron in UTC and delays:** `nudge_log` plus catch-up logic prevents missed or duplicate nudges.
8. **iOS PWA quirks:** test installation on the real iPhone 14 early.
9. **Lockout:** if Telegram is lost, email is the only recovery path; the sender account and the user's inbox need their own 2-step verification.
10. **v1 size** for a side project: follow the delivery order and defer everything in "planned after v1".
11. **Still to draft:** default category list (spec stage), and whether to expose the OpenAPI doc (`dev-api-skill`).

## Revision history
- Initial version. Stack confirmed as TypeScript on Cloudflare Workers; scheduled Telegram backup declined; Gmail SMTP kept for email fallback.

## Revision history (addendum)
- 2026-10-27: added the `bill_payment` type; transfers are bank-to-bank only. Added an Alfred voice module (`src/alfred/voice.ts`) that owns all wording of recorded facts, shared by the web briefing and the future Telegram bot; AI will phrase the same facts later and its numbers will be validated against them. Cash flow (Sankey, Profit and loss, breakdown) and net worth are derived in SQL/domain from confirmed transactions, never stored.

## Addendum: the architecture as built (2026-11-05, slices 1 to 20)

The original design above still holds: one Cloudflare Worker (Hono) serving the API and the built web app, D1 through Drizzle, a Telegram webhook, and one daily cron. This addendum records what grew on top of it and the patterns that keep it consistent, so a change can be made without rereading the code.

### Layers and where things live
| Layer | Folder | Rule |
|---|---|---|
| Routes | `src/routes` | Parse the request with a Zod schema (`src/schemas`), call one service, return JSON. No logic. |
| Services | `src/services` | All behaviour and cross-record rules (ownership, archived accounts, who may change what). Every function takes `(db, userId, ...)`; nothing is read without the user id. |
| Database | `src/db` | Drizzle schema, small query helpers, and the shared hints query. Migrations in `drizzle/` (0000 to 0018). |
| Domain | `src/domain` | Pure money and date rules with no I/O: balances, card cycles, EMI and loan maths, goals, holdings, debts, net worth, recurring dates. Shared by the server and the web, and the most heavily tested layer. |
| Alfred voice | `src/alfred` | All wording of recorded facts (`voice.ts` for the briefing, `botVoice.ts` for Telegram). A future AI layer phrases these same facts and its numbers are checked against them. |
| Bot | `src/bot` | Telegram: a parser-first reader (`parser.ts`), command and callback handlers, and short-lived pending state. |
| Jobs | `src/services/*Job.ts` | The daily work, described below. |
| Web | `web/src` | React and Vite. Pages are thin; components own their sheets; `queries.ts` holds the data hooks. |

### Data model (33 tables)
- **People and access:** `users`, `invites`, `sessions`, `login_codes`, `rate_limits`, `app_settings`, `idempotency_keys`, `telegram_links`, `telegram_link_codes`, `telegram_updates`, `bot_pending`.
- **The ledger:** `accounts` (banks and cards), `categories`, `transactions`, `merchant_aliases`, `budgets`.
- **Things that repeat or are owed:** `recurring_rules`, `emi_plans`, `loans`, `holds` (blocked IPO money), `contacts`, `debts`, `debt_payments`.
- **Things owned or set aside:** `holdings`, `holding_values`, `holding_lots`, `holding_kinds`, `goals`, `goal_contributions`.
- **Bookkeeping:** `nudge_log` (card due dates announced once), `mandate_alerts` (a short bank warned about once per debit and date), `checkin_log` (the evening and Sunday check-ins sent, and "nothing today" answers), `statement_checks` (card statements asked about and what was found), `salary_log` (salary credits already planned for).

### Money rules in one place
- Amounts are whole paise (integers); dates are IST calendar dates ("YYYY-MM-DD"). There is no floating point in stored money; percentages and rates are held as whole numbers (basis points for loans).
- **Entry types:** `expense`, `income`, `transfer` (bank to bank), `bill_payment` (bank to card), `investment` (bank out, optionally linked to a holding), `investment_sale` (bank in), `loan_payment` (bank out, principal), `debt_out` and `debt_in` (lent and borrowed). Only expense and income appear in cash flow, budgets and the review badge; everything else moves balances without being spending or earning. Sources: `web`, `telegram`, `seed`, `ai`, `emi`, `recurring`, `loan`.
- **Safe-to-spend** = balances of banks counted toward it - money blocked for IPOs - money set aside for goals - what cards owe. EMIs still to come, lent and borrowed money, investments and loans do not change it.
- **Net worth** = banks + investments + owed to you - cards owed - EMIs still to be billed - you owe - bank loans. The trend is computed on read from the ledger as of each month end; nothing is stored.

### Patterns that recur
1. **Materialisation.** EMI instalments, recurring entries and loan instalments are created by a job on their due date, never by the request that defines them. A unique index on (owner, due date or number) plus `onConflictDoNothing` makes it safe to run any number of times; a deleted or removed entry is soft-deleted so it is not recreated; a missed run is caught up in order (capped). Creating a plan or loan also backfills what has already fallen due, and only the job's own additions are asked about.
2. **Truth from entries, not stored totals.** What is owed on a loan, what is saved toward a goal, and what is invested in a holding are sums over entries, so a correction, prepayment or deletion can never leave a stale total. A holding's value is the latest typed value moved by later buying and selling; the rules live in `domain/holdings.ts`.
3. **Managed entries.** An entry made by a feature (lent and borrowed, an investment sale, a loan instalment) is refused by the ordinary entry routes (422 on create, 409 on edit or delete) and changed only through its own service, which keeps the two sides together.
4. **Check-ins.** After a job adds something that should match an outside document (an EMI instalment, a loan instalment), it asks on Telegram: "Does that agree?" with Yes or Different amount. Different amount stores an amount-wait in `bot_pending`; the person's next message is read as the figure, and anything else carries on as a normal entry. Callback data stays under 64 bytes.
5. **Pending state.** `bot_pending` holds a half-finished entry or an amount-wait for 15 minutes, owned by one person and one chat; a forged or stale callback changes nothing.
6. **One suggestion source.** `loadEntryHints` (merchant to usual category and account, recently used accounts) feeds both the bot's reader and the web form's one-line add, so both suggest the same things.
7. **One list of places.** `web/src/features.ts` lists every feature once; the Everything page, the find-anything search and the Home shortcuts all read it. A section on a page is reached with a `#section` in the address.
8. **Views by address.** Accounts (`accounts`, `commitments`, `investments`) and Plan (`budgets`, `recurring`, `goals`) keep their view in `?view=`, so any link, briefing line or search result can open them.

### The evening job (cron 17:15 UTC, 22:45 IST)
A separate trigger runs only `runEveningCheckIns`: the Sunday balance check, or the "nothing logged today" check-in with usual spends as buttons. The `scheduled` handler branches on `controller.cron`.

### The daily job (cron 04:30 UTC, 10:00 IST), in order
1. EMI check-ins: add due instalments, ask whether they agree.
2. Loan check-ins: the same for loan instalments (interest expense and principal payment).
2b. Statement checks: the day after a card statement, ask what it says and name any gap.
3. Recurring: add due entries (drafts for the person to confirm), send reminders.
3b. Mandate checks: warn when a bank cannot cover a debit due in the next two days.
4. Lent and borrowed: follow up on money lent (not to trusted people), remind about money borrowed.
5. Card due-date nudges (once per due date, recorded in `nudge_log`).
6. Investment value nudge (the 1st of the month only).
7. IPO outcome reminders.
7b. Salary day plan: plan for any new salary credit.
7c. Morning briefing on Telegram, for people who switched it on, when something needs attention.
7d. Monthly review, on the first morning of the person's month.
8. Maintenance: purge expired codes, sessions and pending rows.
Each step is isolated: one failing never stops the rest, and a person who fails never stops the others. Messages are best effort; the work itself (adding entries) is not tied to a message being delivered.

### Telegram surface
25 commands (listed once in `src/bot/commands.ts`, the single source for the bot's menu and the identity test). Plain sentences are read by the parser first, then confirmed or completed with buttons. Callback families are short single letters: pending entry (`p`), undo (`u`), category (`c`, `k`), archive (`a`), IPO holds (`h`), recurring drafts (`r`), lent and borrowed (`f`), goals (`g`), investment values (`i`), EMI check (`e`), loan check (`l`), menu (`m`).

### Testing and release
- Vitest in the Workers runtime against a local D1; one database per test file, a fixed test clock (2026-10-27 IST), and a helper that signs in and talks to the app or the webhook. 73 files, about 1,000 tests, run before every release.
- Release order for a change with a migration: commit and push, export the remote database, apply the migration remotely, deploy, then (when commands changed) register the bot commands.

### Known limits and conscious choices
- **Rates are typed by hand**; there are no live prices. Gold, funds and shares are quantity x the last rate typed (slice 21); crypto and Other are "worth what you last said".
- **EMI and loan maths are standard reducing-balance estimates.** A bank's first and last instalments can differ a little; every month can be corrected, and the check-ins catch it.
- **Opening balances count from the start.** The net worth trend begins at the first recorded entry and treats opening balances, opening loan principal and opening investments as always present.
- **Instalments added in a run are capped** (36 per loan or rule) so a long-ignored item cannot flood the books.
- **Runway is an estimate from recent history:** it needs two weeks of entries, treats the categories you mark essential plus card and loan instalments as what must be spent, and is flagged as early until 60 days of entries.
- **Safe-to-spend is deliberately simple:** it ignores when salary arrives and when bills are due.

### Where the AI phase attaches
The voice modules already separate facts from wording, the bot has a parser-first path with a clean place to fall back to a model, entries can carry source `ai` and status `draft` (shown to the person before they count), and the briefing's shape already includes `source: "template" | "ai"`. A model would phrase the same verified facts, answer questions through read-only service functions, and propose drafts, never change anything without a confirmation.

- 2026-11-05: addendum "the architecture as built" added: layers, the 28-table data model, entry types and money rules (safe-to-spend, net worth), the recurring patterns (materialisation, truth from entries, managed entries, check-ins, pending state, shared hints, one feature list, views by address), the daily job order, the Telegram surface, testing and release, known limits, and where the AI phase attaches.
- 2026-11-06: slice 21 noted: holdings counted by quantity (migration 0019, `holding_lots`, rate snapshots).
- 2026-11-06: slice 22 noted: investment kinds are per-person rows (`holding_kinds`) that carry unit and rate quantity; `holdings.kind` stores the kind key.
- 2026-11-07: slice 23 noted: the commitments timeline (`domain/commitments.ts`, `services/commitments.ts`) joins cards, EMIs, loans, recurring rules and borrowed money; free to spend is a second figure beside safe-to-spend.
- 2026-11-11: slice 24 noted: the logging habit (last-logged in the briefing, the evening cron, usual spends, the weekly balance check booking gaps as source `check`).
- 2026-11-12: slice 25 noted: card float ranking (`domain/cardFloat.ts`) and statement checks (`domain/statementGap.ts`, `services/cardTools.ts`, `statementJob.ts`).
- 2026-11-13: slice 26 noted: the salary day plan (`services/salary.ts`, `planJob.ts`) built on the commitments view, and the opt-in morning briefing.
- 2026-11-14: slice 27 noted: runway (`domain/runway.ts`, `services/runway.ts`, the essential flag on categories) and the part-payment what-if (`simulatePrepayment` in `domain/loans.ts`).
- 2026-11-15: slice 28 noted: money health (`domain/health.ts`, `services/health.ts`), the monthly review, and `getNetWorthAt` for net worth at any day.
- 2026-11-16: slice 29 noted: the emergency fund (`domain/emergency.ts`, `services/emergency.ts`), flags on accounts and holdings, and three settings.
- 2026-11-17: slice 30 noted: the FIRE planner (`domain/fire.ts`, `services/fire.ts`, `fire_plan` table) and the built-in Retirement investment kind.
