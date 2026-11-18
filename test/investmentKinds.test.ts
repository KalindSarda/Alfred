import { describe, expect, it } from "vitest";
import type { Holding } from "../web/src/api";
import { kindSummary, looseByKind } from "../web/src/investmentKinds";

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
