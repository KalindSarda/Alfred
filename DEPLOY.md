# Deploying Alfred

Everything runs on Cloudflare's free plan: one Worker (API, web app and the daily job) and one D1 database. You do these steps yourself because they use your Cloudflare account and your secrets; nothing here needs a paid plan.

Run all commands from the project folder. Allow about 20 minutes.

## 1. Sign in to Cloudflare

```bash
npx wrangler login
```

A browser window opens; approve it. Check with `npx wrangler whoami`.

## 2. Create the database

```bash
npx wrangler d1 create finance-tracker
```

It prints a `database_id`. Paste it into [wrangler.toml](wrangler.toml), replacing `00000000-0000-0000-0000-000000000000`. The id is not a secret, so it is fine to commit.

## 3. Create the tables

```bash
npm run migrate:remote
```

Answer `y` when asked to apply the migrations.

## 4. Create your user

There is no public sign-up. This is the only way an account comes to exist; use your own email.

```bash
node scripts/bootstrap-user.ts you@example.com --remote
```

It is safe to run twice.

## 5. Set the secrets

Each command asks you to paste the value, which is not echoed or stored in your shell history.

```bash
npx wrangler secret put AUTH_HMAC_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SMTP_HOST
npx wrangler secret put SMTP_PORT
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASSWORD
npx wrangler secret put SMTP_FROM
npx wrangler secret put SMTP_FROM_NAME
npx wrangler secret put EMAIL_TRANSPORT
```

Use these values:

| Secret | Value |
|---|---|
| `AUTH_HMAC_KEY` | A new random string of 32 or more characters (`openssl rand -hex 32`). Do not reuse the local one. |
| `TELEGRAM_BOT_TOKEN` | The same bot token as in `.dev.vars`. |
| `TELEGRAM_WEBHOOK_SECRET` | The same value as in `.dev.vars` (the `bot:webhook` command sends it to Telegram for you). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME` | As in `.dev.vars`. `SMTP_PORT` is 465 or 587. |
| `EMAIL_TRANSPORT` | `smtp`. Never `console` in production, because that prints login codes to the logs. |

## 6. Deploy

```bash
npm run deploy
```

It builds the web app and publishes the Worker. The last lines show your address, like `https://finance-tracker.<your-subdomain>.workers.dev`. Open `/api/health`; it should answer `{"ok":true}` or similar.

The daily job (card reminders and cleanup) is scheduled by `wrangler.toml` at 10:00 IST and is set up by the same deploy. Check it under Workers, finance-tracker, Settings, Triggers.

## 7. Point Telegram at the Worker

Use your Worker address, with no trailing slash:

```bash
npm run bot:webhook -- https://finance-tracker.<your-subdomain>.workers.dev
npm run bot:setup
npm run bot:info
```

`bot:info` should show the webhook address and no error. If you were using the tunnel before, this replaces it.

## 8. Check it end to end

1. Open your Worker address in a browser, enter your email and press **Send code**.
2. **Email check:** with the code sent to your email, confirm it arrives in your **inbox, not spam**, from the name you set in `SMTP_FROM_NAME`, with the subject "Your code, <name>". Mark it "not spam" if Gmail put it elsewhere. This is the one part that cannot be tested before deploying, because the mail sender only works inside Cloudflare.
3. Sign in, open **More**, then **Link Telegram**, and send `/start CODE` to the bot.
4. Send the bot `/add 100 test`, then `/undo`. Check **Transactions** shows it.
5. In **More**, download the backup (JSON) and the spreadsheet (CSV) once, and keep the backup somewhere safe.
6. Optional: install the app on your phone (Share, then Add to Home Screen on iPhone; the install prompt on Android).

If something fails, watch the live logs with `npx wrangler tail`. Rejected webhook calls log lengths only, never the secret.

## Later

- **Updating:** run `npm run migrate:remote` first if the database changed (releases that add tables or columns say so), then `npm run deploy`. Migrating before deploying means the new code never runs against old tables.
- **Inviting people:** sign in, open **More**, then **People**, and send an invitation. They get an email with a link and sign in with a one-time code. You can remove their access, restore it, or delete their data from the same card. The first account ever created (yours) is the owner.
- **Backups:** the app has no automatic backup, by design. Download the JSON backup from **More** now and then. Cloudflare also keeps 30 days of D1 history (`npx wrangler d1 time-travel info finance-tracker`).
- **Rotating a secret:** run `npx wrangler secret put NAME` again and, for the Telegram token or webhook secret, run `npm run bot:webhook` again.
- **Free-plan limits:** the Worker has 10 ms of CPU per request and 100,000 requests a day. A single person is far below both.
