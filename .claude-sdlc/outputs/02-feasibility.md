---
stage: feasibility
project: personal-finance-app
status: draft
date: 2026-10-26
inputs: [01-requirements.md (draft-v7)]
next_stage: design-architect-skill
stack:
  backend: TypeScript on Cloudflare Workers, Hono, Zod
  database: Cloudflare D1 (SQLite) with Drizzle ORM
  frontend: React + Vite + TypeScript + Tailwind, installable PWA, served as static assets from the same Worker
  scheduling: one Cloudflare Cron Trigger (daily)
  bot: Telegram Bot API over webhook on the same Worker
  auth: passwordless one-time code, Telegram default, email fallback
  email_fallback: SMTP from the Worker over TCP sockets (port 465 or 587) via a dedicated Gmail sender account with an app password; Resend as alternative
  llm_later: Groq (free tier) called from the Worker
  hosting: Cloudflare Workers Free plan, 0 rupees
---

# Feasibility & Stack Decision: Personal Finance App

## Verdict
**Go, with caveats.** Every v1 requirement is technically ordinary (ledger arithmetic, a Telegram webhook, one daily scheduled job, a chart), and the zero-cost constraint can be met on Cloudflare's free tier at personal scale with wide margins. The caveats are not about capability. They are about (1) sending the email fallback for login under a zero-cost rule, (2) free-tier terms that can change, (3) the size of v1 for a side project, and (4) vibe-coded money logic, which needs a spec and tests to be trustworthy. None of these blocks the project, and each has a concrete mitigation below.

## Feasibility by area

| Area | Verdict | Reasoning |
|---|---|---|
| Auth (one-time code login, Telegram default, email fallback) | Feasible with caveats | A code is hashed with a cheap keyed hash, so the free plan's 10 ms CPU limit is no issue (this replaces the earlier password plan, which was squeezed by that limit). The Telegram channel is free and instant. The email fallback sends through SMTP from the Worker over TCP sockets (ports 465 or 587; port 25 is blocked), for example via a dedicated Gmail sender account with an app password; deliverability and secret handling are the risks. First login needs a bootstrap because Telegram is linked from inside the app. See risk 1 and risk 11. |
| Ledger, accounts, transactions, transfers | Feasible | Plain relational data. Integer paise, one row per transfer (from account, to account), atomic batch writes in D1. The risk is logic bugs, not infrastructure. |
| Credit card cycles and dues | Feasible | Date arithmetic in IST. Edge case to specify: a statement or due day that does not exist in a month (for example the 30th in February) must clamp to the month's last day. |
| Safe-to-spend and monthly summary | Feasible | Pure sums over transactions and opening balances; computed in SQL, so database wait time does not count toward the CPU limit. |
| Telegram bot (no AI) | Feasible | Webhook endpoint on the same Worker, secret-token check, chat-ID allowlist. Inline-button flows need small pending-state storage because callback data is size limited. |
| Due-date nudges | Feasible | One daily Cron Trigger is enough (free plan allows 5 per account). Cron runs in UTC, so 10:00 IST is 04:30 UTC. Keep a "nudge sent" log so a missed or delayed run catches up without duplicates. |
| Cash flow dashboard (Sankey and Profit and loss) | Feasible | Aggregate in SQL, draw client-side. The Sankey is hard on a phone, so the Profit and loss table is the mobile default (already in requirements). |
| Budgets | Feasible | Category totals against monthly limits. |
| PWA on iPhone 14 | Feasible | Add to Home Screen works from Safari. No web push is needed because reminders go through Telegram, which avoids iOS push quirks. |
| Export and backups | Feasible | JSON and CSV export endpoints. D1 also keeps point-in-time history (7 days on the free plan), which is not a substitute for your own export. |
| Zero-cost hosting | Feasible with caveats | Limits are far above personal use (see below). The risk is policy change, not capacity. |
| AI-readiness (later) | Feasible | Groq is a plain HTTPS call from a Worker. Telegram voice notes can be fetched and passed to Whisper. Draft status and merchant aliases in the schema make the AI layer additive. |
| Multi-user readiness | Feasible | `user_id` on every table and a data-access layer that always scopes by it, with isolation tests. |

### Free-tier limits that matter (Cloudflare Workers Free, checked 26 Oct 2026)
- Requests: 100,000 per day, 1,000 per minute burst. Personal use is a tiny fraction.
- CPU time: 10 ms per invocation (HTTP and Cron). Time spent waiting on the database or network does not count.
- Cron Triggers: 5 per account. The app needs one.
- Subrequests: 50 per invocation. Enough for a nudge run and bot replies.
- Static assets: free and unlimited. Functions behind Pages share the same 100,000 per day quota.
- D1: 5 GB total storage, 5 million rows read per day, 100,000 rows written per day. Rows scanned count as reads, so indexes matter.
- D1 Time Travel: 7 days of history on the free plan.

## Risks and mitigations

