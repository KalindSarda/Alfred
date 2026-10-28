/**
 * Talks to Telegram on your behalf, using the keys in .dev.vars. Nothing secret is ever printed.
 *
 *   node scripts/bot.ts info                  check the token and show the bot's username and webhook state
 *   node scripts/bot.ts setup                 set Alfred's name, description and command list
 *   node scripts/bot.ts webhook <https-url>   point Telegram at <url>/telegram/webhook (for a tunnel or a deployment)
 *   node scripts/bot.ts unhook                stop Telegram sending updates to a webhook
 */
import { readFileSync } from "node:fs";
import { BOT_COMMANDS, BOT_DESCRIPTION, BOT_NAME, BOT_SHORT_DESCRIPTION } from "../src/bot/commands.ts";

function loadVars(file = ".dev.vars"): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`Could not read ${file}. Copy .dev.vars.example to .dev.vars and fill it in.`);
    process.exit(1);
  }
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trimStart().startsWith("#")) vars[match[1] as string] = (match[2] as string).replace(/^["']|["']$/g, "");
  }
  return vars;
}

const vars = loadVars();
const token = vars.TELEGRAM_BOT_TOKEN;
if (!token || token.startsWith("replace-with")) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .dev.vars.");
  process.exit(1);
}

async function call(method: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    // The description is Telegram's own words (for example "Unauthorized"); the URL and token are never shown.
    console.error(`Telegram ${method} failed: ${json.description ?? `HTTP ${res.status}`}`);
    process.exit(1);
  }
  return json.result;
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "info": {
    const me = await call("getMe");
    const hook = await call("getWebhookInfo");
    console.log(`Token is valid. Bot: ${me.first_name} (@${me.username}).`);
    console.log(`Open it at https://t.me/${me.username}`);
    console.log(hook.url ? `Webhook: ${hook.url} (pending updates: ${hook.pending_update_count})` : "Webhook: not set.");
    if (hook.last_error_message) console.log(`Last webhook error: ${hook.last_error_message}`);
    break;
  }
  case "setup": {
    await call("setMyName", { name: BOT_NAME });
    await call("setMyDescription", { description: BOT_DESCRIPTION });
    await call("setMyShortDescription", { short_description: BOT_SHORT_DESCRIPTION });
    await call("setMyCommands", { commands: BOT_COMMANDS });
    console.log(`Set the name to "${BOT_NAME}", the description, the about text and ${BOT_COMMANDS.length} commands.`);
    console.log("The profile picture is set by hand in BotFather: use web/public/icon-512.png.");
    break;
  }
  case "webhook": {
    if (!argument || !/^https:\/\/[^\s/]+/.test(argument)) {
      console.error("Usage: node scripts/bot.ts webhook https://your-public-address");
      process.exit(1);
    }
    const secret = vars.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || secret.startsWith("replace-with")) {
      console.error("TELEGRAM_WEBHOOK_SECRET is not set in .dev.vars.");
      process.exit(1);
    }
    const url = `${argument.replace(/\/+$/, "")}/telegram/webhook`;
    await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    console.log(`Webhook set to ${url}`);
    break;
  }
  case "unhook": {
    await call("deleteWebhook", { drop_pending_updates: true });
    console.log("Webhook removed.");
    break;
  }
  default:
    console.error("Usage: node scripts/bot.ts info | setup | webhook <https-url> | unhook");
    process.exit(1);
}
