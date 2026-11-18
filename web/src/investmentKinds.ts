import type { Holding } from "./api";

/** One line in a kind's purchase list: a buy, a sale, a purchase from before tracking (a lot), or what was held at the start. */
export interface KindPurchase {
  key: string;
  /** The day; empty for the opening balance, which has none. */
  date: string;
  kind: "buy" | "sell" | "lot" | "opening";
  holdingId: string;
  /** Set for a lot (it can be removed) and for a buy or sale (a quantity can be added to it). */
  lotId?: string;
  entryId?: string;
  /** A buy or sale of a holding counted by quantity that has no quantity yet. */
  needsQuantity?: boolean;
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

/** One holding's purchase lines: its buys and sales, earlier lots, and what was held before tracking. Unsorted. */
export function purchasesOf(h: Holding): KindPurchase[] {
  const out: KindPurchase[] = [];
  const isCounted = h.tracking === "units";
  for (const e of h.entries) {
    out.push({ key: `e${e.id}`, date: e.date, kind: e.kind, holdingId: h.id, entryId: e.id, needsQuantity: isCounted && e.unitsE4 === null, unitsE4: e.unitsE4, amountPaise: e.amountPaise, accountName: e.accountName, holdingName: h.name });
  }
  for (const l of h.lots) out.push({ key: `l${l.id}`, date: l.date, kind: "lot", holdingId: h.id, lotId: l.id, unitsE4: l.unitsE4, amountPaise: l.costPaise, accountName: null, holdingName: h.name });
  // What was held before tracking, with no purchase to show for it: the quantity is what is left once every purchase is taken off.
  const bought = h.entries.reduce((sum, e) => sum + (e.kind === "buy" ? (e.unitsE4 ?? 0) : -(e.unitsE4 ?? 0)), 0) + h.lots.reduce((sum, l) => sum + l.unitsE4, 0);
  const openingUnits = isCounted ? Math.max(0, h.unitsHeldE4 - bought) : 0;
  if (h.openingInvestedPaise > 0 || openingUnits > 0) {
    out.push({ key: `o${h.id}`, date: "", kind: "opening", holdingId: h.id, unitsE4: openingUnits > 0 ? openingUnits : null, amountPaise: h.openingInvestedPaise, accountName: null, holdingName: h.name });
  }
  return out;
}

/** The newest first; the opening balance, which has no day, last. */
export const byNewest = (list: KindPurchase[]): KindPurchase[] => [...list].sort((x, y) => y.date.localeCompare(x.date) || x.key.localeCompare(y.key));

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

  const purchases: KindPurchase[] = mine.flatMap(purchasesOf);

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
    purchases: byNewest(purchases),
  };
}

/** The active holdings that are in no broker account, as one summary per kind, the most valuable first. */
export function looseByKind(holdings: Holding[], knownAccountIds: Set<string>): KindSummary[] {
  const loose = holdings.filter((h) => h.status === "active" && (!h.investmentAccountId || !knownAccountIds.has(h.investmentAccountId)));
  const kinds = new Map<string, string>();
  for (const h of loose) kinds.set(h.kind, h.kindName);
  return [...kinds.entries()].map(([key, name]) => kindSummary(key, name, loose)).sort((a, b) => b.valuePaise - a.valuePaise || a.kindName.localeCompare(b.kindName));
}
