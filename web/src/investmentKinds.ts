import type { Holding } from "./api";

/** One line in a kind's purchase list: a buy, a sale, or a purchase from before tracking (a lot). */
export interface KindPurchase {
  key: string;
  date: string;
  kind: "buy" | "sell" | "lot";
  /** The quantity, when counted by quantity and known. */
  unitsE4: number | null;
  /** What it cost (a buy or a lot) or fetched (a sale). */
  amountPaise: number;
  /** The account it was paid from, when there is one. */
  accountName: string | null;
  holdingName: string;
}

export interface KindSummary {
  kindKey: string;
  kindName: string;
  holdings: Holding[];
  valuePaise: number;
  investedPaise: number;
  gainPaise: number;
  /** Gain as a share of what was put in, one decimal; null when nothing was put in. */
  gainPct: number | null;
  /** Whether any holding is counted by quantity (so there is a quantity and a rate). */
  counted: boolean;
  /** The quantity held across holdings counted by quantity; null when none is. */
  unitsE4: number | null;
  unitLabel: string | null;
  /** The latest rate typed on any of them, the quantity it is quoted for, and the day. */
  rate: { paise: number; per: number; unitOne: string; date: string | null } | null;
  /** Buys, sales and earlier lots of every holding, newest first. */
  purchases: KindPurchase[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Totals and the purchase list for the active holdings of one kind. */
export function kindSummary(kindKey: string, kindName: string, holdings: Holding[]): KindSummary {
  const mine = holdings.filter((h) => h.kind === kindKey && h.status === "active");
  const valuePaise = mine.reduce((s, h) => s + h.valuePaise, 0);
  const investedPaise = mine.reduce((s, h) => s + h.investedPaise, 0);
  const gainPaise = mine.reduce((s, h) => s + h.gainPaise, 0);
  const counted = mine.filter((h) => h.tracking === "units");

  const withRate = counted.filter((h) => h.ratePaise !== null);
  const latest = [...withRate].sort((a, b) => (b.valueDate ?? "").localeCompare(a.valueDate ?? ""))[0];

  const purchases: KindPurchase[] = [];
  for (const h of mine) {
    for (const e of h.entries) purchases.push({ key: `e${e.id}`, date: e.date, kind: e.kind, unitsE4: e.unitsE4, amountPaise: e.amountPaise, accountName: e.accountName, holdingName: h.name });
    for (const l of h.lots) purchases.push({ key: `l${l.id}`, date: l.date, kind: "lot", unitsE4: l.unitsE4, amountPaise: l.costPaise, accountName: null, holdingName: h.name });
  }
  purchases.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));

  return {
    kindKey,
    kindName,
    holdings: mine,
    valuePaise,
    investedPaise,
    gainPaise,
    gainPct: investedPaise > 0 ? round1((gainPaise / investedPaise) * 100) : null,
    counted: counted.length > 0,
    unitsE4: counted.length > 0 ? counted.reduce((s, h) => s + h.unitsHeldE4, 0) : null,
    unitLabel: counted[0]?.unitLabel ?? null,
    rate: latest && latest.ratePaise !== null ? { paise: latest.ratePaise, per: latest.ratePer, unitOne: latest.unitOne ?? latest.unitLabel ?? "unit", date: latest.valueDate } : null,
    purchases,
  };
}

/** The active holdings that are in no broker account, as one summary per kind, the most valuable first. */
export function looseByKind(holdings: Holding[], knownAccountIds: Set<string>): KindSummary[] {
  const loose = holdings.filter((h) => h.status === "active" && (!h.investmentAccountId || !knownAccountIds.has(h.investmentAccountId)));
  const kinds = new Map<string, string>();
  for (const h of loose) kinds.set(h.kind, h.kindName);
  return [...kinds.entries()].map(([key, name]) => kindSummary(key, name, loose)).sort((a, b) => b.valuePaise - a.valuePaise || a.kindName.localeCompare(b.kindName));
}
