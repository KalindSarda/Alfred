import type { IstDate } from "./dates";

/**
 * The salary day plan and the morning push: small pure rules about what to say. Where the numbers come from is the
 * commitments view; these only decide how to spread them and what deserves a message.
 */

const days = (from: IstDate, to: IstDate): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** What is free to spend each day until the window ends, in whole paise; null when nothing is free or the window is a day or less. */
export function perDayPaise(freePaise: number, from: IstDate, until: IstDate): { paise: number; days: number } | null {
  const n = days(from, until);
  if (freePaise <= 0 || n < 1) return null;
  return { paise: Math.floor(freePaise / n), days: n };
}

export interface GoalWish {
  id: string;
  name: string;
  monthlyNeededPaise: number | null;
  needsAttention: boolean;
  targetDate: IstDate | null;
}

/** The goals that want money this month, those running out of time first, at most three. */
export function goalAsks(goals: readonly GoalWish[], limit = 3): { id: string; name: string; paise: number }[] {
  return goals
    .filter((g) => g.monthlyNeededPaise !== null && g.monthlyNeededPaise > 0)
    .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((g) => ({ id: g.id, name: g.name, paise: g.monthlyNeededPaise as number }));
}

export interface Line {
  key: string;
  text: string;
  section?: string;
  /** Something to do now or within two days. */
  soon?: boolean;
}

/**
 * The briefing lines that are worth a message of their own in the morning: what needs the person (the first section) and
 * anything due within two days. Where they stand, progress and trends are for when they look; empty means there is nothing
 * worth waking someone for.
 */
export const pushLines = <T extends Line>(lines: readonly T[]): T[] => lines.filter((l) => l.section === "needs" || l.soon === true);
