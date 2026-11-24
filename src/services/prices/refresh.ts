import { and, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../config/errors";
import type { Db } from "../../db/client";
import { appSettings, holdingValues, priceLinks } from "../../db/schema";
import type { IstDate } from "../../domain/dates";
import { type UnitsFacts, latestRate, unitsHeldE4, valueAtRate } from "../../domain/holdings";
import { nowIso } from "../../utils/id";
import { applyAutoRates, convertToUnits, getHolding, loadHoldings, type HoldingDto } from "../holdings";
import { type AmfiScheme, type Candidate, type FetchFn, FeedError, type IbjaRates, type Quote, amfiSchemes, ibjaRates, kindRatePaise, searchAmfi, yahooQuote, yahooSearch } from "./feeds";

/** At most this many symbols from Yahoo in one run: a Worker may make only so many outside requests, and a weekly refresh does not need more. */
const MAX_SYMBOLS = 40;
/** A price older than this many days is not used (a market holiday or two is fine). */
const STALE_AFTER_DAYS = 10;
/** A move of more than this since the last price is held back and shown for the person to check, not written. */
const JUMP_LIMIT = 0.4;
const CHUNK = 6;

export type PriceStatus = "updated" | "unchanged" | "typed_today" | "held" | "failed";

export interface PriceOutcome {
  holdingId: string;
  name: string;
  /** Where the price came from. */
  source: "Yahoo" | "AMFI" | "IBJA";
  status: PriceStatus;
  /** The rate (per share, per NAV unit, or per the kind's quantity) now, and before. */
  ratePaise: number | null;
  previousPaise: number | null;
  /** How much the holding's worth changed: the quantity held times the change in rate. */
  changePaise: number;
  /** Why a price was not used. */
  reason: string | null;
}

export interface RefreshResult {
  checkedAt: string;
  items: PriceOutcome[];
  updated: number;
  unchanged: number;
  typedToday: number;
  held: number;
  failed: number;
  changePaise: number;
}

const daysBetween = (from: IstDate, to: IstDate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const asFeedError = (e: unknown) => (e instanceof FeedError ? e : new FeedError("the price could not be fetched"));

interface Target {
  id: string;
  name: string;
  units: UnitsFacts;
  held: number;
  link: { feed: "yahoo" | "amfi"; code: string } | null;
  kindFeed: { feed: "gold" | "silver" } | null;
}

/**
 * Fetches the price of every active investment that is linked to a feed (a stock or ETF, a fund) or sits in a gold or silver kind with
 * a feed, and writes it as today's rate. A price that is missing, old, or far from the last one is not written; a value the person
 * typed today is never replaced. Whatever cannot be fetched keeps its old price. It tells what it did for each.
 */
export async function refreshPrices(db: Db, userId: string, today: IstDate, fetchFn: FetchFn): Promise<RefreshResult> {
  const loaded = await loadHoldings(db, userId);
  const targets: Target[] = [];
  for (const row of loaded.rows) {
    const f = loaded.facts.get(row.id);
    if (row.status !== "active" || row.tracking !== "units" || !f?.units) continue;
    const link = loaded.links.get(row.id) ?? null;
    const kind = loaded.kinds.get(row.kind);
    const kindFeed = !link && kind?.feed && row.investmentAccountId === null ? { feed: kind.feed } : null;
    if (!link && !kindFeed) continue;
    targets.push({ id: row.id, name: row.name, units: f.units, held: unitsHeldE4(f.units, today), link: link ? { feed: link.feed, code: link.code } : null, kindFeed });
  }

  // One request each for the whole of AMFI's file and IBJA's page; Yahoo one per symbol, a few at a time.
  const yahoo = new Map<string, Quote | FeedError>();
  const symbols = [...new Set(targets.filter((t) => t.link?.feed === "yahoo").map((t) => (t.link as { code: string }).code))].slice(0, MAX_SYMBOLS);
  for (let i = 0; i < symbols.length; i += CHUNK) {
    await Promise.all(
      symbols.slice(i, i + CHUNK).map(async (code) => {
        try {
          yahoo.set(code, await yahooQuote(fetchFn, code));
        } catch (e) {
          yahoo.set(code, asFeedError(e));
        }
      }),
    );
  }
  let amfi: Map<string, AmfiScheme> | FeedError | null = null;
  if (targets.some((t) => t.link?.feed === "amfi")) {
    try {
      amfi = new Map((await amfiSchemes(fetchFn)).map((s) => [s.code, s]));
    } catch (e) {
      amfi = asFeedError(e);
    }
  }
  let ibja: IbjaRates | FeedError | null = null;
  if (targets.some((t) => t.kindFeed)) {
    try {
      ibja = await ibjaRates(fetchFn);
    } catch (e) {
      ibja = asFeedError(e);
    }
  }

  const items: PriceOutcome[] = [];
  const writes: { holdingId: string; ratePaise: number }[] = [];
  const pending = new Map<string, PriceOutcome>();
  for (const t of targets) {
    const source: PriceOutcome["source"] = t.kindFeed ? "IBJA" : t.link?.feed === "amfi" ? "AMFI" : "Yahoo";
    const previous = latestRate(t.units, today)?.ratePaise ?? null;
    const base = { holdingId: t.id, name: t.name, source, previousPaise: previous, ratePaise: null as number | null, changePaise: 0, reason: null as string | null };
    const fail = (reason: string) => items.push({ ...base, status: "failed", reason });

    let paise: number;
    let date: IstDate | null;
    if (t.kindFeed) {
      if (ibja === null || ibja instanceof FeedError) {
        fail(ibja instanceof FeedError ? ibja.message : "no price");
        continue;
      }
      paise = kindRatePaise(t.kindFeed.feed, t.units.ratePer, ibja);
      date = ibja.date;
    } else if (t.link?.feed === "amfi") {
      const scheme = amfi instanceof Map ? amfi.get(t.link.code) : undefined;
      if (amfi instanceof FeedError) {
        fail(amfi.message);
        continue;
      }
      if (!scheme) {
        fail(`AMFI has no fund with code ${t.link.code}`);
        continue;
      }
      paise = scheme.paise;
      date = scheme.date;
    } else {
      const quote = yahoo.get((t.link as { code: string }).code);
      if (!quote) {
        fail("left for next time (too many to fetch at once)");
        continue;
      }
      if (quote instanceof FeedError) {
        fail(quote.message);
        continue;
      }
      paise = quote.paise;
      date = quote.date;
    }

    if (!(paise > 0)) {
      fail("the price was not a number above zero");
      continue;
    }
    if (date && daysBetween(date, today) > STALE_AFTER_DAYS) {
      fail(`the latest price is from ${date}`);
      continue;
    }
    if (previous !== null && previous > 0 && Math.abs(paise - previous) / previous > JUMP_LIMIT) {
      const pct = Math.round(((paise - previous) / previous) * 100);
      items.push({ ...base, status: "held", ratePaise: paise, reason: `it moved ${pct > 0 ? "+" : ""}${pct}% since the last price, so I left it for you to check` });
      continue;
    }
    const change = previous === null ? 0 : valueAtRate(t.held, paise, t.units.ratePer) - valueAtRate(t.held, previous, t.units.ratePer);
    const outcome: PriceOutcome = { ...base, status: previous === paise ? "unchanged" : "updated", ratePaise: paise, changePaise: change };
    pending.set(t.id, outcome);
    writes.push({ holdingId: t.id, ratePaise: paise });
  }

  const written = await applyAutoRates(db, userId, today, writes);
  for (const [id, outcome] of pending) {
    const result = written.get(id);
    if (result === "typed_today") items.push({ ...outcome, status: "typed_today", changePaise: 0, reason: "you typed a price today, so I left it" });
    else if (result === "written") items.push(outcome);
    else items.push({ ...outcome, status: "failed", changePaise: 0, reason: "it is no longer counted by quantity" });
  }

  const checkedAt = nowIso();
  if (targets.length > 0) await db.insert(appSettings).values({ userId, pricesCheckedAt: checkedAt }).onConflictDoUpdate({ target: appSettings.userId, set: { pricesCheckedAt: checkedAt } });
  const count = (s: PriceStatus) => items.filter((i) => i.status === s).length;
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { checkedAt, items, updated: count("updated"), unchanged: count("unchanged"), typedToday: count("typed_today"), held: count("held"), failed: count("failed"), changePaise: items.reduce((s, i) => s + i.changePaise, 0) };
}

/** Matches for a name to confirm: stocks and ETFs from Yahoo (with today's price for the first few), funds from AMFI's file. */
export async function suggestMatches(fetchFn: FetchFn, kind: "stock" | "fund", query: string): Promise<Candidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (kind === "fund") return searchAmfi(await amfiSchemes(fetchFn), q);
  const found = await yahooSearch(fetchFn, q);
  return Promise.all(
    found.map(async (c, i) => {
      if (i >= 3) return c;
      try {
        return { ...c, paise: (await yahooQuote(fetchFn, c.code)).paise };
      } catch {
        return c;
      }
    }),
  );
}

export interface LinkInput {
  feed: "yahoo" | "amfi";
  code: string;
  label?: string | null | undefined;
  /** For an investment valued by typing (a fund): how many units are held, so its price can drive its worth. */
  unitsE4?: number | undefined;
}

/**
 * Links a holding to a feed after checking that the code gives a price now. An investment valued by typing needs its units, and is
 * switched to counting by quantity at that price. Today's price is written as an automatic rate.
 */
export async function linkPrice(db: Db, userId: string, holdingId: string, input: LinkInput, today: IstDate, fetchFn: FetchFn): Promise<{ holding: HoldingDto; ratePaise: number; date: IstDate | null }> {
  const loaded = await loadHoldings(db, userId);
  const row = loaded.rows.find((r) => r.id === holdingId);
  if (!row) throw new NotFoundError("Holding not found");
  if (row.status !== "active") throw invalid("holding", "This investment is closed");
  if (row.investmentAccountId === null && loaded.kinds.get(row.kind)?.feed) throw invalid("holding", "Its price comes from the kind's feed (gold or silver), so there is nothing to link");

  let quote: Quote;
  if (input.feed === "amfi") {
    const scheme = (await amfiSchemes(fetchFn)).find((s) => s.code === input.code);
    if (!scheme) throw invalid("code", `AMFI has no fund with code ${input.code}`);
    quote = { paise: scheme.paise, date: scheme.date };
  } else {
    quote = await yahooQuote(fetchFn, input.code);
  }

  if (row.tracking === "value") {
    if (!input.unitsE4) throw invalid("unitsE4", "Say how many units or shares you hold, so the price can set what it is worth");
    await convertToUnits(db, userId, holdingId, { unitsE4: input.unitsE4, ratePaise: quote.paise, date: today }, today);
    // The rate that conversion wrote is the feed's, not the person's.
    await db.update(holdingValues).set({ source: "auto" }).where(and(eq(holdingValues.holdingId, holdingId), eq(holdingValues.userId, userId), eq(holdingValues.date, today)));
  }
  await db
    .insert(priceLinks)
    .values({ holdingId, userId, feed: input.feed, code: input.code, label: input.label ?? null, createdAt: nowIso() })
    .onConflictDoUpdate({ target: priceLinks.holdingId, set: { feed: input.feed, code: input.code, label: input.label ?? null } });
  await applyAutoRates(db, userId, today, [{ holdingId, ratePaise: quote.paise }]);
  const checkedAt = nowIso();
  await db.insert(appSettings).values({ userId, pricesCheckedAt: checkedAt }).onConflictDoUpdate({ target: appSettings.userId, set: { pricesCheckedAt: checkedAt } });
  return { holding: await getHolding(db, userId, holdingId, today), ratePaise: quote.paise, date: quote.date };
}

export async function unlinkPrice(db: Db, userId: string, holdingId: string): Promise<void> {
  const removed = await db.delete(priceLinks).where(and(eq(priceLinks.holdingId, holdingId), eq(priceLinks.userId, userId))).returning({ id: priceLinks.holdingId });
  if (removed.length === 0) throw new NotFoundError("That investment is not linked to a price");
}

const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);

