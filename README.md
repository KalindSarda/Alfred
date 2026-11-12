# Alfred

Alfred is a personal ledger and assistant: bank accounts, credit cards, income, expenses and safe-to-spend. One Cloudflare Worker serves the API and the installable web app (PWA). Design docs are in `.claude-sdlc/outputs/`.

## Try it locally

Requires Node 24+ and npm.

```bash
npm install
```

One-time setup: create the local database and your user (use your own email):

```bash
npm run setup:local -- you@example.com
```

Start the app (builds the web app, then runs the Worker):

```bash
npm start
```

Open http://localhost:8787, enter your email, and press **Send code**. In local mode the 6-digit code is printed in the terminal running `npm start` (look for `[console email]`). Enter it to sign in. Then open **More** and press **Load demo data** to see the app with sample accounts.

## Secrets and configuration

Local secrets live in `.dev.vars` (git-ignored; `.dev.vars.example` lists every key). The defaults work for local use.

| Key | What it is |
|---|---|
| `AUTH_HMAC_KEY` | Random string (32+ chars) used to hash login codes and sessions |
| `TELEGRAM_BOT_TOKEN` | From @BotFather, used for the Telegram bot (upcoming) and login codes |
| `TELEGRAM_WEBHOOK_SECRET` | Random string Telegram echoes back on webhook calls |
| `SMTP_*` | Dedicated Gmail sender and its app password, for emailed login codes. `SMTP_FROM` is the sender address (use the same Gmail account as `SMTP_USER`); `SMTP_FROM_NAME` is the name shown in the inbox, default "Alfred" |
| `EMAIL_TRANSPORT` | `console` prints codes in the terminal (local only); `smtp` sends real email |

Never commit `.dev.vars`.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Build the web app and run the Worker locally |
| `npm test` | Run all tests (Workers runtime, local D1) |
| `npm run typecheck` | Typecheck the Worker and the web app |
| `npm run dev:web` | Vite dev server with hot reload (proxies `/api` to the Worker on 8787) |
| `npm run db:generate` | Generate a migration after changing `src/db/schema.ts` |
| `npm run migrate:local` | Apply migrations to the local database |

## Deploying

See [DEPLOY.md](DEPLOY.md) for the step-by-step guide (Cloudflare free plan).

## People

Sign-up is invite-only. The owner (the first account) invites people under **More**, then **People**; each person gets their own private ledger and a short guided setup on first sign-in. The owner can remove or restore someone's access, and delete the data of someone removed. Anyone but the owner can delete their own account under **More** (they type their email to confirm); the owner's account cannot be deleted from the app.

## Your data

**More** has two downloads: a JSON backup of everything (including deleted entries) and a CSV of current transactions. Exports are limited to ten an hour.

## Status

Built: accounts, cards, recurring entries and subscriptions, card EMI plans (instalments calculated from the rate, added automatically and checked against your statement), blocked IPO funds (UPI mandates, an allotment becoming an investment), investments (gold, silver or any kind of your own by quantity times a rate you update, others valued by hand, all counted in net worth), bank loans (the EMI split into interest and principal, prepayment, rate changes), a commitments view (what leaves before your next salary, free to spend, and a warning when a bank cannot cover a debit), habit nudges (an evening check-in with your usual spends as buttons, a Sunday balance check against your bank, and how long since you last logged), a salary day plan (what is still to leave before your next salary, what is free, and goals to set money aside for) and an optional morning briefing on Telegram, an emergency fund you can flag accounts and investments into, with its target, gap and monthly top-up, a Freedom page and a monthly review (what came in, what went out, savings rate, needs and wants, EMI burden), runway (how many months your bank money would last on rent, bills and instalments), a what-if for part-paying a loan, which card to use today for the longest interest-free time, statements checked against what Alfred expects (fees, GST and interest named), money lent and borrowed (follow-ups for those not trusted), savings goals (set aside from safe-to-spend), a net worth trend, a one-line add on the web form that remembers your merchants, a Home with shortcuts, an Everything page and a find-anything search, transactions, categories, one-time-code login, demo data, safe-to-spend, cash flow, the Alfred briefing, the Telegram bot, budgets, card due-date reminders, export, security headers, installable web app.
Next: a first deployment, then an optional AI phase (free-text understanding, voice notes, ask-your-ledger).
