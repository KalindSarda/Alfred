import { beforeEach, describe, expect, it } from "vitest";
import { insertAccount } from "../src/db/accounts";
import { growthSplit, trendDates } from "../src/domain/investmentTrend";
import { addPartnerStake } from "../src/services/holdingPartners";
import { buy, closeHolding, createHolding, setValue } from "../src/services/holdings";
import { createInvestmentAccount } from "../src/services/investmentAccounts";
import { getInvestmentTrend } from "../src/services/investmentTrend";
import { login, makeApp, registeredUser } from "./api-helpers";
import { createUser, db } from "./helpers";

const TODAY = "2026-10-27";

describe("which days an investment series looks at", () => {
  it("is weekly for three months, ending today", () => {
    const days = trendDates(TODAY, "3m");
    expect(days).toHaveLength(13);
    expect(days[12]).toBe(TODAY);
    expect(days[11]).toBe("2026-10-20");
    expect(days[0]).toBe("2026-08-04");
  });

  it("is month ends for a year, the last being today", () => {
    const days = trendDates(TODAY, "1y");
    expect(days).toHaveLength(12);
    expect(days[10]).toBe("2026-09-30");
    expect(days[11]).toBe(TODAY);
    expect(trendDates(TODAY, "all")).toHaveLength(60);
  });
});

describe("splitting a rise into money added and market growth", () => {
  it("counts a purchase as added, net of what was taken out, and the rest as growth", () => {
    const prev = { worthPaise: 120_000_00, putInPaise: 100_000_00, soldPaise: 0 };
    expect(growthSplit(prev, { worthPaise: 160_000_00, putInPaise: 110_000_00, soldPaise: 0 })).toEqual({ addedPaise: 10_000_00, growthPaise: 30_000_00 });
    expect(growthSplit(prev, { worthPaise: 100_000_00, putInPaise: 100_000_00, soldPaise: 15_000_00 })).toEqual({ addedPaise: -15_000_00, growthPaise: -5_000_00 });
  });

  it("has nothing to compare the first day with", () => {
    expect(growthSplit(null, { worthPaise: 5, putInPaise: 5, soldPaise: 0 })).toEqual({ addedPaise: 0, growthPaise: 0 });
  });
});

