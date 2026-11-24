import { type IstDate, toIstDate } from "../../domain/dates";

/**
 * The places prices come from, one small adapter each, so a source that changes or goes away is swapped in one place:
 *   Yahoo  (stocks and ETFs, unofficial)           AMFI  (mutual fund NAVs, official daily file)
 *   IBJA   (gold and silver benchmark, a web page)
 * Every adapter takes the `fetch` it should use, so tests give it saved answers. Only tickers and codes are ever sent.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = "Mozilla/5.0 (compatible; AlfredPrices/1.0)";

/** A feed that could not give a price. The message is shown to the person, so it names the site, never the address with anything in it. */
export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

export interface Quote {
  /** The price in paise: per share, or the NAV of one unit. */
  paise: number;
  /** The day the price is for, when the feed says. */
  date: IstDate | null;
}

export interface Candidate {
  feed: "yahoo" | "amfi";
  code: string;
  label: string;
  paise: number | null;
}

async function getText(fetchFn: FetchFn, url: string): Promise<string> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { "user-agent": USER_AGENT, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new FeedError(`${host} could not be reached`);
  }
  if (!res.ok) throw new FeedError(`${host} answered ${res.status}`);
  return res.text();
}

const asRecord = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined);

// ── Yahoo ────────────────────────────────────────────────────────────────

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_SEARCH = "https://query2.finance.yahoo.com/v1/finance/search";

/** The latest price from a Yahoo chart answer. Only rupee prices are taken. */
export function parseYahooChart(json: unknown): Quote {
  const chart = asRecord(asRecord(json)?.chart);
  const first = chart?.result instanceof Array ? asRecord(chart.result[0]) : undefined;
  const meta = asRecord(first?.meta);
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !(price > 0)) throw new FeedError("Yahoo had no price for it");
  if (meta?.currency !== undefined && meta.currency !== "INR") throw new FeedError(`Yahoo gave the price in ${String(meta.currency)}, not rupees`);
  const at = meta?.regularMarketTime;
  return { paise: Math.round(price * 100), date: typeof at === "number" ? toIstDate(new Date(at * 1000)) : null };
}

export async function yahooQuote(fetchFn: FetchFn, symbol: string): Promise<Quote> {
  const text = await getText(fetchFn, `${YAHOO_CHART}${encodeURIComponent(symbol)}?range=5d&interval=1d`);
  try {
    return parseYahooChart(JSON.parse(text));
  } catch (error) {
    throw error instanceof FeedError ? error : new FeedError("Yahoo gave an answer that could not be read");
  }
}

/** NSE and BSE equities and ETFs from a Yahoo symbol search. */
export function parseYahooSearch(json: unknown): Candidate[] {
  const quotes = asRecord(json)?.quotes;
  if (!(quotes instanceof Array)) return [];
  const out: Candidate[] = [];
  for (const q of quotes) {
    const r = asRecord(q);
    const symbol = r?.symbol;
    if (typeof symbol !== "string" || !/\.(NS|BO)$/.test(symbol)) continue;
    if (r?.quoteType !== "EQUITY" && r?.quoteType !== "ETF") continue;
    const name = (typeof r.longname === "string" && r.longname) || (typeof r.shortname === "string" && r.shortname) || symbol;
    out.push({ feed: "yahoo", code: symbol, label: `${name} (${symbol.endsWith(".NS") ? "NSE" : "BSE"})`, paise: null });
  }
  // NSE first: its symbols are the ones brokers show.
  return out.sort((a, b) => Number(b.code.endsWith(".NS")) - Number(a.code.endsWith(".NS")));
}

export async function yahooSearch(fetchFn: FetchFn, query: string): Promise<Candidate[]> {
  const text = await getText(fetchFn, `${YAHOO_SEARCH}?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`);
  try {
    return parseYahooSearch(JSON.parse(text)).slice(0, 5);
  } catch {
    throw new FeedError("Yahoo gave an answer that could not be read");
  }
}

// ── AMFI ─────────────────────────────────────────────────────────────────

export const AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

