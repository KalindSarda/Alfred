---
stage: dev-prompts
generated_by: dev-prompt-skill
stack:
  backend: typescript-cloudflare-workers-hono
  frontend: react-vite-tailwind-pwa
based_on: [.claude-sdlc/outputs/01-requirements.md, .claude-sdlc/outputs/03-architecture.md, .claude-sdlc/outputs/05-api-schema.md]
status: draft
---

# Dev & Product Prompts — Personal Finance App

## Scope
- **Covered:** dev-agent task prompts, run with **Claude Code**, one prompt per build slice, in the delivery order from `03-architecture.md`.
- **Not covered (deferred):** product LLM prompts. v1 has no LLM feature. Groq-based natural-language logging, Whisper voice notes and the dashboard assistant are a later phase; the schema already leaves room (draft status, merchant aliases, shared create contract). Prompts for that phase get written when it starts.
- **How to use:** put the Shared preamble below in `AGENTS.md` (and a `CLAUDE.md` that just says "read AGENTS.md"). Then run the slice prompts in order, one per session, committing after each. Each prompt assumes the preamble is loaded and the three docs in `.claude-sdlc/outputs/` (01, 03, 05) are readable.

## Shared preamble (goes in AGENTS.md)

```markdown
# Finance Tracker — rules for the coding agent

Read before any change: .claude-sdlc/outputs/01-requirements.md, 03-architecture.md, 05-api-schema.md.
If code and those docs disagree, stop and ask; do not silently pick one.

## Money and dates (non-negotiable)
- All money is integer paise (INR). No floats anywhere in storage, API or domain code. Format to rupees only at the display edge.
- Dates are IST calendar dates (YYYY-MM-DD). Never use the runtime's local timezone; convert via one helper in src/domain.
- Card statement/due day that does not exist in a month (e.g. 30 in February) clamps to that month's last day.
- Transaction types: expense, income, transfer. A credit card bill payment is a TRANSFER bank -> card, never an expense. Income on a card reduces what is owed.
- Safe-to-spend = sum of balances of bank accounts flagged counts_toward_safe_to_spend minus total owed across all cards. It must not depend on salary dates, due dates or when a bill was paid.
- Cash flow and summaries exclude transfers, drafts and soft-deleted rows. Uncategorized is its own node.
- Balances, card outstanding, unbilled and utilization are derived from transactions and opening figures, never stored.

## Structure
- src/routes: thin; validate with Zod, call one service, return typed JSON. No business logic, no SQL.
- src/services: business logic. src/domain: pure functions, no Worker/env/DB imports. src/db: the only place that queries.
- Every table has user_id; every db helper requires userId and scopes by it. userId comes only from session middleware.
- Errors: throw domain errors; app.onError maps them to {error:{code,message,details?}}. No per-route try/catch.
- Web and Telegram both create transactions through ledger.createTransaction. Do not add a second path.
- Use D1.batch() for multi-row writes (transfers, edits touching several rows).
- Keep per-request CPU small (free plan 10 ms): aggregate in SQL, no big loops over rows.

## Security
- Never store raw login codes, session tokens, card numbers or CVVs. Store hashes (HMAC) and last4 only.
- Secrets only from Worker bindings (.dev.vars locally, gitignored). Never log secrets, codes or tokens.
- Parameterized queries only (Drizzle). Zod on every external input.

## Process
- Pin every dependency to an exact version. TypeScript strict. No `any` without a comment saying why.
- Write unit tests for money logic BEFORE building UI on top. Run `npm test` and `npm run typecheck` before declaring done.
- Do only what the current task asks. Anything listed as out of scope stays out.
- Do not copy code, logos or assets from Sure or SharkFin.
- Ask when a rule is ambiguous; do not invent financial behavior.
```

## Dev-agent task prompts

