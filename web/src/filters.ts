import { resolvePeriod, type PeriodKey } from "../../src/domain/dates";
import { parsePaise } from "../../src/domain/money";
import type { TxnType } from "./api";
import { today } from "./format";

/**
 * Transaction filters. They live in the page address (?q=...&category=none), so any link in the app,
 * such as the Alfred briefing or a chart row, can open the list already filtered.
 */
export interface TxnFilters {
  q: string;
  account: string;
  /** Category ids; "none" means entries without a category. */
  categories: string[];
  type: "" | TxnType;
  status: "" | "draft" | "confirmed";
  from: string;
  to: string;
  /** Rupees as typed by the user. */
  min: string;
  max: string;
}

export const emptyFilters: TxnFilters = {
  q: "",
  account: "",
  categories: [],
  type: "",
  status: "",
  from: "",
  to: "",
  min: "",
  max: "",
};

const TYPES = new Set(["expense", "income", "transfer", "bill_payment"]);

export function filtersFromSearch(search: string): TxnFilters {
  const p = new URLSearchParams(search);
  const type = p.get("type") ?? "";
  const status = p.get("status") ?? "";
  return {
    q: p.get("q") ?? "",
    account: p.get("account") ?? "",
    categories: (p.get("category") ?? "").split(",").filter(Boolean),
    type: TYPES.has(type) ? (type as TxnType) : "",
    status: status === "draft" || status === "confirmed" ? status : "",
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
    min: p.get("min") ?? "",
    max: p.get("max") ?? "",
  };
}

export function filtersToSearch(f: TxnFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.account) p.set("account", f.account);
  if (f.categories.length) p.set("category", f.categories.join(","));
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.min) p.set("min", f.min);
  if (f.max) p.set("max", f.max);
  const text = p.toString();
  return text ? `?${text}` : "";
}

/** "/transactions?category=none" style link for a set of filters. */
export const transactionsLink = (f: Partial<TxnFilters>): string => `/transactions${filtersToSearch({ ...emptyFilters, ...f })}`;

/** Rupee text to paise; null when it is empty or not a valid positive amount. */
export function rupeesToPaise(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/^0+(\.0{1,2})?$/.test(trimmed)) return 0;
  return parsePaise(trimmed);
}

/** Query string for GET /api/transactions (without paging). */
export function toApiParams(f: TxnFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.account) p.set("accountId", f.account);
  if (f.categories.length) p.set("categoryId", f.categories.join(","));
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  const min = rupeesToPaise(f.min);
  const max = rupeesToPaise(f.max);
  if (min !== null) p.set("minAmountPaise", String(min));
  if (max !== null) p.set("maxAmountPaise", String(max));
  return p;
}

export const PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
];

/** The preset whose range matches the current from/to, if any. */
export function activePreset(f: TxnFilters): PeriodKey | null {
  if (!f.from || !f.to) return null;
  const now = today();
  for (const { key } of PRESETS) {
    const range = resolvePeriod(key, now);
    if (range.from === f.from && range.to === f.to) return key;
  }
  return null;
}

export function applyPreset(f: TxnFilters, key: PeriodKey | ""): TxnFilters {
  if (!key) return { ...f, from: "", to: "" };
  const range = resolvePeriod(key, today());
  return { ...f, from: range.from, to: range.to };
}

export function activeFilterCount(f: TxnFilters): number {
  return [f.account, f.type, f.status, f.min, f.max].filter(Boolean).length + (f.categories.length ? 1 : 0) + (f.from || f.to ? 1 : 0);
}
