import { describe, expect, it } from "vitest";
import { botVoice } from "../../src/alfred/botVoice";
import { BOT_COMMANDS, BOT_DESCRIPTION, BOT_NAME, BOT_SHORT_DESCRIPTION } from "../../src/bot/commands";
import { linkTelegram, makeApp, registeredUser } from "../api-helpers";
import { env } from "cloudflare:workers";

describe("Alfred's Telegram identity", () => {
  it("respects Telegram's limits", () => {
    expect(BOT_NAME.length).toBeLessThanOrEqual(64);
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
    expect(BOT_COMMANDS.length).toBeLessThanOrEqual(100);
    for (const { command, description } of BOT_COMMANDS) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThanOrEqual(3);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  it("has no duplicate commands", () => {
    const names = BOT_COMMANDS.map((c) => c.command);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every command in the menu appears in /help (apart from start and help)", () => {
    for (const { command } of BOT_COMMANDS) {
      if (command === "start" || command === "help") continue;
      expect(botVoice.help, command).toContain(`/${command}`);
    }
  });

  it("every command in the menu is actually handled", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const chat = Math.floor(Math.random() * 1e9) + 2e9;
    await linkTelegram(user.id, String(chat));
    let id = Math.floor(Math.random() * 1e9) * 10;
    for (const { command } of BOT_COMMANDS) {
      id++;
      await app.call("POST", "/telegram/webhook", {
        body: { update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, text: `/${command}` } },
        headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
        csrf: false,
      });
    }
    expect(app.telegram.messages.length).toBeGreaterThanOrEqual(BOT_COMMANDS.length);
    expect(app.telegram.messages.some((m) => m.text === botVoice.unknownCommand)).toBe(false);
  });

  it("the description speaks in Alfred's voice without exclamation marks", () => {
    expect(BOT_DESCRIPTION + BOT_SHORT_DESCRIPTION).not.toContain("!");
  });
});
