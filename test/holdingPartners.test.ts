import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { holdingPartnerEntries, transactions } from "../src/db/schema";
import { splitHolding } from "../src/domain/partners";
import { holdingsValue } from "../src/services/holdings";
import { login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST).
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Card", creditLimitPaise: 1_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const make = async (name = "Tata Tech") => (await api("POST", "/api/holdings", { name, kind: "stock", investedPaise: 0 })).json;
  const balance = async () => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === bank.id)!.balancePaise as number;
  const get = async (id: string) => ((await api("GET", "/api/holdings?status=all")).json.holdings as Json[]).find((h) => h.id === id)!;
  const overview = async () => (await api("GET", "/api/holdings")).json;
  const stake = (id: string, over: object = {}) => api("POST", `/api/holdings/${id}/partners`, { name: "Nishant", amountPaise: 40_000_00, accountId: bank.id, date: "2026-10-20", ...over });
  // Nishant gives 40k, you add 60k, you buy 1 lakh, and it is worth 1.2 lakh.
  const pooled = async () => {
    const h = await make();
    await stake(h.id);
    await api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 1_00_000_00, accountId: bank.id, date: "2026-10-21" });
    await api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 1_20_000_00, date: "2026-10-22" });
    return h;
  };
  return { app, user, api, bank, card, make, balance, get, overview, stake, pooled };
}

describe("the split, in proportion to the money put in", () => {
  const facts = (invested: number, value: number, sold = 0) => ({ openingInvestedPaise: invested, purchases: [], sales: sold ? [{ date: "2026-10-10", amountPaise: sold }] : [], values: [{ date: "2026-10-15", valuePaise: value }] });
  const nishant = (paise: number) => ({ contactId: "n", name: "Nishant", entries: [{ date: "2026-10-01", kind: "in" as const, amountPaise: paise }] });

  it("gives each their share of the worth, and you the remainder", () => {
    const s = splitHolding(facts(1_00_000_00, 1_20_000_00), [nishant(40_000_00)]);
    expect(s).toMatchObject({ shared: true, basisPaise: 1_00_000_00, myPutInPaise: 60_000_00, mySharePct: 60, myValuePaise: 72_000_00, myGainPaise: 12_000_00 });
    expect(s.partners[0]).toMatchObject({ sharePct: 40, putInPaise: 40_000_00, valuePaise: 48_000_00, gainPaise: 8_000_00, owedPaise: 48_000_00 });
  });

  it("is the whole holding when nobody else is in it", () => {
    expect(splitHolding(facts(1_00_000_00, 1_20_000_00), [])).toMatchObject({ shared: false, myPutInPaise: 1_00_000_00, myValuePaise: 1_20_000_00, myGainPaise: 20_000_00, partners: [] });
  });

  it("splits what was already sold and what is owed after a payout", () => {
    const s = splitHolding(facts(1_00_000_00, 50_000_00, 80_000_00), [{ ...nishant(40_000_00), entries: [{ date: "2026-10-01", kind: "in", amountPaise: 40_000_00 }, { date: "2026-10-12", kind: "out", amountPaise: 32_000_00 }] }]);
    expect(s.partners[0]).toMatchObject({ valuePaise: 20_000_00, soldPaise: 32_000_00, entitlementPaise: 52_000_00, paidOutPaise: 32_000_00, owedPaise: 20_000_00, gainPaise: 12_000_00 });
    expect(s.myValuePaise + s.partners[0]!.valuePaise).toBe(50_000_00);
    expect(s.mySoldPaise + s.partners[0]!.soldPaise).toBe(80_000_00);
  });

  it("rounds their share down and gives you the rest, so the pieces add up", () => {
    const s = splitHolding(facts(3, 100), [nishant(1)]);
    expect(s.partners[0]!.valuePaise + s.myValuePaise).toBe(100);
  });

  it("measures against their money while it is not yet invested", () => {
    const s = splitHolding({ openingInvestedPaise: 0, purchases: [], sales: [], values: [] }, [nishant(40_000_00)]);
    expect(s).toMatchObject({ shared: true, basisPaise: 40_000_00, myPutInPaise: 0, myValuePaise: 0 });
  });
});

