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

/**
 * A figure small enough to remember: the full amount under ₹1,00,000 (₹45,000), then lakhs ("₹1.5 L", "₹7.23 L") and crores
 * ("₹7.23 Cr") to two decimals with trailing zeros dropped. For glance views only; the exact figure belongs in the detail.
 */
export function formatRupeesCompact(paise: number, options: { symbol?: boolean } = {}): string {
  if (!isPaise(paise)) throw new RangeError("formatRupeesCompact expects integer paise");
  const abs = Math.abs(paise);
  const LAKH = 10_000_000; // paise in one lakh rupees
  const CRORE = 1_000_000_000; // paise in one crore rupees
  if (abs < LAKH) return formatRupees(paise, options);
  const symbol = options.symbol === false ? "" : "₹";
  const sign = paise < 0 ? "-" : "";
  // Hundredths of a lakh; a lakh figure that rounds up to 100 L is shown in crores instead.
  let unit = "L";
  let hundredths = Math.round(abs / 100_000);
  if (abs >= CRORE || hundredths >= 10_000) {
    unit = "Cr";
    hundredths = Math.round(abs / 10_000_000);
  }
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  const decimals = fraction === 0 ? "" : `.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
  return `${sign}${symbol}${groupIndian(String(whole))}${decimals} ${unit}`;
}

/**
 * Text typed into an amount box, tidied as it is typed: only digits, one decimal point (up to two places) and, where
 * allowed, a leading minus; the whole part grouped the Indian way ("1234567" becomes "12,34,567"). A trailing point is kept so
 * "1,200." can go on to "1,200.5".
 */
export function formatAmountInput(raw: string, allowNegative = false): string {
  const negative = allowNegative && raw.trim().startsWith("-");
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  const whole = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/^0+(?=\d)/, "").slice(0, 12);
  const fraction = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  const body = groupIndian(whole === "" && fraction !== null ? "0" : whole) + (fraction === null ? "" : `.${fraction}`);
  return `${negative ? "-" : ""}${body}`;
}

/** Where the caret belongs in `formatted` once `count` digits or points have been typed before it. */
export function caretAfter(formatted: string, count: number): number {
  if (count <= 0) return formatted.startsWith("-") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/[0-9.]/.test(formatted[i] as string)) {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return formatted.length;
}