### Slice 0 — Project scaffold
**Depends on:** preamble loaded.
```text
Goal: scaffold the Finance Tracker repo so later slices can build on it.
Context: single Cloudflare Worker (Hono) + D1 + Drizzle + Vitest, with a React/Vite/Tailwind web app in web/ built to static assets served by the same Worker. Layout is in 03-architecture.md "Components & responsibilities".
Do:
1. Create the folder layout from the architecture doc (src/{config,routes,schemas,services,domain,db,middleware,utils}, web/, test/, drizzle/).
2. wrangler.toml with a D1 binding, static assets from web/dist, and one cron trigger at "30 4 * * *" (04:30 UTC = 10:00 IST). No secrets in it.
3. Hono app in src/index.ts exporting fetch and scheduled (scheduled can be a stub that logs). Add GET /api/health that runs SELECT 1 on D1.
4. Central app.onError and the error envelope from 05-api-schema.md, with domain error classes (NotFoundError, ForbiddenError, ConflictError, ValidationError).
5. Request-id middleware and a structured JSON logger in src/utils/logger.ts.
6. Config module that Zod-validates bindings/secrets (SESSION/HMAC key, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SMTP_* ) and fails fast with a clear message. Add .dev.vars.example.
7. Vitest setup, scripts: dev, build, test, typecheck, migrate:local, migrate:remote. Pin all versions.
8. Write AGENTS.md from the Shared preamble in .claude-sdlc/outputs/04-dev-prompts.md and a CLAUDE.md pointing to it.
Done when: npm run dev serves /api/health locally, npm test runs (one trivial test), typecheck passes.
Out of scope: any business tables, auth, bot, UI beyond an empty Vite page.
```

### Slice 1 — Domain core and ledger (money rules first)
**Depends on:** Slice 0. **Requirements:** 7–14, 20, 25, 26 (math only).
```text
Goal: implement and fully unit-test the pure money logic in src/domain, then the DB schema and ledger service.
Do, in this order:
1. src/domain/money.ts: paise helpers, formatRupees (Indian digit grouping, e.g. 2,00,000), parse "450", "450.50" to paise with rounding rules documented and tested (reject more than 2 decimals).
2. src/domain/dates.ts: todayIst(now), toIstDate(Date), clampDay(year, month, day), month ranges, period resolver for 7d/30d/90d/this_month/last_month/ytd in IST.
3. src/domain/cards.ts: given statementDay, dueDay and a date, return current statement window, next statement date, next due date (due falls in the month after the statement), with clamping. Cover: HDFC Millennia (23/12), Amazon Pay ICICI (12/30), OneCard (20/7), Feb with day 30, leap year, year rollover.
4. src/domain/balances.ts: bankBalance, cardOwed, unbilled, statementOutstanding, utilizationPct, safeToSpend as pure functions over plain arrays of transactions/accounts. Tests: purchase raises owed immediately; bill payment transfer leaves safe-to-spend unchanged; income on a card reduces owed; unflagged account excluded; paying early/late identical result.
5. Drizzle schema + first migration for: users, accounts, categories, transactions, merchant_aliases, app_settings (fields per 03-architecture.md "Data model"), with the indexes listed there. Seed the default categories (propose a sensible Indian-household list incl. income category "Cashback" marked isSystem, and "Salary") in a seed file for review.
6. src/db helpers (all require userId) and src/services/ledger.ts: createTransaction (the single contract, Zod schema CreateTransaction from 05-api-schema.md), update, softDelete, restore, confirm, listTransactions with cursor pagination. Enforce rules: transfer needs different dest and no category; account ownership, not archived; category kind matches type.
7. Tenant-isolation test: two users; every ledger/db function refuses cross-user reads and writes.
Done when: all domain tests pass with the listed cases; ledger service tests run against a local D1 (Miniflare/Workers Vitest pool); typecheck passes.
Out of scope: HTTP routes, auth, Telegram, UI.
```

