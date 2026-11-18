import { describe, expect, it } from "vitest";
import type { Holding } from "../web/src/api";
import { kindSummary, looseByKind, purchasesOf } from "../web/src/investmentKinds";

const E4 = 10_000;

const holding = (over: Partial<Holding>): Holding => ({
  id: "h",
  name: "Holding",
  kind: "gold",
  kindName: "Gold",
  status: "active",
  investmentAccountId: null,
  accountName: null,
  isEmergency: false,
  countsForFire: true,
  openingInvestedPaise: 0,
  investedPaise: 0,
  soldPaise: 0,
  valuePaise: 0,
  valueDate: null,
  staleDays: null,
  gainPaise: 0,
  gainPct: null,
  entries: [],
  values: [],
  tracking: "units",
  unitLabel: "g",
  unitOne: "g",
  ratePer: 10,
  unitsHeldE4: 0,
  ratePaise: null,
  avgCostPaise: null,
  lots: [],
  contributions: [],
  missingUnits: 0,
  ...over,
});

describe("a kind's summary", () => {
  const coins = holding({
    id: "a",
    name: "Gold coins",
    investedPaise: 2_00_000_00,
    valuePaise: 2_20_000_00,
    gainPaise: 20_000_00,
    unitsHeldE4: 16 * E4,
    ratePaise: 1_37_500_00,
    valueDate: "2026-11-10",
    entries: [
      { id: "e1", kind: "buy", amountPaise: 1_00_000_00, date: "2026-03-01", accountName: "HDFC bank", note: null, unitsE4: 8 * E4 },
      { id: "e2", kind: "buy", amountPaise: 50_000_00, date: "2026-09-15", accountName: "ICICI", note: null, unitsE4: 4 * E4 },
    ],
    lots: [{ id: "l1", date: "2025-01-10", unitsE4: 4 * E4, costPaise: 50_000_00, note: null }],
  });
  const bar = holding({ id: "b", name: "Gold bar", investedPaise: 1_00_000_00, valuePaise: 1_10_000_00, gainPaise: 10_000_00, unitsHeldE4: 8 * E4, ratePaise: 1_37_000_00, valueDate: "2026-10-20", entries: [{ id: "e3", kind: "buy", amountPaise: 1_00_000_00, date: "2026-06-01", accountName: "HDFC bank", note: null, unitsE4: 8 * E4 }] });

  it("adds up the worth, what was put in, the gain and the quantity", () => {
    const s = kindSummary("gold", "Gold", [coins, bar]);
    expect(s).toMatchObject({ valuePaise: 3_30_000_00, investedPaise: 3_00_000_00, gainPaise: 30_000_00, gainPct: 10, counted: true, unitsE4: 24 * E4, unitLabel: "g" });
  });

  it("takes the latest rate typed on any of its holdings, with its quantity and day", () => {
    expect(kindSummary("gold", "Gold", [coins, bar]).rate).toEqual({ paise: 1_37_500_00, per: 10, unitOne: "g", date: "2026-11-10" });
    expect(kindSummary("gold", "Gold", [bar]).rate?.date).toBe("2026-10-20");
  });

  it("lists buys and earlier lots of every holding, newest first, with the holding's name", () => {
    const list = kindSummary("gold", "Gold", [coins, bar]).purchases;
    expect(list.map((p) => [p.date, p.kind, p.holdingName, p.accountName, p.unitsE4, p.amountPaise])).toEqual([
      ["2026-09-15", "buy", "Gold coins", "ICICI", 4 * E4, 50_000_00],
      ["2026-06-01", "buy", "Gold bar", "HDFC bank", 8 * E4, 1_00_000_00],
      ["2026-03-01", "buy", "Gold coins", "HDFC bank", 8 * E4, 1_00_000_00],
      ["2025-01-10", "lot", "Gold coins", null, 4 * E4, 50_000_00],
    ]);
  });

  it("leaves out other kinds and closed holdings, and has no gain share when nothing was put in", () => {
    const silver = holding({ id: "s", kind: "silver", kindName: "Silver", valuePaise: 5_000_00 });
    const closed = holding({ id: "c", status: "closed", valuePaise: 9_99_000_00 });
    expect(kindSummary("gold", "Gold", [coins, silver, closed]).valuePaise).toBe(2_20_000_00);
    const free = kindSummary("silver", "Silver", [silver]);
    expect(free.gainPct).toBeNull();
    expect(free.rate).toBeNull();
  });

  it("has no quantity or rate for a kind valued by typing", () => {
    const brick = holding({ id: "k", kind: "other", kindName: "Other", tracking: "value", unitLabel: null, unitOne: null, ratePer: 1, valuePaise: 22_000_00, investedPaise: 20_000_00, gainPaise: 2_000_00 });
    const s = kindSummary("other", "Other", [brick]);
    expect(s).toMatchObject({ counted: false, unitsE4: null, unitLabel: null, rate: null, gainPct: 10 });
  });
});

