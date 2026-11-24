import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appSettings, checkinLog, holdingKinds, priceLinks } from "../src/db/schema";
import { closeHolding, createHolding, getHolding, setRate } from "../src/services/holdings";
import { listKinds, updateKind } from "../src/services/holdingKinds";
import { runPriceRefresh } from "../src/services/priceJob";
import { type FetchFn, FeedError, amfiSchemes, kindRatePaise, parseAmfi, parseIbja, parseYahooChart, parseYahooSearch, searchAmfi } from "../src/services/prices/feeds";
import { linkPrice, previewKindFeed, refreshPrices, suggestMatches, unlinkPrice } from "../src/services/prices/refresh";
import { FakeTelegram, linkTelegram, login, makeApp, registeredUser } from "./api-helpers";
import { AMFI_TEXT, IBJA_HTML, IBJA_HTML_AM_ONLY, YAHOO_SEARCH, yahooChart } from "./fixtures/prices";
import { createUser, db } from "./helpers";

const TODAY = "2026-11-24";

type Routes = Record<string, string | number>;
/** Answers each address with the first saved answer whose name it contains; a number is an error status. */
const fakeFetch =
  (routes: Routes, calls: string[] = []): FetchFn =>
  async (input) => {
    calls.push(input);
    for (const [part, body] of Object.entries(routes)) {
      if (!input.includes(part)) continue;
      return typeof body === "number" ? new Response("", { status: body }) : new Response(body, { status: 200 });
    }
    return new Response("", { status: 404 });
  };

const stock = (userId: string, name = "Tata Power", over: Partial<Parameters<typeof createHolding>[2]> = {}) =>
  createHolding(db, userId, { name, kind: "stock", tracking: "units", unitsE4: 100 * 10_000, ratePaise: 100_00, valueDate: "2026-11-01", investedPaise: 8_000_00, ...over }, TODAY);

/** Links straight in the table, so no price is written (and no network is needed). */
const quietLink = (userId: string, holdingId: string, code: string, feed: "yahoo" | "amfi" = "yahoo") => db.insert(priceLinks).values({ holdingId, userId, feed, code, label: null, createdAt: "2026-11-20T00:00:00.000Z" });