describe("another person's money in a holding", () => {
  it("arrives in your bank, is not income, and gives them a share once you buy", async () => {
    const s = await setup();
    const h = await s.make();
    const res = await s.stake(h.id);
    expect(res.status).toBe(201);
    expect(await s.balance()).toBe(1_40_000_00);
    const [entry] = await db.select().from(holdingPartnerEntries).where(eq(holdingPartnerEntries.holdingId, h.id));
    expect(entry).toMatchObject({ kind: "in", amountPaise: 40_000_00, date: "2026-10-20" });
    const [txn] = await db.select().from(transactions).where(and(eq(transactions.id, entry!.txnId as string)));
    expect(txn).toMatchObject({ type: "partner_in", amountPaise: 40_000_00, merchant: "Nishant", holdingId: h.id, categoryId: null });

    await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 1_00_000_00, accountId: s.bank.id, date: "2026-10-21" });
    await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 1_20_000_00, date: "2026-10-22" });
    expect(await s.balance()).toBe(40_000_00);
    const shared = await s.get(h.id);
    expect(shared).toMatchObject({ investedPaise: 1_00_000_00, valuePaise: 1_20_000_00, myInvestedPaise: 60_000_00, myValuePaise: 72_000_00, myGainPaise: 12_000_00 });
    expect(shared.shared).toMatchObject({ mySharePct: 60 });
    expect(shared.shared.partners[0]).toMatchObject({ name: "Nishant", putInPaise: 40_000_00, sharePct: 40, valuePaise: 48_000_00, gainPaise: 8_000_00, owedPaise: 48_000_00 });
    expect(shared.shared.partners[0].entries).toHaveLength(1);
  });

  it("lowers their share when you add more of your own money, and keeps adding up for two people", async () => {
    const s = await setup();
    const h = await s.pooled();
    await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 50_000_00, accountId: s.bank.id, date: "2026-10-23" });
    const after = await s.get(h.id);
    expect(after.shared.partners[0].sharePct).toBe(26.7);
    expect(after.shared.mySharePct).toBe(73.3);
    await s.stake(h.id, { name: "Asha", amountPaise: 30_000_00, date: "2026-10-24" });
    const three = await s.get(h.id);
    expect(three.shared.partners.map((p: Json) => p.name)).toEqual(["Nishant", "Asha"]);
    const parts = three.shared.partners.reduce((sum: number, p: Json) => sum + p.valuePaise, 0);
    expect(parts + three.myValuePaise).toBe(three.valuePaise);
  });

  it("counts only your share in the overview, net worth and the broker totals", async () => {
    const s = await setup();
    const h = await s.pooled();
    const plain = await s.make("Solo");
    await s.api("POST", `/api/holdings/${plain.id}/value`, { valuePaise: 10_000_00, date: "2026-10-22" });
    const o = await s.overview();
    expect(o.totalValuePaise).toBe(1_30_000_00);
    expect(o.mine).toMatchObject({ valuePaise: 82_000_00 });
    expect(o.personal).toMatchObject({ valuePaise: 10_000_00 });
    expect(o.shared).toMatchObject({ count: 1, wholeValuePaise: 1_20_000_00, wholeInvestedPaise: 1_00_000_00, othersValuePaise: 48_000_00, othersInvestedPaise: 40_000_00 });
    expect(o.shared.my).toMatchObject({ valuePaise: 72_000_00, investedPaise: 60_000_00, gainPaise: 12_000_00 });
    expect(o.shared.people).toHaveLength(1);
    expect(o.shared.people[0]).toMatchObject({ name: "Nishant", holdings: 1, putInPaise: 40_000_00, valuePaise: 48_000_00, owedPaise: 48_000_00 });
    expect(await holdingsValue(db, s.user.id, "2026-10-27")).toBe(82_000_00);
    const figures = (await s.api("GET", "/api/accounts")).json;
    expect(figures.overview.investmentsPaise).toBe(82_000_00);
    expect(h.id).toBeTruthy();
  });

  it("can be an earlier stake with no bank entry, and leaves the bank alone", async () => {
    const s = await setup();
    const h = await s.make();
    await s.api("POST", `/api/holdings/${h.id}/lots`, { unitsE4: 1, costPaise: 1, date: "2026-10-01" }).catch(() => undefined);
    const res = await s.stake(h.id, { accountId: null, date: "2026-09-01" });
    expect(res.status).toBe(201);
    expect(await s.balance()).toBe(1_00_000_00);
    expect((await db.select().from(holdingPartnerEntries).where(eq(holdingPartnerEntries.holdingId, h.id)))[0]!.txnId).toBeNull();
  });

  it("is corrected and removed together with its bank entry", async () => {
    const s = await setup();
    const h = await s.pooled();
    const entry = (await s.get(h.id)).shared.partners[0].entries[0];
    const edited = await s.api("PATCH", `/api/holdings/${h.id}/partners/${entry.id}`, { amountPaise: 20_000_00, date: "2026-10-19", note: "Part 1" });
    expect(edited.status).toBe(200);
    expect(edited.json.shared.partners[0]).toMatchObject({ putInPaise: 20_000_00, sharePct: 20 });
    expect(await s.balance()).toBe(20_000_00);
    expect((await s.api("PATCH", `/api/holdings/${h.id}/partners/${entry.id}`, { accountId: s.card.id })).status).toBe(422);
    const removed = await s.api("DELETE", `/api/holdings/${h.id}/partners/${entry.id}`);
    expect(removed.status).toBe(200);
    expect(removed.json.shared).toBeNull();
    expect(removed.json).toMatchObject({ myInvestedPaise: 1_00_000_00, myValuePaise: 1_20_000_00 });
    expect(await s.balance()).toBe(0);
    expect(await db.select().from(transactions).where(eq(transactions.holdingId, h.id))).toHaveLength(1);
  });

  it("refuses what does not fit", async () => {
    const s = await setup();
    const other = await setup();
    const h = await s.make();
    const theirs = await other.make();
    const cases: [string, object, number][] = [
      ["no name", { name: undefined }, 422],
      ["both", { contactId: "x" }, 422],
      ["zero", { amountPaise: 0 }, 422],
      ["the future", { date: "2026-12-01" }, 422],
      ["a card", { accountId: s.card.id }, 422],
      ["not found account", { accountId: other.bank.id }, 404],
      ["unknown person", { name: undefined, contactId: "01HXXXXXXXXXXXXXXXXXXXXXXX" }, 404],
    ];
    for (const [label, over, status] of cases) expect([label, (await s.stake(h.id, over)).status]).toEqual([label, status]);
    expect((await s.stake(theirs.id)).status).toBe(404);
    await s.api("POST", `/api/holdings/${h.id}/close`);
    expect((await s.stake(h.id)).status).toBe(409);
  });

  it("is not reachable through the ordinary entry routes, and not in cash flow", async () => {
    const s = await setup();
    const h = await s.pooled();
    const made = await s.api("POST", "/api/transactions", { type: "partner_in", amountPaise: 10_00, txnDate: "2026-10-20", accountId: s.bank.id });
    expect(made.status).toBe(422);
    const [txn] = await db.select().from(transactions).where(and(eq(transactions.holdingId, h.id), eq(transactions.type, "partner_in")));
    expect((await s.api("PATCH", `/api/transactions/${txn!.id}`, { amountPaise: 5_00 })).status).toBe(409);
    expect((await s.api("DELETE", `/api/transactions/${txn!.id}`)).status).toBe(409);
    const summary = (await s.api("GET", "/api/summary?from=2026-10-01&to=2026-10-31")).json;
    expect(JSON.stringify(summary)).not.toContain("40000");
  });

  it("stops the holding being deleted while a bank entry is linked, and deletes an earlier stake with it", async () => {
    const s = await setup();
    const linked = await s.make("Linked");
    await s.stake(linked.id);
    expect((await s.api("DELETE", `/api/holdings/${linked.id}`)).status).toBe(409);
    const earlier = await s.make("Earlier");
    await s.stake(earlier.id, { accountId: null });
    expect((await s.api("DELETE", `/api/holdings/${earlier.id}`)).status).toBe(204);
    expect(await db.select().from(holdingPartnerEntries).where(eq(holdingPartnerEntries.holdingId, earlier.id))).toHaveLength(0);
  });

  it("is in the data export", async () => {
    const s = await setup();
    const h = await s.pooled();
    const out = (await s.api("GET", "/api/export/json")).json;
    expect(out.holdingPartnerEntries).toHaveLength(1);
    expect(out.holdingPartnerEntries[0]).toMatchObject({ holdingId: h.id, kind: "in", amountPaise: 40_000_00 });
    expect(out.holdingPartnerEntries[0].userId).toBeUndefined();
  });
});