describe("the opening balance and the actions on a purchase line", () => {
  it("shows what was held before any purchase, with the quantity left once purchases are taken off", () => {
    const brick = holding({
      id: "k",
      name: "brick",
      kind: "silver",
      kindName: "Silver",
      openingInvestedPaise: 2_008_00,
      investedPaise: 21_784_00,
      valuePaise: 22_000_00,
      gainPaise: 216_00,
      unitsHeldE4: 110 * E4,
      ratePer: 1000,
      entries: [{ id: "e1", kind: "buy", amountPaise: 19_776_00, date: "2026-11-07", accountName: "Hdfc bank", note: null, unitsE4: 100 * E4 }],
    });
    const list = kindSummary("silver", "Silver", [brick]).purchases;
    expect(list.map((p) => [p.kind, p.date, p.unitsE4, p.amountPaise])).toEqual([
      ["buy", "2026-11-07", 100 * E4, 19_776_00],
      ["opening", "", 10 * E4, 2_008_00],
    ]);
    // the purchases add up to what was put in
    expect(list.reduce((s, p) => s + p.amountPaise, 0)).toBe(brick.investedPaise);
  });

  it("takes sales and lots off when working out the opening quantity, and shows none when nothing was held", () => {
    const h = holding({
      id: "g",
      openingInvestedPaise: 0,
      unitsHeldE4: 9 * E4,
      entries: [
        { id: "b", kind: "buy", amountPaise: 1_000_00, date: "2026-01-01", accountName: null, note: null, unitsE4: 8 * E4 },
        { id: "s", kind: "sell", amountPaise: 500_00, date: "2026-02-01", accountName: null, note: null, unitsE4: 2 * E4 },
      ],
      lots: [{ id: "l", date: "2025-01-01", unitsE4: 3 * E4, costPaise: 300_00, note: null }],
    });
    // 8 bought, 2 sold, 3 from a lot is 9 held, so nothing was held at the start
    expect(kindSummary("gold", "Gold", [h]).purchases.some((p) => p.kind === "opening")).toBe(false);
    const more = kindSummary("gold", "Gold", [{ ...h, unitsHeldE4: 12 * E4 }]).purchases.find((p) => p.kind === "opening");
    expect(more?.unitsE4).toBe(3 * E4);
  });

  it("shows only the amount for a holding valued by typing", () => {
    const brick = holding({ id: "v", tracking: "value", unitLabel: null, unitOne: null, ratePer: 1, openingInvestedPaise: 5_000_00, unitsHeldE4: 0 });
    const line = kindSummary("gold", "Gold", [brick]).purchases[0];
    expect(line).toMatchObject({ kind: "opening", unitsE4: null, amountPaise: 5_000_00 });
  });

  it("marks a lot as removable and a buy with no quantity as needing one", () => {
    const h = holding({
      id: "q",
      unitsHeldE4: 2 * E4,
      entries: [
        { id: "e1", kind: "buy", amountPaise: 1_000_00, date: "2026-03-01", accountName: null, note: null, unitsE4: null },
        { id: "e2", kind: "buy", amountPaise: 1_000_00, date: "2026-03-02", accountName: null, note: null, unitsE4: 2 * E4 },
      ],
      lots: [{ id: "l1", date: "2025-01-01", unitsE4: 1 * E4, costPaise: 500_00, note: null }],
    });
    const by = (key: string) => kindSummary("gold", "Gold", [h]).purchases.find((p) => p.key === key);
    expect(by("ee1")).toMatchObject({ holdingId: "q", entryId: "e1", needsQuantity: true });
    expect(by("ee2")?.needsQuantity).toBe(false);
    expect(by("ll1")).toMatchObject({ kind: "lot", lotId: "l1", holdingId: "q" });
  });
});

