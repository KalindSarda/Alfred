/** All money is integer paise. Rupee strings exist only at the input/display edge. */

export function isPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Parses user text such as "450", "450.5", "1,200", "₹1,200.75" or "rs 99" into integer paise.
 * Returns null for anything ambiguous: more than 2 decimals, zero, negatives, junk.
 */
export function parsePaise(input: string): number | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^(₹|rs\.?|inr)\s*/, "")
    .replace(/,/g, "");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fraction = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const paise = rupees * 100 + fraction;
  return paise > 0 && Number.isSafeInteger(paise) ? paise : null;
}

/** Indian digit grouping: 20000000 paise -> "2,00,000". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** "₹2,00,000" for whole rupees, "₹1,234.50" otherwise; negatives render as "-₹450". */
export function formatRupees(paise: number, options: { symbol?: boolean } = {}): string {
  if (!isPaise(paise)) throw new RangeError("formatRupees expects integer paise");
  const symbol = options.symbol === false ? "" : "₹";
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const body = groupIndian(String(whole)) + (fraction ? `.${String(fraction).padStart(2, "0")}` : "");
  return `${paise < 0 ? "-" : ""}${symbol}${body}`;
}
