import { WorkerMailer, LogLevel } from "worker-mailer";
import type { Config } from "../config/env";

/** Outbound channels used by auth. Injected so tests can fake them and routes build the real ones. */
export interface Notifiers {
  sendTelegram(chatId: string, text: string): Promise<void>;
  sendEmail(to: string, subject: string, text: string): Promise<void>;
}

async function sendTelegramMessage(config: Config, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    // Status only: the URL contains the bot token and the body may echo message text.
    throw new Error(`Telegram sendMessage failed with status ${res.status}`);
  }
}

async function sendSmtpEmail(config: Config, to: string, subject: string, text: string): Promise<void> {
  await WorkerMailer.send(
    {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      startTls: config.SMTP_PORT === 587,
      authType: "plain",
      credentials: { username: config.SMTP_USER, password: config.SMTP_PASSWORD },
      logLevel: LogLevel.ERROR,
    },
    { from: { name: "Finance Tracker", email: config.SMTP_FROM }, to, subject, text },
  );
}

export function createNotifiers(config: Config): Notifiers {
  return {
    sendTelegram: (chatId, text) => sendTelegramMessage(config, chatId, text),
    sendEmail: async (to, subject, text) => {
      if (config.EMAIL_TRANSPORT === "console") {
        // Local development only: lets you log in without SMTP. Never enabled in production config.
        console.log(`[console email] to=${to} subject=${subject}\n${text}`);
        return;
      }
      await sendSmtpEmail(config, to, subject, text);
    },
  };
}
