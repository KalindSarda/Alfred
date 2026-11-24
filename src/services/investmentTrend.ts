import type { Db } from "../db/client";
import type { IstDate } from "../domain/dates";
import type { HoldingFacts } from "../domain/holdings";
import { growthSplit, isEmptyStand, type Stand, trendDates, type TrendRange } from "../domain/investmentTrend";
import { splitHolding } from "../domain/partners";
import { loadHoldings } from "./holdings";

export interface TrendPoint {
  asOf: IstDate;
  /** Your share of what everything was worth, and what you had put in and taken out by then. */
  worthPaise: number;
  putInPaise: number;
  soldPaise: number;
  /** Since the point before: money added (net of what was taken out) and what the market did. */
  addedPaise: number;
  growthPaise: number;
}

export interface TrendSeries {
  key: string;
  name: string;
  /** Your share of its worth at each point, in the same order as the points. */
  worthPaise: number[];
}

export interface InvestmentTrend {
  range: TrendRange;
  points: TrendPoint[];
  byKind: TrendSeries[];
  byBroker: TrendSeries[];
}

const NO_BROKER = "none";

/**
 * What your investments were worth, and what you had put in, on each of a run of days, rebuilt from the typed values and entries on
 * the books (nothing is stored): the total, and by kind and by broker. Only your share of a shared holding counts, and a closed one
 * counts as it stood then. Days before the first investment are left out. History before prices were linked is only as fine as the
 * values typed then, so it can look flat or stepped.
 */
export async function getInvestmentTrend(db: Db, userId: string, today: IstDate, range: TrendRange): Promise<InvestmentTrend> {
  const loaded = await loadHoldings(db, userId);
  const days = trendDates(today, range);

  const kindName = new Map<string, string>([...loaded.kinds.values()].map((k) => [k.key, k.name]));
  const kindOf = new Map(loaded.rows.map((r) => [r.id, r.kind]));
  const brokerOf = new Map(loaded.rows.map((r) => [r.id, r.investmentAccountId && loaded.brokers.has(r.investmentAccountId) ? r.investmentAccountId : NO_BROKER]));

  const byKind = new Map<string, number[]>();
  const byBroker = new Map<string, number[]>();
  const stands: Stand[] = [];
  days.forEach((asOf, i) => {
    const stand: Stand = { worthPaise: 0, putInPaise: 0, soldPaise: 0 };
    const kindDay = new Map<string, number>();
    const brokerDay = new Map<string, number>();
    for (const row of loaded.rows) {
      const s = splitHolding(loaded.facts.get(row.id) as HoldingFacts, loaded.stakes.get(row.id) ?? [], asOf);
      stand.worthPaise += s.myValuePaise;
      stand.putInPaise += s.myPutInPaise;
      stand.soldPaise += s.mySoldPaise;
      const kind = kindOf.get(row.id) as string;
      const broker = brokerOf.get(row.id) as string;
      kindDay.set(kind, (kindDay.get(kind) ?? 0) + s.myValuePaise);
      brokerDay.set(broker, (brokerDay.get(broker) ?? 0) + s.myValuePaise);
    }
    stands.push(stand);
    for (const [k, v] of kindDay) (byKind.get(k) ?? byKind.set(k, new Array(days.length).fill(0)).get(k) as number[])[i] = v;
    for (const [k, v] of brokerDay) (byBroker.get(k) ?? byBroker.set(k, new Array(days.length).fill(0)).get(k) as number[])[i] = v;
  });

  // Drop the days before anything was invested.
  let first = stands.findIndex((s) => !isEmptyStand(s));
  if (first < 0) first = stands.length;
  const kept = stands.slice(first);
  const points: TrendPoint[] = kept.map((s, i) => ({ asOf: days[first + i] as IstDate, ...s, ...growthSplit(i === 0 ? null : (kept[i - 1] as Stand), s) }));

  const brokerNames = new Map(loaded.brokers);
  const series = (map: Map<string, number[]>, name: (key: string) => string): TrendSeries[] =>
    [...map.entries()]
      .map(([key, all]) => ({ key, name: name(key), worthPaise: all.slice(first) }))
      .filter((s) => s.worthPaise.some((v) => v !== 0))
      .sort((a, b) => (b.worthPaise.at(-1) ?? 0) - (a.worthPaise.at(-1) ?? 0) || a.name.localeCompare(b.name));

  return {
    range,
    points,
    byKind: series(byKind, (k) => kindName.get(k) ?? k),
    byBroker: series(byBroker, (k) => (k === NO_BROKER ? "Not in a broker account" : (brokerNames.get(k) ?? "Broker account"))),
  };
}
