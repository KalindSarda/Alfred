import { formatAmountInput, formatRupees, formatRupeesCompact, parsePaise } from "../../src/domain/money";
import { todayIst } from "../../src/domain/dates";

export const rupees = (paise: number): string => formatRupees(paise);

/** For glance views: ₹45,000 stays as it is, then ₹1.5 L and ₹7.23 Cr. The exact figure belongs in the detail. */
export const rupeesCompact = (paise: number): string => formatRupeesCompact(paise);

/** "27 Oct" from an IST calendar date such as "2026-10-27". */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Tue, 27 Oct" for list group headings. */
export function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Like parsePaise but allows zero, an empty box (as zero) and a leading minus, for opening balances. */
export function parseSignedPaise(input: string): number | null {
  const text = input.trim().replace(/,/g, "");
  if (text === "" || /^-?0+(\.0{1,2})?$/.test(text)) return 0;
  const negative = text.startsWith("-");
  const paise = parsePaise(negative ? text.slice(1) : text);
  return paise === null ? null : negative ? -paise : paise;
}

/** A stored amount as it is shown in an amount box: grouped the Indian way ("12,34,567.50"). */
export const paiseToInput = (paise: number): string => formatAmountInput(paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2), true);

/** A quantity typed as "15.2" (up to four decimals) in whole 1/10,000 units; null when it is not a positive number. */
export function qtyToE4(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  const n = Math.round(Number.parseFloat(t) * 10_000);
  return n > 0 ? n : null;
}

export const e4ToQty = (e4: number): string => String(Math.round(e4) / 10_000);

export const today = (): string => todayIst();

export const newKey = (): string => crypto.randomUUID();