describe("holdings outside a broker account, by kind", () => {
  it("makes one summary per kind, the most valuable first, leaving out those in an account", () => {
    const gold = holding({ id: "g", valuePaise: 3_00_000_00 });
    const silver = holding({ id: "s", kind: "silver", kindName: "Silver", valuePaise: 50_000_00 });
    const stock = holding({ id: "t", kind: "stock", kindName: "Stock or IPO", valuePaise: 9_00_000_00, investmentAccountId: "acc1" });
    const unassignedStock = holding({ id: "u", kind: "stock", kindName: "Stock or IPO", valuePaise: 1_00_000_00 });
    const list = looseByKind([gold, silver, stock, unassignedStock], new Set(["acc1"]));
    expect(list.map((k) => [k.kindKey, k.valuePaise])).toEqual([
      ["gold", 3_00_000_00],
      ["stock", 1_00_000_00],
      ["silver", 50_000_00],
    ]);
  });

  it("treats an account that no longer exists as no account", () => {
    const h = holding({ id: "g", investmentAccountId: "gone", valuePaise: 1_000_00 });
    expect(looseByKind([h], new Set(["acc1"]))).toHaveLength(1);
  });
});

describe("contribution lines", () => {
  const epf = holding({
    id: "epf",
    name: "EPF",
    kind: "retirement",
    kindName: "Retirement",
    tracking: "value",
    unitLabel: null,
    unitOne: null,
    ratePer: 1,
    investedPaise: 3_082_00,
    valuePaise: 3_082_00,
    contributions: [
      { id: "c1", date: "2026-10-15", ownPaise: 2_360_00, employerPaise: 722_00, note: null, linked: { role: "primary", holdingId: "eps", holdingName: "EPS pension", paise: 1_638_00 } },
      { id: "c2", date: "2026-09-13", ownPaise: 1_800_00, employerPaise: 0, note: null, linked: null },
    ],
  });

  it("shows each month with what it was made of and the pension share that went elsewhere", () => {
    const list = purchasesOf(epf);
    const first = list.find((p) => p.contributionId === "c1");
    expect(first).toMatchObject({ kind: "contribution", date: "2026-10-15", amountPaise: 3_082_00, holdingId: "epf" });
    expect(first?.detail).toBe("Your ₹2,360 · Employer ₹722 · Pension ₹1,638 to EPS pension");
    expect(list.find((p) => p.contributionId === "c2")?.detail).toBe("Your ₹1,800");
  });

  it("shows the pension investment's side as the employer's pension share and where it came from", () => {
    const eps = holding({
      id: "eps",
      name: "EPS pension",
      kind: "retirement",
      kindName: "Retirement",
      tracking: "value",
      unitLabel: null,
      unitOne: null,
      ratePer: 1,
      contributions: [{ id: "c3", date: "2026-10-15", ownPaise: 0, employerPaise: 1_638_00, note: null, linked: { role: "pension", holdingId: "epf", holdingName: "EPF", paise: 3_082_00 } }],
    });
    expect(purchasesOf(eps)[0]).toMatchObject({ kind: "contribution", amountPaise: 1_638_00, detail: "Employer pension share · from EPF" });
  });

  it("are part of a kind's list, newest first, and add up with the rest of what was put in", () => {
    const s = kindSummary("retirement", "Retirement", [epf]);
    expect(s.purchases.map((p) => p.date)).toEqual(["2026-10-15", "2026-09-13"]);
    expect(s.purchases.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(4_882_00);
  });
});
