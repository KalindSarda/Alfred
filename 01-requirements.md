---
stage: requirements
project: personal-finance-app
status: draft-v8
date: 2026-10-26
next_stage: feasibility-decision-skill
---

# Requirements: Personal Finance App

## Source
Brainstorming and clarification conversation with Kalind (26 Oct 2026): five rounds of questions and answers, his seed data (cards and accounts), a web check of card benefit terms, and two screenshots supplied by the user as visual references for the dashboard (Sure's home screen and SharkFin's cash flow page, desktop and phone). No external client; Kalind is the sole user and owner. Inspiration only (not clones): `gillespiejameson/personal-finance-tracker` and Sure (`sure.am`).

## Summary
A custom-built personal finance app for one person to manage multiple bank accounts, three credit cards, income, expenses, cashback received and budgets. Logging is Telegram-first from day 1, with a mobile-first web app (PWA, used on iPhone 14) for viewing, editing and setup. Hosting must cost nothing. Gen AI logging (Groq free tier) is deliberately deferred until a working non-AI version exists, but the design must leave room for it. v1 starts with zero or dummy data; real opening balances come later.

## v1 scope at a glance
In v1: one-time-code login (Telegram default, email fallback; single user), multiple bank accounts, credit cards with cycles and due dates, Telegram logging with due-date nudges, cashback logged as ordinary income entries, budgets and safe-to-spend, a cash flow dashboard (Sankey and Profit and loss views), PWA, export.
Moved to phase 2: bank statement CSV import.
Deliberately simplified: no cashback rules engine in v1 (the user logs cashback received by hand).
Planned later: cashback rules engine, loans and EMIs, investments and net worth, recurring bills and subscriptions, AI logging, multi-user.

## Seed data (from the user)

### Credit cards
| Card | Limit | Statement day | Due day |
|---|---|---|---|
| HDFC Millennia | 2,00,000 | 23rd | 12th (next month) |
| Amazon Pay ICICI | 3,10,000 | 12th | 30th |
| OneCard (Federal Bank metal) | 79,000 | 20th | 7th (next month) |

### Bank accounts
| Account | How the user uses it |
|---|---|
| HDFC Bank | Salary account; main spending account |
| ICICI Bank | Former salary account, now mostly savings; main spending account |
| SBI | Salary account; used for holding cash |
| Bank of Baroda | Salary account; used as the emergency reserve |

### Income
Salary usually arrives on the 30th of each month, very rarely earlier or later because of holidays or bank closures. Informational only: no calculation in v1 depends on the salary date, and bills may also be paid early or late.

## Functional requirements

### Auth and users
1. The system shall authenticate the user with a one-time code instead of a password: the user enters their registered email, and the system sends a 6-digit code, valid for 5 minutes and usable once, to the linked Telegram chat by default, or to the registered email when the user chooses the email fallback or no Telegram chat is linked yet.
2. The system shall protect the code flow: store only a keyed hash of each code, allow at most 5 wrong attempts per code, rate-limit code requests per email and per IP, send codes only to the registered email or the linked chat, and give the same response whether or not the email is registered.
3. The system shall keep the user signed in with a long-lived session (default 30 days) in an HttpOnly, Secure cookie, and shall provide a log out everywhere action.
4. The system shall create the initial user and register their email through a one-time deployment-time setup (not a public signup page); the first login uses the email code, after which the user links Telegram (requirement 15).
5. The system shall support exactly one user in v1, with no public signup.
6. Every user-owned table shall carry a `user_id`, and every query shall be scoped by it, so adding users later needs no schema change.

