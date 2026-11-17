/** The colours the Plan overview uses, handed to accounts in turn. */
export const ACCOUNT_COLORS = ["#2b6cde", "#0f8f6e", "#7a5ea8", "#d98a1f", "#c2457a", "#6b7280"];

/** A colour per account that stays the same: its place among all the person's accounts by name. */
export function accountColors(accounts: { id: string; name: string }[]): Map<string, string> {
  const sorted = [...accounts].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return new Map(sorted.map((a, i) => [a.id, ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] as string]));
}

/** How this month compares with the same days last month for one account. */
export type SpendChange = { kind: "new" } | { kind: "same" } | { kind: "up" | "down"; paise: number };

export function spendChange(spentPaise: number, previousPaise: number): SpendChange {
  if (previousPaise === 0) return spentPaise > 0 ? { kind: "new" } : { kind: "same" };
  const diff = spentPaise - previousPaise;
  return diff === 0 ? { kind: "same" } : { kind: diff > 0 ? "up" : "down", paise: Math.abs(diff) };
}
