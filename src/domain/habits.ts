import { addDays, type IstDate } from "./dates";
import { weekdayOf } from "./recurring";

/**
 * The logging habit: when to nudge someone who has gone quiet, and which of their usual spends to offer as one-tap
 * buttons. Pure rules.
 */

/** Days since the person last logged (0 = today). Null when they never have, so there is nothing to nudge about. */
export function silentDaysSince(lastLogged: IstDate | null, today: IstDate): number | null {
  if (lastLogged === null) return null;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastLogged}T00:00:00Z`)) / 86_400_000));
}

/**
 * Whether tonight's check-in goes out: every night for the first four silent days, then every third day up to a month,
 * then not at all until something is logged.
 */
export function shouldNudge(silentDays: number): boolean {
  if (silentDays <= 0) return false;
  if (silentDays <= 4) return true;
  if (silentDays > 30) return false;
  return (silentDays - 4) % 3 === 0;
}

export interface UsualEntry {
  id: string;
  type: string;
  amountPaise: number;
  merchant: string | null;
  note: string | null;
  accountId: string;
  txnDate: IstDate;
}

export interface UsualItem {
  /** The latest matching entry, copied when the person taps the button. */
  templateId: string;
  name: string;
  amountPaise: number;
  count: number;
}

const DAYS_BACK = 60;
const MIN_COUNT = 3;
const isWeekend = (d: IstDate) => weekdayOf(d) >= 6;

/**
 * The spends the person repeats: the same merchant (or note), amount and account at least three times in the last sixty
 * days, those that fall on days like today (a weekday or a weekend) first, and none already logged today.
 */
export function usualItems(entries: readonly UsualEntry[], today: IstDate, limit = 3): UsualItem[] {
  const from = addDays(today, -DAYS_BACK);
  const groups = new Map<string, { name: string; amountPaise: number; entries: UsualEntry[] }>();
  const loggedToday = new Set<string>();
  for (const e of entries) {
    if (e.type !== "expense") continue;
    const name = (e.merchant ?? e.note ?? "").trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}|${e.amountPaise}|${e.accountId}`;
    if (e.txnDate === today) loggedToday.add(key);
    if (e.txnDate < from || e.txnDate >= today) continue;
    const g = groups.get(key) ?? { name, amountPaise: e.amountPaise, entries: [] };
    g.entries.push(e);
    groups.set(key, g);
  }

  const todayIsWeekend = isWeekend(today);
  const ranked = [...groups.entries()]
    .filter(([key, g]) => g.entries.length >= MIN_COUNT && !loggedToday.has(key))
    .map(([, g]) => {
      const alike = g.entries.filter((e) => isWeekend(e.txnDate) === todayIsWeekend).length;
      const share = alike / g.entries.length;
      const latest = [...g.entries].sort((a, b) => b.txnDate.localeCompare(a.txnDate) || b.id.localeCompare(a.id))[0] as UsualEntry;
      return { g, share, score: g.entries.length * (0.5 + share), latest };
    })
    .filter((r) => r.share >= 0.34)
    .sort((a, b) => b.score - a.score || b.g.entries.length - a.g.entries.length || a.g.name.localeCompare(b.g.name));

  return ranked.slice(0, limit).map((r) => ({ templateId: r.latest.id, name: r.g.name, amountPaise: r.g.amountPaise, count: r.g.entries.length }));
}