describe("the price feeds' adapters", () => {
  it("reads a Yahoo price in rupees, with the day it is for", () => {
    expect(parseYahooChart(JSON.parse(yahooChart("RELIANCE.NS", 1351)))).toEqual({ paise: 135_100, date: "2026-11-23" });
  });

  it("refuses a price that is not in rupees or not there", () => {
    expect(() => parseYahooChart(JSON.parse(yahooChart("TTM", 60, "2026-11-23T10:00:00Z", "USD")))).toThrow(FeedError);
    expect(() => parseYahooChart({ chart: { result: [{ meta: {} }] } })).toThrow(/no price/);
    expect(() => parseYahooChart({})).toThrow(FeedError);
  });

  it("keeps only NSE and BSE shares from a symbol search, NSE first", () => {
    expect(parseYahooSearch(JSON.parse(YAHOO_SEARCH)).map((c) => c.code)).toEqual(["TATAPOWER.NS", "TATAPOWER.BO"]);
  });

  it("reads AMFI's file in the current and the older shape, skipping schemes with no NAV", () => {
    const schemes = parseAmfi(AMFI_TEXT);
    expect(schemes.find((s) => s.code === "122639")).toMatchObject({ paise: 9493, date: "2026-11-23", name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" });
    expect(schemes.some((s) => s.code === "999999")).toBe(false);
    expect(parseAmfi("100;INF1;-;Old Style Fund;12.5;01-Nov-2026")[0]).toMatchObject({ code: "100", paise: 1250, date: "2026-11-01", name: "Old Style Fund" });
  });

  it("puts the Direct Growth plan first when searching AMFI by name", () => {
    const found = searchAmfi(parseAmfi(AMFI_TEXT), "parag parikh flexi cap");
    expect(found.map((c) => c.code)).toEqual(["122639", "122640", "122641"]);
    expect(searchAmfi(parseAmfi(AMFI_TEXT), "zzz")).toEqual([]);
  });

  it("takes IBJA's latest rate: the PM one when it is out, the AM one when it is not", () => {
    expect(parseIbja(IBJA_HTML)).toEqual({ date: "2026-11-23", session: "PM", goldPer10gPaise: 124_945_00, silverPerKgPaise: 152_625_00 });
    expect(parseIbja(IBJA_HTML_AM_ONLY)).toMatchObject({ date: "2026-11-24", session: "AM", goldPer10gPaise: 125_500_00 });
  });

  it("says so when IBJA's page has changed shape", () => {
    expect(() => parseIbja("<html><body>Nothing here</body></html>")).toThrow(/did not have rates/);
  });

  it("works out gold and silver for the quantity a kind quotes, exactly as IBJA publishes", () => {
    const rates = parseIbja(IBJA_HTML);
    expect(kindRatePaise("gold", 10, rates)).toBe(124_945_00);
    expect(kindRatePaise("gold", 1, rates)).toBe(12_494_50);
    expect(kindRatePaise("gold", 100, rates)).toBe(1_249_450_00);
    expect(kindRatePaise("silver", 1000, rates)).toBe(152_625_00);
    expect(kindRatePaise("silver", 1, rates)).toBe(15_263);
  });

  it("refuses an AMFI file that is far too short", async () => {
    await expect(amfiSchemes(fakeFetch({ NAVAll: "Scheme Code;x\n1;a;b;c;d;e;1.0;01-Nov-2026" }))).rejects.toThrow(/looked wrong/);
  });
});

describe("refreshing prices", () => {
  let userId: string;
  beforeEach(async () => {
    userId = await createUser();
  });

  it("writes the fetched price as today's rate and says how much the worth moved", async () => {
    const h = await stock(userId);
    await linkPrice(db, userId, h.id, { feed: "yahoo", code: "TATAPOWER.NS", label: "Tata Power (NSE)" }, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 328) }));
    expect((await getHolding(db, userId, h.id, TODAY)).ratePaise).toBe(32_800);

    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 340) }));
    expect(out).toMatchObject({ updated: 1, failed: 0, held: 0 });
    expect(out.items[0]).toMatchObject({ name: "Tata Power", status: "updated", ratePaise: 34_000, previousPaise: 32_800, changePaise: 100 * 12_00, source: "Yahoo" });
    const after = await getHolding(db, userId, h.id, TODAY);
    expect(after).toMatchObject({ ratePaise: 34_000, valuePaise: 34_000_00, rateSource: "auto", priceLink: { feed: "yahoo", code: "TATAPOWER.NS" } });
    const [row] = await db.select({ at: appSettings.pricesCheckedAt }).from(appSettings).where(eq(appSettings.userId, userId));
    expect(row?.at ?? null).not.toBeNull();
  });

  it("never replaces a price you typed today", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    await setRate(db, userId, h.id, { ratePaise: 30_000 }, TODAY);
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 340) }));
    expect(out.items[0]).toMatchObject({ status: "typed_today" });
    expect(await getHolding(db, userId, h.id, TODAY)).toMatchObject({ ratePaise: 30_000, rateSource: "typed" });
  });

  it("lets a price you type replace one fetched the same day", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 120) }));
    expect((await getHolding(db, userId, h.id, TODAY)).rateSource).toBe("auto");
    await setRate(db, userId, h.id, { ratePaise: 31_000 }, TODAY);
    expect(await getHolding(db, userId, h.id, TODAY)).toMatchObject({ ratePaise: 31_000, rateSource: "typed" });
  });

  it("keeps the old price when a feed fails, and names the site, not the address", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/": 500 }));
    expect(out).toMatchObject({ updated: 0, failed: 1 });
    expect(out.items[0]?.reason).toBe("query1.finance.yahoo.com answered 500");
    expect((await getHolding(db, userId, h.id, TODAY)).ratePaise).toBe(10_000);
  });

  it("holds back a price that moved more than 40% for you to check", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 200) }));
    expect(out.items[0]).toMatchObject({ status: "held", ratePaise: 20_000, previousPaise: 10_000 });
    expect(out.items[0]?.reason).toContain("+100%");
    expect((await getHolding(db, userId, h.id, TODAY)).ratePaise).toBe(10_000);
  });

  it("does not use a price that is more than ten days old", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 105, "2026-11-10T10:00:00Z") }));
    expect(out.items[0]).toMatchObject({ status: "failed" });
    expect(out.items[0]?.reason).toContain("2026-11-10");
  });

  it("reports an unchanged price and still marks it fresh", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 100) }));
    expect(out).toMatchObject({ updated: 0, unchanged: 1 });
    expect((await getHolding(db, userId, h.id, TODAY)).valueDate).toBe(TODAY);
  });

  it("switches a fund valued by typing to units and follows its NAV", async () => {
    const fund = await createHolding(db, userId, { name: "Parag Parikh Flexi Cap Direct", kind: "fund", investedPaise: 59_997_00, valuePaise: 66_977_00, valueDate: "2026-11-13" }, TODAY);
    const feeds = fakeFetch({ NAVAll: AMFI_TEXT });
    await expect(linkPrice(db, userId, fund.id, { feed: "amfi", code: "122639" }, TODAY, feeds)).rejects.toThrow();
    const linked = await linkPrice(db, userId, fund.id, { feed: "amfi", code: "122639", label: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", unitsE4: 700 * 10_000 }, TODAY, feeds);
    expect(linked.holding).toMatchObject({ tracking: "units", ratePaise: 9493, valuePaise: 700 * 9493, rateSource: "auto" });
    // A later NAV moves the worth.
    const next = AMFI_TEXT.replace("94.9255", "96.5");
    const out = await refreshPrices(db, userId, "2026-11-25", fakeFetch({ NAVAll: next }));
    expect(out.items[0]).toMatchObject({ status: "updated", ratePaise: 9650, source: "AMFI" });
  });

  it("refuses to link a code the feed does not know", async () => {
    const h = await stock(userId);
    await expect(linkPrice(db, userId, h.id, { feed: "yahoo", code: "NOPE.NS" }, TODAY, fakeFetch({ "chart/": 404 }))).rejects.toThrow(FeedError);
    await expect(linkPrice(db, userId, h.id, { feed: "amfi", code: "1" }, TODAY, fakeFetch({ NAVAll: AMFI_TEXT }))).rejects.toMatchObject({ details: [{ message: "AMFI has no fund with code 1" }] });
    expect(await db.select().from(priceLinks).where(eq(priceLinks.holdingId, h.id))).toEqual([]);
  });

  it("follows IBJA exactly for gold held outside a broker, and leaves other kinds alone", async () => {
    const gold = await createHolding(db, userId, { name: "Gold coins", kind: "gold", tracking: "units", unitsE4: 8 * 10_000, ratePaise: 126_401_00, valueDate: "2026-11-05", investedPaise: 90_000_00 }, TODAY);
    const loose = await createHolding(db, userId, { name: "Plot", kind: "other", investedPaise: 1_000_00, valuePaise: 2_000_00, valueDate: "2026-11-05" }, TODAY);
    const goldKind = (await listKinds(db, userId)).find((k) => k.key === "gold");
    expect(goldKind?.feed).toBeNull();
    await updateKind(db, userId, goldKind?.id as string, { feed: "gold" });

    const feeds = fakeFetch({ ibjarates: IBJA_HTML });
    const first = await refreshPrices(db, userId, TODAY, feeds);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ name: "Gold coins", source: "IBJA", status: "updated", ratePaise: 124_945_00 });
    expect((await getHolding(db, userId, gold.id, TODAY)).valuePaise).toBe(Math.round((8 * 124_945_00) / 10));
    expect((await getHolding(db, userId, loose.id, TODAY)).valueDate).toBe("2026-11-05");

    // Another day's IBJA rate moves it, with nothing added or taken off.
    const next = await refreshPrices(db, userId, "2026-11-25", fakeFetch({ ibjarates: IBJA_HTML_AM_ONLY }));
    expect(next.items[0]?.ratePaise).toBe(125_500_00);
  });

  it("no longer takes an adjustment on a kind", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const kinds = ((await (await app.call("GET", "/api/holding-kinds", { cookie })).json()) as { items: { id: string; key: string; feedAdjustBp?: number }[] }).items;
    const gold = kinds.find((k) => k.key === "gold");
    expect(gold).toBeDefined();
    expect(gold).not.toHaveProperty("feedAdjustBp");
    const res = await app.call("PATCH", `/api/holding-kinds/${gold?.id}`, { cookie, body: { feed: "gold", feedAdjustBp: 100 } });
    expect(res.status).toBe(422);
  });

  it("shows the gap between IBJA and your last typed rate before you follow it", async () => {
    await createHolding(db, userId, { name: "Gold coins", kind: "gold", tracking: "units", unitsE4: 8 * 10_000, ratePaise: 126_401_00, valueDate: "2026-11-05" }, TODAY);
    const kind = (await listKinds(db, userId)).find((k) => k.key === "gold");
    const preview = await previewKindFeed(db, userId, kind?.id as string, "gold", TODAY, fakeFetch({ ibjarates: IBJA_HTML }));
    expect(preview).toEqual({ ratePaise: 124_945_00, date: "2026-11-23", session: "PM", lastTypedPaise: 126_401_00 });
  });

  it("skips closed investments", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    await closeHolding(db, userId, h.id, TODAY);
    const calls: string[] = [];
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/": yahooChart("TATAPOWER.NS", 340) }, calls));
    expect(out.items).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("never touches another person's investments", async () => {
    const mine = await stock(userId);
    const other = await createUser();
    const theirs = await stock(other, "Theirs");
    await quietLink(userId, mine.id, "TATAPOWER.NS");
    await quietLink(other, theirs.id, "RELIANCE.NS");
    const calls: string[] = [];
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/": yahooChart("X", 340) }, calls));
    expect(out.items.map((i) => i.name)).toEqual(["Tata Power"]);
    expect(calls).toHaveLength(1);
    expect((await getHolding(db, other, theirs.id, TODAY)).ratePaise).toBe(10_000);
    await expect(unlinkPrice(db, userId, theirs.id)).rejects.toThrow(/not linked/);
  });

  it("fetches a limited number of symbols at once and leaves the rest for next time", async () => {
    for (let i = 0; i < 43; i++) {
      const h = await stock(userId, `Stock ${i}`);
      await quietLink(userId, h.id, `S${i}.NS`);
    }
    const out = await refreshPrices(db, userId, TODAY, fakeFetch({ "chart/": yahooChart("X", 105) }));
    expect(out.updated).toBe(40);
    expect(out.items.filter((i) => i.status === "failed" && i.reason?.includes("too many"))).toHaveLength(3);
  });

  it("removes a link", async () => {
    const h = await stock(userId);
    await quietLink(userId, h.id, "TATAPOWER.NS");
    await unlinkPrice(db, userId, h.id);
    expect((await getHolding(db, userId, h.id, TODAY)).priceLink).toBeNull();
  });

  it("suggests matches to confirm: shares with today's price, funds by name", async () => {
    const shares = await suggestMatches(fakeFetch({ "finance/search": YAHOO_SEARCH, "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 328) }), "stock", "Tata Power");
    expect(shares[0]).toMatchObject({ code: "TATAPOWER.NS", paise: 32_800 });
    expect(shares[1]).toMatchObject({ code: "TATAPOWER.BO", paise: null });
    const funds = await suggestMatches(fakeFetch({ NAVAll: AMFI_TEXT }), "fund", "parag parikh");
    expect(funds[0]).toMatchObject({ code: "122639", paise: 9493 });
    expect(await suggestMatches(fakeFetch({}), "fund", "a")).toEqual([]);
  });
});

describe("the weekly price refresh", () => {
  const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`);
  const feeds = (price: number, day = "2026-11-27") => fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", price, `${day}T10:00:00Z`) });

  beforeEach(async () => {
    await db.delete(priceLinks);
    await db.delete(checkinLog).where(eq(checkinLog.kind, "prices"));
    await db.update(holdingKinds).set({ feed: null });
  });

  async function person(chat = true) {
    const user = await registeredUser();
    const h = await stock(user.id);
    await quietLink(user.id, h.id, "TATAPOWER.NS");
    if (chat) await linkTelegram(user.id, `chat-${user.id}`);
    return { user, h };
  }

  it("refreshes on a Saturday and tells you what changed, in exact figures", async () => {
    const { user, h } = await person();
    const tg = new FakeTelegram();
    expect(await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: feeds(120) })).toEqual({ refreshed: 1, sent: 1 });
    expect(tg.last.text).toBe("Prices refreshed: 1 changed, 0 the same.\nTogether they are worth ₹2,000 more than at their last prices.");
    expect((await getHolding(db, user.id, h.id, "2026-11-28")).ratePaise).toBe(12_000);
  });

  it("names what it left for you to check and what it could not get", async () => {
    await person();
    const tg = new FakeTelegram();
    await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: feeds(300) });
    expect(tg.last.text).toContain("Left for you to check, because the price moved a lot: Tata Power (now ₹300, was ₹100)");
    await db.delete(checkinLog).where(eq(checkinLog.kind, "prices"));
    await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: fakeFetch({ "chart/": 500 }) });
    expect(tg.last.text).toContain("Could not get a price for: Tata Power (query1.finance.yahoo.com answered 500). They keep their last price.");
  });

  it("does nothing on other days, and only once on a Saturday", async () => {
    await person();
    const tg = new FakeTelegram();
    expect(await runPriceRefresh({ db, telegram: tg, now: at("2026-11-27"), fetch: feeds(340) })).toEqual({ refreshed: 0, sent: 0 });
    expect(await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: feeds(340) })).toEqual({ refreshed: 1, sent: 1 });
    expect(await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: feeds(350) })).toEqual({ refreshed: 0, sent: 0 });
  });

  it("skips someone who turned it off, and refreshes quietly for someone without Telegram", async () => {
    const off = await person();
    await db.insert(appSettings).values({ userId: off.user.id, priceRefresh: false }).onConflictDoUpdate({ target: appSettings.userId, set: { priceRefresh: false } });
    const quiet = await person(false);
    const tg = new FakeTelegram();
    expect(await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: feeds(120) })).toEqual({ refreshed: 1, sent: 0 });
    expect((await getHolding(db, off.user.id, off.h.id, "2026-11-28")).ratePaise).toBe(10_000);
    expect((await getHolding(db, quiet.user.id, quiet.h.id, "2026-11-28")).ratePaise).toBe(12_000);
    expect(tg.messages).toEqual([]);
  });

  it("goes on with the others when one person's refresh fails", async () => {
    await person();
    await person();
    const tg = new FakeTelegram();
    tg.failSending = true;
    const out = await runPriceRefresh({ db, telegram: tg, now: at("2026-11-28"), fetch: feeds(340) });
    expect(out.refreshed).toBe(2);
  });
});

describe("the price routes", () => {
  it("limits refreshes to a few an hour, and answers with nothing to fetch for a new person", async () => {
    const app = makeApp({ fetch: fakeFetch({}) });
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const first = await app.call("POST", "/api/prices/refresh", { cookie });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { items: unknown[] }).items).toEqual([]);
    for (let i = 0; i < 5; i++) expect((await app.call("POST", "/api/prices/refresh", { cookie })).status).toBe(200);
    expect((await app.call("POST", "/api/prices/refresh", { cookie })).status).toBe(429);
  });

  it("links a price, shows it on the investment, and keeps another person's investment out of reach", async () => {
    const app = makeApp({ fetch: fakeFetch({ "chart/TATAPOWER.NS": yahooChart("TATAPOWER.NS", 328) }) });
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const made = (await (await app.call("POST", "/api/holdings", { cookie, body: { name: "Tata Power", kind: "stock", tracking: "units", unitsE4: 1_000_000, ratePaise: 10_000, valueDate: "2026-10-01" } })).json()) as { id: string };
    const linked = await app.call("PUT", `/api/prices/links/${made.id}`, { cookie, body: { feed: "yahoo", code: "TATAPOWER.NS", label: "Tata Power (NSE)" } });
    expect(linked.status).toBe(200);
    const shown = ((await (await app.call("GET", "/api/holdings", { cookie })).json()) as { holdings: { priceLink: unknown; rateSource: string }[] }).holdings[0];
    expect(shown).toMatchObject({ priceLink: { feed: "yahoo", code: "TATAPOWER.NS", label: "Tata Power (NSE)" }, rateSource: "auto" });

    const other = await registeredUser();
    const otherCookie = await login(app, other.email);
    expect((await app.call("PUT", `/api/prices/links/${made.id}`, { cookie: otherCookie, body: { feed: "yahoo", code: "TATAPOWER.NS" } })).status).toBe(404);
    expect((await app.call("DELETE", `/api/prices/links/${made.id}`, { cookie: otherCookie })).status).toBe(404);
    expect((await app.call("GET", "/api/prices/suggest?q=a&kind=stock", { cookie })).status).toBe(422);
  });

  it("reports a failing feed as a conflict with the site named", async () => {
    const app = makeApp({ fetch: fakeFetch({ "finance/search": 503 }) });
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const res = await app.call("GET", "/api/prices/suggest?q=tata&kind=stock", { cookie });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("query2.finance.yahoo.com answered 503");
  });

  it("turns the weekly refresh on or off in settings", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    expect(((await (await app.call("GET", "/api/settings", { cookie })).json()) as { priceRefresh: boolean }).priceRefresh).toBe(true);
    const off = await app.call("PATCH", "/api/settings", { cookie, body: { priceRefresh: false } });
    expect(((await off.json()) as { priceRefresh: boolean }).priceRefresh).toBe(false);
  });

  it("includes the links in the data export", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const h = await stock(user.id);
    await quietLink(user.id, h.id, "TATAPOWER.NS");
    const body = (await (await app.call("GET", "/api/export/json", { cookie })).json()) as { priceLinks: { code: string }[] };
    expect(body.priceLinks).toEqual([expect.objectContaining({ code: "TATAPOWER.NS" })]);
    expect(JSON.stringify(body.priceLinks)).not.toContain("userId");
  });
});
