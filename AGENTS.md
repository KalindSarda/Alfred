# Finance Tracker — rules for the coding agent

Read before any change: `.claude-sdlc/outputs/01-requirements.md`, `03-architecture.md`, `05-api-schema.md`.
Build prompts live in `.claude-sdlc/outputs/04-dev-prompts.md`.
If code and those docs disagree, stop and ask; do not silently pick one.

## Money and dates (non-negotiable)
- All money is integer paise (INR). No floats anywhere in storage, API or domain code. Format to rupees only at the display edge.
- Dates are IST calendar dates (YYYY-MM-DD). Never use the runtime's local timezone; convert via one helper in `src/domain`.
- A card statement/due day that does not exist in a month (e.g. 30 in February) clamps to that month's last day.
- Transaction types: expense, income, transfer. A credit card bill payment is a TRANSFER bank -> card, never an expense. Income on a card reduces what is owed.
- Safe-to-spend = sum of balances of bank accounts flagged `counts_toward_safe_to_spend` minus total owed across all cards. It must not depend on salary dates, due dates or when a bill was paid.
- Cash flow and summaries exclude transfers, drafts and soft-deleted rows. Uncategorized is its own node.
- Balances, card outstanding, unbilled and utilization are derived from transactions and opening figures, never stored.

## Structure
- `src/routes`: thin; validate with Zod, call one service, return typed JSON. No business logic, no SQL.
- `src/services`: business logic. `src/domain`: pure functions, no Worker/env/DB imports. `src/db`: the only place that queries.
- Every table has `user_id`; every db helper requires `userId` and scopes by it. `userId` comes only from session middleware.
- Errors: throw domain errors from `src/config/errors.ts`; `app.onError` maps them to `{error:{code,message,details?}}`. No per-route try/catch.
- Web and Telegram both create transactions through `ledger.createTransaction`. Do not add a second path.
- Use `D1.batch()` for multi-row writes (transfers, edits touching several rows).
- Keep per-request CPU small (free plan 10 ms): aggregate in SQL, no big loops over rows.

## Security
- Never store raw login codes, session tokens, card numbers or CVVs. Store hashes (HMAC) and last4 only.
- Secrets only from Worker bindings (`.dev.vars` locally, gitignored). Never log secrets, codes or tokens.
- Parameterized queries only (Drizzle). Zod on every external input.

## Process
- Pin every dependency to an exact version. TypeScript strict. No `any` without a comment saying why.
- Write unit tests for money logic BEFORE building UI on top. Run `npm test` and `npm run typecheck` before declaring done.
- Do only what the current task asks. Anything listed as out of scope stays out.
- Do not copy code, logos or assets from Sure or SharkFin.
- Ask when a rule is ambiguous; do not invent financial behavior.

## Commands
- `npm run dev` (Worker, needs `npm run build` once for web assets), `npm run dev:web` (Vite), `npm test`, `npm run typecheck`, `npm run migrate:local`.
- `npm install` does not run dependency install scripts by default on this machine's npm; wrangler and vitest worked without approving them.