### Accounts and transactions
7. The system shall support multiple bank accounts, each with an opening balance and a per-account flag for whether it counts toward safe-to-spend.
8. The system shall support credit cards as a distinct account type with: credit limit, statement day, payment due day and opening outstanding.
9. The system shall support three transaction types, expense, income and transfer, with amounts stored as integer paise in INR.
10. The system shall let the user set date (IST), account, category, merchant and note, and shall edit and soft-delete transactions.
11. The system shall treat a credit card bill payment as a transfer from a bank account to the card, never as an expense.
12. The system shall allow an income-type entry on a credit card account, which reduces that card's outstanding (for cashback redeemed as a statement credit).
13. The system shall ship a standard set of categories, including a dedicated income category named Cashback, that the user can add to, edit and archive, plus a searchable, filterable transaction list.
14. The system shall support a seed or demo-data mode (zero data or dummy data) so the app can be used before real balances are entered, and dummy data can be cleared in one action.

### Telegram bot (day 1, no AI)
15. The system shall link a Telegram chat to the user via a one-time code generated in the web app, and shall ignore any chat that is not linked.
16. The system shall verify that incoming webhook calls come from Telegram (secret token).
17. The system shall accept a command grammar for logging (for example `/add 450 food swiggy`) and use inline buttons to resolve missing or ambiguous fields.
18. The system shall provide `/undo`, `/today`, `/balance` and `/due` commands.
19. The system shall proactively message the user before each credit card's payment due date. The default lead time is 3 days (configurable, 2 to 3 days preferred), at a default time of 10:00 IST (time of day is not important to the user).

### Credit cards
20. The system shall compute, per card: current statement window, unbilled spend, statement outstanding, due date and utilization against the limit, using the card's statement day and due day.

### Cashback (simplified for v1)
21. The system shall let the user log cashback received as an income entry in the Cashback category, on the account where it landed (the card for a statement credit, or a bank account).
22. The system shall provide a simple total of cashback received per card and per month, derived from those entries (no rules, caps or expected-versus-credited comparison in v1).
23. The system shall keep card and merchant on every transaction so a rules engine can be added later without changing existing data.

### Budgets and safe-to-spend
24. The system shall support monthly budgets per category with progress and overspend indication.
25. The system shall show a safe-to-spend figure ("available now") derived only from transaction entries and opening balances, using the formula below, with no dependence on salary dates, due dates or when a bill was paid.
26. The system shall show a summary on the dashboard with total income, total expense and net for the selected period, derived from transactions (see the Dashboard requirements).

### Web app (PWA)
27. The system shall provide a mobile-first web app, installable on iPhone via Add to Home Screen, covering dashboard, transactions, accounts, cards, budgets and settings, and shall work on desktop browsers.
28. The system shall let the user export all data as JSON and CSV.

### Cash flow dashboard (visual style inspired by Sure and SharkFin; only this part of the references is in v1)
29. The system shall present a layout with a left navigation on desktop and a bottom tab bar on mobile (Cash flow, Transactions, Budgets, Accounts and cards, More), and a "New" button that opens quick add. Cash flow is the home screen.
30. The system shall show a "Where the money went" card as a Sankey-style flow: income sources on the left, a central income node, and expense categories plus the surplus (shown as savings) on the right, with the amount and percentage of income on each node. Transfers, including card bill payments, are excluded so nothing is counted twice, and uncategorized entries appear as their own node. Surplus here means income minus expenses for the period, not money moved to a savings account.
31. The system shall provide a period selector for the Cashflow card with rolling 7, 30 and 90 days, this month, last month and year to date, defaulting to rolling 30 days.
32. The system shall let the user switch the card between a Sankey view and a Profit and loss view, a table of category, percentage of income and amount with an Income section and an Expenses section whose rows expand to the underlying transactions. On narrow screens the Profit and loss view is the default, since the Sankey is hard to read on a phone.
33. The system shall provide an Accounts and cards page listing each bank account with its balance and each credit card with its outstanding, unbilled spend, utilization and due date. Allocation bars, weights and asset-style rows are deferred.
34. The system shall show a summary strip at the top of the cash flow dashboard with safe-to-spend (available now) and income, expense and net for the selected period.

