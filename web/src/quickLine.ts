import { type EntryType, inferType, type ParsedEntry, type ParseFailure, parseEntry, type Resolution } from "../../src/bot/parser";
import type { IstDate } from "../../src/domain/dates";
import { formatRupees } from "../../src/domain/money";
import type { EntryHints } from "./api";

/**
 * The New-entry form's one-line add: "450 swiggy hdfc yesterday". It reads the line with the same parser Telegram
 * uses, and the merchant memory both share. Pure, so it can be tested without a browser.
 */

export interface QuickCtx {
  today: IstDate;
  accounts: readonly { id: string; name: string; kind: "bank" | "card" }[];
  categories: readonly { id: string; name: string; kind: "expense" | "income" }[];
  hints: EntryHints | undefined;
}

/** What the line filled in. A field it did not find is left out, so the form keeps what is there. */
export interface QuickFill {
  type: EntryType;
  amountPaise: number;
  txnDate: IstDate;
  accountId?: string;
  /** True when the line named the account itself, rather than the merchant's usual one being suggested. */
  accountNamed: boolean;
  toAccountId?: string;
  categoryId?: string;
  merchant?: string;
}

export type QuickResult = { ok: true; fill: QuickFill; entry: ParsedEntry } | { ok: false; reason: ParseFailure };

const foundId = (r: Resolution): string | undefined => (r.status === "found" ? r.id : undefined);

/** Memory in the shape the parser wants: lower-cased merchant to its usual category and account. */
function merchantMemory(hints: EntryHints | undefined) {
  return new Map((hints?.merchants ?? []).map((m) => [m.merchant.toLowerCase(), { categoryId: m.categoryId, accountId: m.accountId }]));
}

/** A transfer or bill payment chosen on the form keeps its type; anything else is read from the words. */
export function parseQuickLine(text: string, selected: string, ctx: QuickCtx): QuickResult {
  const type: EntryType = selected === "transfer" || selected === "bill_payment" ? selected : inferType(text);
  const result = parseEntry(text, type, { today: ctx.today, accounts: ctx.accounts, categories: ctx.categories, merchants: merchantMemory(ctx.hints) });
  if (!result.ok) return result;
  const e = result.entry;
  const accountId = foundId(e.from) ?? e.suggestedAccountId ?? undefined;
  const fill: QuickFill = {
    type: e.type,
    amountPaise: e.amountPaise,
    txnDate: e.txnDate,
    accountNamed: e.from.status === "found",
    ...(accountId ? { accountId } : {}),
    ...(foundId(e.to) ? { toAccountId: foundId(e.to) as string } : {}),
    ...(e.categoryId ? { categoryId: e.categoryId } : {}),
    ...(e.merchant ? { merchant: e.merchant } : {}),
  };
  return { ok: true, fill, entry: e };
}

const LABEL: Record<EntryType, string> = { expense: "Expense", income: "Income", transfer: "Transfer", bill_payment: "Card bill" };

const failureText: Record<ParseFailure, string> = {
  empty: "",
  no_amount: "Start with the amount, such as 450 swiggy.",
  bad_date: "That date does not look right.",
};
export const quickFailure = (reason: ParseFailure): string => failureText[reason];

/** One sentence saying what the line understood, so a wrong guess is easy to spot. */
export function describeQuickLine(fill: QuickFill, names: { accounts: ReadonlyMap<string, string>; categories: ReadonlyMap<string, string> }, today: IstDate): string {
  const parts: string[] = [LABEL[fill.type], formatRupees(fill.amountPaise)];
  if (fill.merchant) parts.push(fill.merchant);
  if (fill.categoryId && names.categories.get(fill.categoryId)) parts.push(names.categories.get(fill.categoryId) as string);
  const account = fill.accountId ? names.accounts.get(fill.accountId) : undefined;
  const verb = fill.type === "income" ? "into" : "from";
  if (account) parts.push(`${verb} ${account}${fill.accountNamed ? "" : " (usual)"}`);
  if (fill.toAccountId && names.accounts.get(fill.toAccountId)) parts.push(`to ${names.accounts.get(fill.toAccountId)}`);
  parts.push(fill.txnDate === today ? "today" : fill.txnDate);
  return parts.join(" · ");
}

/** The account to start on: the one used most lately that this kind of entry allows, else the first. */
export function defaultAccountId(options: readonly { id: string }[], lastUsedIds: readonly string[]): string {
  for (const id of lastUsedIds) if (options.some((o) => o.id === id)) return id;
  return options[0]?.id ?? "";
}

/** What a merchant usually is, if it has been used before and its category fits this kind of entry. */
export function memoryFor(
  merchant: string,
  hints: EntryHints | undefined,
  kind: "expense" | "income",
  categories: readonly { id: string; kind: "expense" | "income" }[],
): { categoryId: string | null; accountId: string } | null {
  const key = merchant.trim().toLowerCase();
  if (!key) return null;
  const hint = hints?.merchants.find((m) => m.merchant.toLowerCase() === key);
  if (!hint) return null;
  const fits = hint.categoryId !== null && categories.some((c) => c.id === hint.categoryId && c.kind === kind);
  return { categoryId: fits ? hint.categoryId : null, accountId: hint.accountId };
}

/** The merchants used most often, for one-tap chips; ties go to the more recent. */
export function topMerchants(hints: EntryHints | undefined, n: number): EntryHints["merchants"] {
  return (hints?.merchants ?? [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.count - a.m.count || a.i - b.i)
    .slice(0, n)
    .map((x) => x.m);
}