### Slice 2 — Auth and sessions
**Depends on:** Slice 1. **Requirements:** 1–6.
```text
Goal: passwordless one-time-code login per 05-api-schema.md (Auth section).
Do:
1. Tables: sessions, login_codes, rate_limits, telegram_links, telegram_link_codes (03-architecture.md).
2. services/auth: issueCode (6 digits via crypto.getRandomValues, HMAC-SHA256 with server secret, 5 min expiry, single use, max 5 wrong attempts), verifyCode (constant-time compare), createSession (256-bit random token, store only hash, 30 days), logout, logoutAll.
3. Rate limiting per email and per IP in D1; uniform 202 response from /api/auth/request-code whether or not the email exists; only send to registered email or linked chat.
4. services/email: abstraction with one implementation using worker-mailer over SMTP (port 465/587) via the SMTP_* secrets, plus a console implementation for local dev. Pin the library; read its source/README for TCP socket behavior on Workers before relying on it; note findings in a comment-free README section docs/email.md.
5. Telegram sender (fetch to Bot API sendMessage) used when a chat is linked; channel selection per spec (telegram default, email fallback or when no chat linked).
6. Session middleware on /api, CSRF check (X-Requested-With: fin and JSON content type on non-GET), cookie flags HttpOnly, Secure, SameSite=Lax.
7. Routes: request-code, verify-code, logout, logout-all, GET /api/me.
8. scripts/bootstrap-user.ts (or documented wrangler d1 execute command) to create the single initial user from an email; no public signup route exists.
9. Tests: code single-use, expiry, attempt lockout, uniform responses, rate limit, session expiry, logout-all, CSRF rejection, unauthenticated access to every /api route except the public ones.
Done when: you can log in locally using the console email sender and the session cookie works; tests pass.
Out of scope: Telegram webhook/commands, UI.
Flag to me: anything about worker-mailer that looks unsafe or unreliable on the Workers runtime.
```

### Slice 3 — REST routes for accounts, transactions, categories
**Depends on:** Slices 1–2.
```text
Goal: implement the HTTP routes in 05-api-schema.md for accounts, transactions, categories, settings, demo data (thin routes over services).
Do: Zod schemas under src/schemas (one file per resource, exported types shared with web/), routes with zValidator, Idempotency-Key support on POST /api/transactions (short-lived store), cursor pagination (opaque base64 of txnDate+id), 404 for other users' resources, computed balances and card figures on GET /api/accounts, demo-data seed/clear (source='seed').
Tests: one request-level test per endpoint happy path plus the error cases listed in the API doc; cross-user 404s.
Done when: the endpoint list in 05-api-schema.md for these resources behaves as documented; typecheck and tests pass.
Out of scope: budgets, dashboard, export, bot, UI.
```

### Slice 4 — Telegram bot (no AI)
**Depends on:** Slices 1–3. **Requirements:** 15–18.
```text
Goal: Telegram webhook and commands.
Do:
1. POST /telegram/webhook: constant-time check of X-Telegram-Bot-Api-Secret-Token; ignore any chat not linked (return 200 silently) except /start <linkcode> which completes linking via telegram_link_codes; dedupe on update_id; always 200 after auth.
2. src/services/bot/parser.ts: pure parser for "/add <amount> [category] [merchant...]" (also accept bare "450 food swiggy"), amount via domain money parser, fuzzy-but-safe category match against the user's categories and merchant_aliases; return a structured result {complete | needs: [field...]}. Heavily unit-tested with at least 25 cases (typos, missing category, "1,200", "450.5", unknown words, expense vs "/income").
3. Inline-button flows for missing/ambiguous fields (choose account, choose category, confirm), state in bot_pending with short ids in callback_data (<64 bytes), expiry cleanup.
4. Commands /undo (soft-delete last bot transaction, with confirmation reply), /today, /balance (accounts + safe-to-spend), /due (cards with due dates and amounts).
5. All writes go through ledger.createTransaction with source='telegram'. Replies are short and show amount in rupees and the account used.
6. Link flow: POST /api/telegram/link-code, DELETE /api/telegram/link.
7. scripts/set-webhook to register the webhook URL with the secret.
Done when: simulated update payloads in tests cover every command and callback; a real bot on a dev Worker logs an expense end to end.
Out of scope: nudges, AI parsing, voice notes.
```