## Safe-to-spend definition
Available now = balance of the accounts flagged as counting toward safe-to-spend, minus the total currently owed across all credit cards. Both parts come straight from transaction entries and opening balances:
- A card purchase is an expense the moment it is logged, so unbilled and billed card spend are both already in what is owed.
- A card bill payment is a transfer, so paying early or late changes the bank balance and the card's owed amount by the same amount and leaves the result unchanged.
- Salary or any income raises the balance when it is logged, whether it arrives on the 30th or earlier or later.

The per-account flag decides which bank accounts are counted. All four are flagged by default and the user can switch any of them off (for example to treat a reserve account separately). No daily allowance, expected-income date or "committed category" deduction in v1.

The monthly income, expense and net summary (requirement 26) is shown separately. It is a plain total for the selected calendar month, so an early or late salary can make a single month look high or low, and that is accepted.

## Non-functional requirements
- **Cost:** hard constraint of zero rupees for hosting, database and LLM (free tiers only).
- **Responsiveness:** a Telegram log command shall be confirmed within a few seconds, so a sleeping free host with long cold starts is not acceptable for the bot.
- **Correctness:** integer paise everywhere, IST dates, and unit tests covering ledger logic (balances, transfers, card cycles, safe-to-spend).
- **Security:** passwordless login with short-lived, single-use, hashed one-time codes and rate limiting, HttpOnly Secure session cookies, webhook secret, Telegram restricted to the linked chat; the registered email account should have its own two-factor protection.
- **Privacy:** no card numbers, CVVs or bank credentials stored; only nickname and last four digits. Only minimal transaction text goes to any LLM API later.
- **Tenant safety:** automated tests proving one user cannot read another's data, even though v1 has one user.
- **Durability:** user-triggered export from day one, because free tiers are not backups.
- **Scale:** personal scale, a few thousand transactions a year.
- **Maintainability:** vibe coded with a coding agent, so the project needs a spec and an agent instruction file; the user intends to understand what ships.
- **AI-readiness:** one create-transaction contract shared by web app and bot, a draft/confirmed status, and a merchant alias table, so the later AI layer only creates drafts.
- **Delivery:** no target date; as early as possible, with the build ordered so that something usable exists early.

## Assumptions
- INR only, English input.
- v1 begins with zero or dummy data; real opening balances per account and opening outstanding per card are entered later, and until then balances and card dues are illustrative.
- Each card has a fixed statement day and due day (due date falls in the month after the statement).
- Cashback is logged by hand as income. If the user forgets to log it, totals will understate what was received.
- Salary is not auto-detected and no calculation depends on pay dates or bill-payment dates; everything derives from logged transactions.
- Telegram is a single private chat with the bot.
- The email fallback uses SMTP through a dedicated sender mailbox (for example Gmail with an app password) that can deliver to the user's own address; deliverability and secret handling are to be confirmed in design. If Telegram access is lost, email is the recovery path.
- Free tiers (hosting, database, Groq) remain available through the build; they have shrunk repeatedly in 2026, so this is a real risk.
- Web UI is secondary to Telegram for entry and primary for viewing, setup and editing.

## Open questions
1. **Stack not yet confirmed:** Cloudflare Workers + D1 is a recommendation, not a decision, and is for the feasibility stage to settle (including scheduled jobs for nudges on free tiers).
2. **Default categories:** the exact standard set is still to be drafted in the spec.
3. **Email sender:** the preferred route is SMTP from the Worker through a dedicated Gmail sender account with an app password, sending to the user's own address; to be confirmed in design with a real delivery test and a review of the SMTP library.

### Tensions noted
- The Sure reference dashboard is desktop-first, while the user's primary device is an iPhone. The Sankey chart is cramped on a phone, so the SharkFin pattern of a Profit and loss table as the mobile default is adopted.
- The reference dashboards show investments, crypto, properties and vehicles, which v1 does not have; the cash flow dashboard is the only part of them taken into v1.
- v1 is large for a side project. Suggested internal order: auth and ledger, Telegram logging, web views, cards and due-date nudges, budgets and safe-to-spend, export.
- Free hosting versus proactive nudges: nudges need scheduled jobs, to be checked against free-tier limits in feasibility.