describe("the investments series", () => {
  let userId: string;
  beforeEach(async () => {
    userId = await createUser();
  });

  it("shows worth and money put in at each month end, and what each period added and the market did", async () => {
    const bank = await insertAccount(db, userId, { kind: "bank", name: "Bank", openingBalancePaise: 5_00_000_00 });
    const h = await createHolding(db, userId, { name: "Fund", kind: "fund", investedPaise: 100_000_00, valuePaise: 110_000_00, valueDate: "2026-08-15" }, TODAY);
    await setValue(db, userId, h.id, { valuePaise: 120_000_00, date: "2026-09-20" }, TODAY);
    await setValue(db, userId, h.id, { valuePaise: 150_000_00, date: "2026-10-10" }, TODAY);
    await buy(db, userId, h.id, { amountPaise: 10_000_00, accountId: bank.id, date: "2026-10-15" }, TODAY);

    const t = await getInvestmentTrend(db, userId, TODAY, "1y");
    const at = (d: string) => t.points.find((p) => p.asOf === d);
    expect(at("2026-08-31")).toMatchObject({ worthPaise: 110_000_00, putInPaise: 100_000_00 });
    expect(at("2026-09-30")).toMatchObject({ worthPaise: 120_000_00, putInPaise: 100_000_00, addedPaise: 0, growthPaise: 10_000_00 });
    expect(at(TODAY)).toMatchObject({ worthPaise: 160_000_00, putInPaise: 110_000_00, addedPaise: 10_000_00, growthPaise: 30_000_00 });
    // Money put in before it was tracked counts from the start, so earlier months are flat at cost.
    expect(at("2026-06-30")).toMatchObject({ worthPaise: 100_000_00, putInPaise: 100_000_00 });
    expect(t.points.at(-1)?.asOf).toBe(TODAY);
  });

  it("looks weekly for three months", async () => {
    const h = await createHolding(db, userId, { name: "Fund", kind: "fund", investedPaise: 100_000_00, valuePaise: 100_000_00, valueDate: "2026-08-01" }, TODAY);
    await setValue(db, userId, h.id, { valuePaise: 130_000_00, date: "2026-10-14" }, TODAY);
    const t = await getInvestmentTrend(db, userId, TODAY, "3m");
    expect(t.points).toHaveLength(13);
    expect(t.points.find((p) => p.asOf === "2026-10-13")?.worthPaise).toBe(100_000_00);
    expect(t.points.find((p) => p.asOf === "2026-10-20")?.worthPaise).toBe(130_000_00);
  });

  it("counts only your share of a shared holding, from the day the other person came in", async () => {
    const h = await createHolding(db, userId, { name: "Shared fund", kind: "fund", investedPaise: 10_000_00, valuePaise: 12_000_00, valueDate: "2026-10-01" }, TODAY);
    await addPartnerStake(db, userId, h.id, { name: "Ravi", amountPaise: 4_000_00, date: "2026-10-02" }, TODAY);
    const t = await getInvestmentTrend(db, userId, TODAY, "1y");
    expect(t.points.find((p) => p.asOf === "2026-09-30")?.worthPaise).toBe(10_000_00);
    expect(t.points.at(-1)?.worthPaise).toBe(7_200_00);
  });

  it("counts a closed investment as it stood before it was closed", async () => {
    const h = await createHolding(db, userId, { name: "Old", kind: "fund", investedPaise: 40_000_00, valuePaise: 50_000_00, valueDate: "2026-08-01" }, TODAY);
    await closeHolding(db, userId, h.id, TODAY);
    const t = await getInvestmentTrend(db, userId, TODAY, "1y");
    expect(t.points.find((p) => p.asOf === "2026-09-30")?.worthPaise).toBe(50_000_00);
    expect(t.points.at(-1)?.worthPaise).toBe(0);
  });

  it("groups worth by kind and by broker account, biggest first, with the right names", async () => {
    const broker = await createInvestmentAccount(db, userId, { name: "Groww" });
    await createHolding(db, userId, { name: "Stock A", kind: "stock", investedPaise: 10_000_00, valuePaise: 30_000_00, valueDate: "2026-10-01", investmentAccountId: broker.id }, TODAY);
    await createHolding(db, userId, { name: "Gold bar", kind: "other", investedPaise: 5_000_00, valuePaise: 8_000_00, valueDate: "2026-10-01" }, TODAY);
    const t = await getInvestmentTrend(db, userId, TODAY, "3m");
    expect(t.byKind.map((s) => [s.name, s.worthPaise.at(-1)])).toEqual([
      ["Stock or IPO", 30_000_00],
      ["Other", 8_000_00],
    ]);
    expect(t.byBroker.map((s) => [s.name, s.worthPaise.at(-1)])).toEqual([
      ["Groww", 30_000_00],
      ["Not in a broker account", 8_000_00],
    ]);
    for (const s of [...t.byKind, ...t.byBroker]) expect(s.worthPaise).toHaveLength(t.points.length);
    // Each day the pieces add up to the total.
    t.points.forEach((p, i) => expect(t.byKind.reduce((sum, s) => sum + (s.worthPaise[i] ?? 0), 0)).toBe(p.worthPaise));
  });

  it("has no points when nothing is invested", async () => {
    expect(await getInvestmentTrend(db, userId, TODAY, "1y")).toMatchObject({ points: [], byKind: [], byBroker: [] });
  });
});

describe("the investment trend route", () => {
  it("answers for the person alone, defaults to a year, and refuses a range it does not know", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    await createHolding(db, user.id, { name: "Mine", kind: "fund", investedPaise: 10_000_00, valuePaise: 12_000_00, valueDate: "2026-10-01" }, TODAY);
    const other = await createUser();
    await createHolding(db, other, { name: "Theirs", kind: "fund", investedPaise: 99_000_00, valuePaise: 99_000_00, valueDate: "2026-10-01" }, TODAY);

    const res = await app.call("GET", "/api/investment-trend", { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { range: string; points: { asOf: string; worthPaise: number }[] };
    expect(body.range).toBe("1y");
    expect(body.points.at(-1)).toMatchObject({ asOf: TODAY, worthPaise: 12_000_00 });
    expect((await app.call("GET", "/api/investment-trend?range=weekly", { cookie })).status).toBe(422);
    expect((await app.call("GET", "/api/investment-trend?range=3m", { cookie })).status).toBe(200);
  });
});
