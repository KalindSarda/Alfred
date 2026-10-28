/** A button under a message. `data` comes back to us when it is pressed; Telegram caps it at 64 bytes. */
export interface Button {
  text: string;
  data: string;
}

/** The few Telegram calls Alfred needs. An interface so tests can fake it. */
export interface TelegramApi {
  sendMessage(chatId: string, text: string, buttons?: Button[][]): Promise<number>;
  editMessage(chatId: string, messageId: number, text: string, buttons?: Button[][]): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
}

const keyboard = (buttons?: Button[][]) =>
  buttons && buttons.length > 0
    ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } }
    : { reply_markup: { inline_keyboard: [] as never[] } };

export function createTelegramApi(token: string): TelegramApi {
  async function call<T>(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; result?: T }> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T } | null;
    return { ok: res.ok && json?.ok !== false, status: res.status, ...(json?.result !== undefined && { result: json.result }) };
  }

  return {
    async sendMessage(chatId, text, buttons) {
      // Status only in errors: the URL holds the bot token and the body holds your financial details.
      const r = await call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, ...(buttons && keyboard(buttons)) });
      if (!r.ok || !r.result) throw new Error(`Telegram sendMessage failed with status ${r.status}`);
      return r.result.message_id;
    },
    async editMessage(chatId, messageId, text, buttons) {
      const r = await call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...keyboard(buttons) });
      // 400 also means "message is not modified", which is harmless.
      if (!r.ok && r.status !== 400) throw new Error(`Telegram editMessageText failed with status ${r.status}`);
    },
    async answerCallback(callbackId, text) {
      const r = await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text && { text }) });
      if (!r.ok && r.status !== 400) throw new Error(`Telegram answerCallbackQuery failed with status ${r.status}`);
    },
  };
}
