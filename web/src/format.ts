import { formatRupees, parsePaise } from "../../src/domain/money";
import { todayIst } from "../../src/domain/dates";

export const rupees = (paise: number): string => formatRupees(paise);

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

export const paiseToInput = (paise: number): string =>
  paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);

export const today = (): string => todayIst();

export const newKey = (): string => crypto.randomUUID();