1. **Email fallback delivery and sender credential.** Cloudflare's own email sending to arbitrary recipients needs the paid plan, and its free option needs a domain, so the fallback sends over plain SMTP instead: Workers can open outbound TCP sockets, port 25 is blocked, and ports 465 and 587 work, with libraries such as worker-mailer available. The sender is a dedicated Gmail account using an app password, which needs no domain and can later reach friends within Gmail's daily limits. *Risks:* the app password is a credential held as a Worker secret, the SMTP library is third-party code, and codes can still land in spam. *Mitigation:* use a throwaway sender account (never the main mailbox) so a leak cannot expose the user's real mail, enable its two-step verification, review and pin the library version, keep email as fallback and recovery only, and test delivery to the real inbox early. Resend or Brevo remain alternatives if Gmail SMTP proves unreliable.
2. **Free-tier terms change.** Several providers cut free tiers during 2026. *Mitigation:* keep the code portable (Hono and Drizzle run on Node with SQLite or Postgres), keep your own export, and avoid Cloudflare-only features beyond Workers, D1, Cron and static assets.
3. **v1 is large for a side project.** *Mitigation:* strict build order with a usable core early (auth and ledger, then Telegram logging, then the cash flow view); defer everything marked "planned after v1".
4. **Vibe-coded money logic can be quietly wrong.** *Mitigation:* write the spec first, put the money rules (integer paise, transfers not expenses, safe-to-spend formula, month-end clamping) in the agent instruction file, and cover ledger logic with unit tests before building UI.
5. **Scheduled jobs in UTC and occasional delay.** *Mitigation:* one daily trigger, a sent-log table, and catch-up logic.
6. **D1 read cost from unindexed queries.** *Mitigation:* index by user, date, account and category from the start; keep dashboard aggregation in SQL.
7. **Data privacy on Telegram and Groq.** Telegram messages are not end-to-end encrypted and Groq's free tier offers no privacy guarantees. *Mitigation:* log only amount, merchant and category text, never account or card numbers, and allow only the linked chat.
8. **Vendor concentration on Cloudflare.** *Mitigation:* as in risk 2.
9. **iPhone PWA quirks.** *Mitigation:* all data lives server-side so storage eviction loses nothing; test installation on the actual device early.
10. **Backups.** Free-plan history is short. *Mitigation:* the export endpoint, plus an optional scheduled export sent to the user's own chat (a trade-off against risk 7, to be decided in design).
11. **First-login bootstrap and lockout.** Telegram is linked from inside the signed-in app, so the very first login cannot use it, and losing Telegram access would lock the user out. *Mitigation:* create the initial user through a one-time deployment setup, use the email code for the first login, then link Telegram; keep email as the recovery channel and let the user log out everywhere.

## Recommended stack

### Backend
**TypeScript on Cloudflare Workers, with Hono for routing and Zod for validation.** One Worker handles the web API, the Telegram webhook and the scheduled nudge job. D1 (SQLite) is the database, accessed through Drizzle ORM with migrations. Unit tests for the ledger logic run in Vitest as pure functions, separate from the Worker runtime.

Why: it is the only option that is free, always on (no cold-start sleep, which the Telegram requirement rules out), has built-in scheduled jobs, and keeps web, bot and scheduler in one deployable. The team's default Python and FastAPI stack was weighed and rejected for this project because free Python hosts sleep when idle, and no free always-on option for a Python service exists without hardware or a card.

Considered and rejected:
- **FastAPI on Render with Neon:** free service sleeps after inactivity, so the first bot message and first page open of the day are slow.
- **Fly.io and Koyeb:** no free compute for new accounts.
- **Supabase as the database:** free projects pause after a week of inactivity.
- **Google Sheets with Apps Script:** workable but slow, quota-limited and awkward for a real app.
- **Home server behind a tunnel:** free only if hardware exists, and it depends on home power and internet.
- **Python Workers:** limited support, to be re-checked rather than relied on.

### Frontend
**React with Vite, TypeScript and Tailwind, built as an installable PWA and served as static assets from the same Worker** (same origin, so cookie sessions need no cross-site setup). Charts: a Sankey library (d3-sankey or the Sankey component in Recharts) for the desktop view, with a plain table for Profit and loss. Mobile-first layout with a bottom tab bar.

Why: AI coding agents are strongest in React and Tailwind, the Sankey and table views are straightforward, and a same-origin static bundle costs no function invocations.

Rejected: Next.js on Workers (extra adapter complexity for no benefit here) and server-rendered HTML (the interactive chart and PWA behaviour favour a client app).

### Infra and hosting
- Cloudflare Workers Free plan: Worker, D1, one Cron Trigger, static assets.
- Telegram Bot API via webhook (free).
- Email fallback for login codes: SMTP over Workers TCP sockets (port 465 or 587) through a dedicated Gmail sender account with an app password held as a Worker secret (worker-mailer is a candidate library; final choice in design). Alternatives: Resend or Brevo over HTTPS.
- Groq free tier later, called from the Worker with the key held as a Worker secret.
- Source in a Git repository, deploy with Wrangler. Hard constraint: zero rupees.

## Rough complexity and timeline read
Not a commitment. With a coding agent and a written spec, the core (auth, ledger, accounts and cards, safe-to-spend) is a small number of focused evenings, Telegram logging with the command grammar is similar, and the cash flow dashboard with period selector and two views is the largest single UI piece. The ballpark for a complete v1 is a few weeks of part-time effort, with something usable (ledger plus Telegram logging) much earlier. The user has set no deadline, so the sequence in the requirements document is the right lever, not cuts.

## Carried-forward assumptions
- Free tiers remain available through the build and afterwards (requirements, assumptions).
- Single user in v1, multi-user later without schema change.
- INR only, fixed statement and due days per card, with month-end clamping added here.
- Telegram is a single private chat; Telegram and Groq are acceptable for minimal transaction text.
- The default category list is still open and will be drafted in the spec.
- Login is by one-time code with Telegram default and email fallback (chosen by the user); the first login uses email.
- This stack decision is preliminary; `design-architect-skill` writes the authoritative version.

## Sign-off needed before design
**Resolved:** the password-strength trade-off no longer applies. The user chose one-time-code login with Telegram as the default and email as the fallback, which removes password hashing entirely.

**Remaining for design:** create the dedicated sender account, store its app password as a Worker secret, choose and pin an SMTP library after reviewing it, and test that codes reach the user's real mailbox.