### Slice 5 — Web app shell, transactions, accounts and cards
**Depends on:** Slice 3. **Requirements:** 27, 29, 33.
```text
Goal: mobile-first PWA shell and the core data views.
Do: Vite + React + TS + Tailwind in web/, TanStack Query, typed API client reusing src/schemas types. Login screen (email, then 6-digit code, channel choice). App layout: left nav on desktop, bottom tab bar on mobile (Cash flow, Transactions, Budgets, Accounts and cards, More) and a "New" quick-add sheet. Pages: Transactions (search, filters, infinite cursor list, edit, soft delete, undo), Accounts and cards (bank balances; card outstanding, unbilled, utilization, due date), Settings (Telegram link flow, nudge lead days, log out everywhere, demo data buttons). PWA: manifest, icons placeholder, service worker caching static assets only (never API responses). Display amounts in rupees with Indian grouping; inputs convert to paise at the boundary only.
Style: clean fintech look inspired by Sure/SharkFin layouts (cards, subtle borders); original design only, no copied assets.
Accessibility: labels, focus states, 44px touch targets, works at 375px width.
Done when: you can log in, add/edit/delete a transaction and see balances change, installed on iPhone Home Screen (I will verify on device).
Out of scope: cash flow dashboard, budgets.
```

### Slice 6 — Cash flow dashboard and safe-to-spend
**Depends on:** Slices 3 and 5. **Requirements:** 22, 25, 26, 30–32, 34.
```text
Goal: implement /api/dashboard/summary, /cashflow, /cashback per 05-api-schema.md and the home screen.
Do: SQL aggregates (indexed, transfers/drafts/deleted excluded, uncategorized node, surplus = income - expense, pctOfIncome); summary strip with safe-to-spend and period income/expense/net; period selector (default rolling 30 days); Sankey view (d3-sankey or Recharts) on desktop; Profit and loss table as the default on narrow screens, with a toggle, rows expandable to the underlying transactions via GET /api/transactions filters; cashback total per account and month.
Tests: aggregate correctness with fixtures (transfers excluded, card bill payment not double counted, negative surplus, empty period).
Done when: numbers on screen match hand calculations from the demo data; Sankey is not used by default at 375px.
Out of scope: review queue, groups, allocation bars, assistant panel.
```

### Slice 7 — Cards nudges and budgets
**Depends on:** Slices 1, 4, 6. **Requirements:** 19, 20, 24.
```text
Goal: due-date nudges and budgets.
Do: scheduled() handler: for each unarchived card compute next due date (IST, clamped), if within nudgeLeadDays and no nudge_log row for (card, dueDate), send a Telegram message with card name, outstanding, due date; then insert the log. Catch up on missed days without duplicating. Budgets: GET /api/budgets, PUT /api/budgets/:categoryId/:month, ok/near(>=80%)/over status, budgets page with progress bars.
Tests: nudge not sent twice, sent once after a skipped day, not sent outside the window, clamped Feb due date, budget status thresholds.
Done when: triggering the scheduled handler locally (wrangler dev --test-scheduled) sends exactly one message per eligible card.
Out of scope: changing the cron schedule, per-user time-of-day.
```

### Slice 8 — Export, hardening and release
**Depends on:** all previous.
```text
Goal: finish v1.
Do: GET /api/export/json and /csv (CSV formula-injection guard), a restore-check script that validates an exported JSON, security pass (CSP headers on static assets, cookie flags, rate limits on auth and webhook, no secrets in logs), docs/deploy.md (create D1, apply migrations, set secrets, set webhook, bootstrap user, deploy), real-inbox email delivery test notes, README. Run the full test suite and typecheck.
Done when: an exported JSON round-trips through the check script and the deploy doc works from a clean checkout.
Out of scope: new features.
```

## Things to validate before relying on these
- **Slice 2 email:** that worker-mailer works on the Workers free plan (TCP sockets, CPU limit) and Gmail delivers codes to the real inbox; otherwise switch to Resend/Brevo before building further.
- **Slice 0/1 test setup:** that Vitest can run against a local D1 (Workers Vitest pool) in this Windows environment; fall back to better-sqlite3 for service tests if not.
- **Slice 4 parser:** run it against 30 to 50 real messages in your own style (feeds `test-evaluation-skill`).
- **Slice 6:** reconcile dashboard numbers against a hand-built spreadsheet for one month.
- **Default category list** proposed in Slice 1 needs your review.
- No product LLM prompts exist yet, so nothing here needs AI evaluation until the Groq phase.
