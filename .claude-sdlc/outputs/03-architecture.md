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
- **transactions**: id, user_id, type (`expense`|`income`|`transfer`), amount_paise (>0), txn_date, account_id, to_account_id (transfers only), category_id (nullable → "Uncategorized" node), merchant, note, status (`draft`|`confirmed`), source (`web`|`telegram`|`seed`|`ai-later`), created_at, updated_at, deleted_at. One row per transfer. Card bill payment = transfer bank → card.
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