## Tech stack hints from the client
- Any backend language is acceptable; the app will be vibe coded.
- Login by one-time code (Telegram default, email fallback). The email fallback should send through SMTP from the Worker (outbound TCP sockets on port 465 or 587; port 25 is blocked), using a dedicated Gmail sender account with an app password, as the user has done before from scripts; Resend or Brevo are alternatives.
- Hosting, database and LLM must be free. Groq free tier for LLM and Whisper later, with Ollama as a possible later switch.
- Telegram bot from day 1, used from an iPhone 14; web app as an iPhone-installable PWA; desktop frontend is a lower concern.
- Brainstorm recommendation (not a decision): Cloudflare Workers + D1 (SQLite), Hono, Drizzle, PWA, Telegram webhook on the same Worker.
- Comfortable with Python, FastAPI and LangGraph, but not required here.
- Visual references: Sure's home screen (flow chart, assets table, assistant panel) for Home, and SharkFin's cash flow page (view toggles, Profit and loss table on mobile, income and expense breakdown cards, review badge) for the cash flow section. Take the layout and style as inspiration only; Sure is open source under a copyleft licence as far as I know, so do not copy its code, logo or assets. The same applies to SharkFin's branding and assets.
- Reference products for inspiration: personal-finance-tracker (rules, budgets, safe-to-spend, dedupe import) and Sure (assistant UX).

## Planned after v1
- **Phase 2:** bank statement CSV import (per-bank mapping profiles, dedupe, preview, undo). Many card statements are PDFs, so check which of the user's banks offer CSV before designing it.
- **Cashback rules engine:** per-card rules, caps, point values, expected-versus-credited. See the reference notes below.
- **Dashboard extras from the reference designs (deferred by the user):** a review queue with a count badge for uncategorized or draft transactions, income and expense breakdown cards with proportional bars and a category or merchant toggle, optional category groups with a groups, categories or both toggle, and an accounts allocation bar with weights.
- **Dashboard assistant panel:** a conversational assistant in the dashboard's side panel (AI phase), sharing the Telegram AI backend.
- **Asset rows on the dashboard:** investments and other assets once net worth tracking exists.
- **Forward-looking safe-to-spend:** daily allowance, upcoming card dues and committed items, once EMIs and recurring bills exist.
- Loans and EMIs.
- Investments and net worth.
- Recurring bills and subscriptions.
- AI logging via Groq (natural language to draft transactions, Telegram voice notes via Whisper) and an ask-your-ledger assistant.
- Multi-user: invite-only accounts for friends. Each friend would use their own email and link their own Telegram; emailing friends on a free provider may need a verified domain.

## Reference notes for the later cashback-rules phase (research, 26 Oct 2026)
Kept so the research is not lost. The user reviewed the HDFC Millennia caps and CashPoint value and the OneCard details and found them acceptable. They came from bank pages where reachable and third-party card sites otherwise, and should be re-checked against bank terms when the engine is built.
- **HDFC Millennia:** 5% in CashPoints on ten partner merchants (Amazon, BookMyShow, Cult.fit, Flipkart, Myntra, Sony LIV, Swiggy, Tata CLiQ, Uber, Zomato), 1% on other eligible spends, fuel, rental and government-type transactions excluded from the 1% tier, caps reported per statement cycle on each tier.
- **OneCard (Federal Bank):** 5X rewards on the top two spend categories each month (the top categories are decided per cycle, so any reward estimate is provisional until the cycle closes); base rate reported as 1 point per 50 rupees; category mapping to the app's own categories would be needed.
- **Amazon Pay ICICI:** user-stated 5% on Amazon and Amazon Pay as a Prime member (3% otherwise), no cap; rates elsewhere to be confirmed.

## Out of scope
- Splitting expenses with friends.
- Multi-currency.
- Cashback rules, caps and expected-versus-credited tracking in v1.
- Bank aggregator sync, SMS parsing and PDF statement parsing.
- Native mobile app, passwords (login is by one-time code) and public signup.
- Tax filing or GST features.