export interface AmfiScheme {
  code: string;
  isin: string;
  name: string;
  paise: number;
  date: IstDate | null;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "23-Nov-2026" to "2026-11-23". */
export function parseAmfiDate(text: string): IstDate | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text.trim());
  const month = m ? MONTHS[(m[2] as string).toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${(m[1] as string).padStart(2, "0")}` : null;
}

/** Every scheme with a NAV from AMFI's daily file: `code;ISIN;ISIN;name;plan;option;NAV;date` (older files had no plan and option). */
export function parseAmfi(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 6 || !/^\d+$/.test(parts[0] as string)) continue;
    const wide = parts.length >= 8;
    const nav = Number(parts[wide ? 6 : 4]);
    if (!(nav > 0)) continue;
    const name = wide ? [parts[3], parts[4], parts[5]].filter(Boolean).join(" - ") : (parts[3] as string);
    out.push({ code: parts[0] as string, isin: parts[1] as string, name, paise: Math.round(nav * 100), date: parseAmfiDate(parts[wide ? 7 : 5] as string) });
  }
  return out;
}

export async function amfiSchemes(fetchFn: FetchFn): Promise<AmfiScheme[]> {
  const schemes = parseAmfi(await getText(fetchFn, AMFI_URL));
  if (schemes.length < 100) throw new FeedError("AMFI's file looked wrong, so none of it was used");
  return schemes;
}

/** Schemes whose names hold every word asked for, the Direct Growth plan first (what most people hold), then the shortest name. */
export function searchAmfi(schemes: readonly AmfiScheme[], query: string, limit = 5): Candidate[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const wantsRegular = words.includes("regular");
  const hits = schemes.filter((s) => {
    const name = s.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
  const rank = (s: AmfiScheme) => {
    const n = s.name.toLowerCase();
    let r = 0;
    if (n.includes("growth")) r -= 2;
    if (wantsRegular ? n.includes("regular") : n.includes("direct")) r -= 2;
    if (n.includes("idcw") || n.includes("dividend")) r += 3;
    return r * 1000 + s.name.length;
  };
  return hits
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
    .map((s) => ({ feed: "amfi" as const, code: s.code, label: s.name, paise: s.paise }));
}

// ── IBJA ─────────────────────────────────────────────────────────────────

export const IBJA_URL = "https://www.ibjarates.com/";

export interface IbjaRates {
  date: IstDate;
  session: "AM" | "PM";
  /** Gold 999 per 10 g, and silver 999 per kg, in paise. */
  goldPer10gPaise: number;
  silverPerKgPaise: number;
}

/**
 * The latest benchmark from IBJA's rates page (a web page, not an API): the newest day's PM rate, or its AM rate when the PM one is
 * not out yet. The rows carry `data-label` attributes, which is what this reads; if the page changes shape it says so.
 */
export function parseIbja(html: string): IbjaRates {
  const rows = html.matchAll(/data-label="(AM|PM)"[^>]*>\s*<strong>(\d{2})\/(\d{2})\/(\d{4})<\/strong>\s*<\/td>([\s\S]*?)<\/tr>/g);
  let best: IbjaRates | null = null;
  for (const row of rows) {
    const gold = /data-label="Gold 999"[^>]*>\s*([\d,]+)\s*</.exec(row[5] as string);
    const silver = /data-label="Silver 999"[^>]*>\s*([\d,]+)\s*</.exec(row[5] as string);
    if (!gold || !silver) continue;
    const goldRupees = Number((gold[1] as string).replace(/,/g, ""));
    const silverRupees = Number((silver[1] as string).replace(/,/g, ""));
    // A wide sanity range: it only catches a page that has shifted columns.
    if (!(goldRupees >= 10_000 && goldRupees <= 1_500_000) || !(silverRupees >= 10_000 && silverRupees <= 3_000_000)) continue;
    const found: IbjaRates = { date: `${row[4]}-${row[3]}-${row[2]}`, session: row[1] as "AM" | "PM", goldPer10gPaise: goldRupees * 100, silverPerKgPaise: silverRupees * 100 };
    const newer = !best || found.date > best.date || (found.date === best.date && found.session === "PM" && best.session === "AM");
    if (newer) best = found;
  }
  if (!best) throw new FeedError("IBJA's page did not have rates in the shape expected");
  return best;
}

export async function ibjaRates(fetchFn: FetchFn): Promise<IbjaRates> {
  return parseIbja(await getText(fetchFn, IBJA_URL));
}

/** The rate for a kind's quantity (gold per 10 g, silver per kg; the kind may quote per gram or per 100 g), exactly as IBJA publishes it. */
export function kindRatePaise(feed: "gold" | "silver", ratePer: number, rates: IbjaRates): number {
  return Math.round(feed === "gold" ? (rates.goldPer10gPaise * ratePer) / 10 : (rates.silverPerKgPaise * ratePer) / 1000);
}
