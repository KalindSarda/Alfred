/** The kinds of investment every person starts with. Keys are what `holdings.kind` stores, so they never change. */
export interface DefaultKind {
  key: string;
  name: string;
  /** Counted by quantity in this unit; null means valued by typing. */
  unit: string | null;
  ratePer: number;
  isSystem: boolean;
  /** Whether it is held through a broker account: required, optional or never. */
  brokerUse: "required" | "optional" | "never";
}

export const DEFAULT_HOLDING_KINDS: readonly DefaultKind[] = [
  { key: "stock", name: "Stock or IPO", unit: "shares", ratePer: 1, isSystem: true, brokerUse: "required" },
  { key: "fund", name: "Mutual fund", unit: "units", ratePer: 1, isSystem: false, brokerUse: "required" },
  { key: "gold", name: "Gold", unit: "g", ratePer: 10, isSystem: false, brokerUse: "never" },
  { key: "crypto", name: "Crypto", unit: null, ratePer: 1, isSystem: false, brokerUse: "required" },
  { key: "retirement", name: "Retirement (EPF, PPF, NPS)", unit: null, ratePer: 1, isSystem: false, brokerUse: "never" },
  { key: "other", name: "Other", unit: null, ratePer: 1, isSystem: true, brokerUse: "never" },
];
