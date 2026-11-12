import { foundationLines, transferLines } from "../alfred/botVoice";
import { createTransferProposal } from "../bot/pending";
import type { Db } from "../db/client";
import type { IstDate } from "../domain/dates";
import { formatRupees } from "../domain/money";
import { getLadder } from "./ladder";
import { getTransferSuggestion } from "./transfer";

export interface Offer {
  text: string;
  buttons: { text: string; data: string }[][];
}

/**
 * What could move into the emergency fund today, in words, with a button to record the move once the person has made it
 * at the bank. The button carries a stored proposal (the accounts and the amount), so pressing it twice records once.
 * Without a chat there is only the text.
 */
export async function transferOffer(db: Db, userId: string, today: IstDate, chat?: { chatId: string; nowMs: number }): Promise<{ suggested: boolean; text: string; buttons: Offer["buttons"] }> {
  const view = await getTransferSuggestion(db, userId, today);
  const text = transferLines(view).join("\n");
  if (view.none !== null || !view.from || !view.to || !chat) return { suggested: view.none === null, text, buttons: [] };
  const id = await createTransferProposal(db, userId, chat.chatId, view.from.id, view.to.id, view.amountPaise, chat.nowMs);
  return { suggested: true, text, buttons: [[{ text: `Record ${formatRupees(view.amountPaise)} moved`, data: `t:${id}:y` }, { text: "Not now", data: `t:${id}:n` }]] };
}

/** The ladder, then the transfer suggestion, as the /fund command shows them. */
export async function fundOffer(db: Db, userId: string, today: IstDate, chat: { chatId: string; nowMs: number }): Promise<Offer> {
  const [ladder, offer] = await Promise.all([getLadder(db, userId, today), transferOffer(db, userId, today, chat)]);
  return { text: [...foundationLines(ladder.rows, ladder.flows), "", ...offer.text.split("\n")].join("\n"), buttons: offer.buttons };
}