export interface FeedPreview {
  /** Today's benchmark for the kind's quantity, exactly as IBJA publishes it, and the day and session it is for. */
  ratePaise: number;
  date: IstDate;
  session: "AM" | "PM";
  /** The latest rate typed on a holding of the kind, to show the gap to the benchmark. */
  lastTypedPaise: number | null;
}

/** What IBJA shows now for a kind's quantity, beside the rate the person last typed, so they can see the gap before following it. */
export async function previewKindFeed(db: Db, userId: string, kindId: string, feed: "gold" | "silver", today: IstDate, fetchFn: FetchFn): Promise<FeedPreview> {
  const loaded = await loadHoldings(db, userId);
  const kind = [...loaded.kinds.values()].find((k) => k.id === kindId);
  if (!kind) throw new NotFoundError("Investment kind not found");
  if (!kind.unit) throw invalid("feed", "A price feed needs a kind counted by weight, such as grams");
  const rates = await ibjaRates(fetchFn);
  const ratePaise = kindRatePaise(feed, kind.ratePer, rates);
  let last: { date: IstDate; ratePaise: number } | null = null;
  for (const row of loaded.rows) {
    if (row.kind !== kind.key || row.status !== "active") continue;
    const u = loaded.facts.get(row.id)?.units;
    const r = u ? latestRate(u, today) : null;
    if (r && (!last || r.date > last.date)) last = r;
  }
  return { ratePaise, date: rates.date, session: rates.session, lastTypedPaise: last?.ratePaise ?? null };
}
