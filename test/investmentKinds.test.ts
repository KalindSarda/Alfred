import { describe, expect, it } from "vitest";
import type { Holding } from "../web/src/api";
import { BROKER_COLORS, EXTRA_KIND_COLORS, KIND_COLORS, kindSummary, looseByKind, purchasesOf, worthSegments } from "../web/src/investmentKinds";

const E4 = 10_000;

const holding = (over: Partial<Holding>): Holding => {
  const whole = {
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
  openingUnitsE4: 0,
  missingUnits: 0,
  ...over,
  };
  // Not shared unless a test says so: your part is the whole of it.
  return { myInvestedPaise: whole.investedPaise, myValuePaise: whole.valuePaise, myGainPaise: whole.gainPaise, shared: null, ...whole } as Holding;
};

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
      { id: "e1", kind: "buy", amountPaise: 1_00_000_00, date: "2026-03-01", accountId: "a", accountName: "HDFC bank", note: null, unitsE4: 8 * E4 },
      { id: "e2", kind: "buy", amountPaise: 50_000_00, date: "2026-09-15", accountId: "a", accountName: "ICICI", note: null, unitsE4: 4 * E4 },
    ],
    lots: [{ id: "l1", date: "2025-01-10", unitsE4: 4 * E4, costPaise: 50_000_00, note: null }],
  });
  const bar = holding({ id: "b", name: "Gold bar", investedPaise: 1_00_000_00, valuePaise: 1_10_000_00, gainPaise: 10_000_00, unitsHeldE4: 8 * E4, ratePaise: 1_37_000_00, valueDate: "2026-10-20", entries: [{ id: "e3", kind: "buy", amountPaise: 1_00_000_00, date: "2026-06-01", accountId: "a", accountName: "HDFC bank", note: null, unitsE4: 8 * E4 }] });

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
      openingUnitsE4: 10 * E4,
      ratePer: 1000,
      entries: [{ id: "e1", kind: "buy", amountPaise: 19_776_00, date: "2026-11-07", accountId: "a", accountName: "Hdfc bank", note: null, unitsE4: 100 * E4 }],
    });
    const list = kindSummary("silver", "Silver", [brick]).purchases;
    expect(list.map((p) => [p.kind, p.date, p.unitsE4, p.amountPaise])).toEqual([
      ["buy", "2026-11-07", 100 * E4, 19_776_00],
      ["opening", "", 10 * E4, 2_008_00],
    ]);
    // the purchases add up to what was put in
    expect(list.reduce((s, p) => s + p.amountPaise, 0)).toBe(brick.investedPaise);
  });

  it("shows the opening quantity as held, and none when nothing was held", () => {
    const h = holding({ id: "g", openingInvestedPaise: 0, openingUnitsE4: 0, unitsHeldE4: 9 * E4 });
    expect(kindSummary("gold", "Gold", [h]).purchases.some((p) => p.kind === "opening")).toBe(false);
    const more = kindSummary("gold", "Gold", [{ ...h, openingUnitsE4: 3 * E4 }]).purchases.find((p) => p.kind === "opening");
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
        { id: "e1", kind: "buy", amountPaise: 1_000_00, date: "2026-03-01", accountId: "a", accountName: null, note: null, unitsE4: null },
        { id: "e2", kind: "buy", amountPaise: 1_000_00, date: "2026-03-02", accountId: "a", accountName: null, note: null, unitsE4: 2 * E4 },
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

describe("what each line can do", () => {
  const base = holding({
    id: "h",
    name: "EPF",
    kind: "retirement",
    kindName: "Retirement",
    tracking: "value",
    unitLabel: null,
    unitOne: null,
    ratePer: 1,
    openingInvestedPaise: 1_000_00,
    entries: [{ id: "b1", kind: "buy", amountPaise: 500_00, date: "2026-10-01", accountId: "a", accountName: "HDFC", note: null, unitsE4: null }, { id: "s1", kind: "sell", amountPaise: 100_00, date: "2026-10-02", accountId: "a", accountName: "HDFC", note: null, unitsE4: null }],
    contributions: [
      { id: "c1", date: "2026-10-03", ownPaise: 100_00, employerPaise: 0, note: null, linked: { role: "primary", holdingId: "x", holdingName: "EPS", paise: 50_00 } },
      { id: "c2", date: "2026-10-04", ownPaise: 0, employerPaise: 50_00, note: null, linked: { role: "pension", holdingId: "y", holdingName: "EPF", paise: 100_00 } },
    ],
  });
  const flags = (key: string) => purchasesOf(base).find((p) => p.key === key);

  it("lets a buy, a sale and a contribution be corrected and taken out", () => {
    for (const key of ["eb1", "es1", "cc1"]) expect(flags(key), key).toMatchObject({ editable: true, removable: true });
  });

  it("only takes the pension side of a contribution out, and only corrects the opening balance", () => {
    expect(flags("cc2")).toMatchObject({ editable: false, removable: true });
    expect(flags(`o${base.id}`)).toMatchObject({ kind: "opening", editable: true, removable: false });
  });

  it("lets a lot be corrected and taken out", () => {
    const withLot = holding({ id: "g", lots: [{ id: "l1", date: "2025-01-01", unitsE4: E4, costPaise: 100_00, note: null }], unitsHeldE4: E4 });
    expect(purchasesOf(withLot).find((p) => p.key === "ll1")).toMatchObject({ editable: true, removable: true, lotId: "l1" });
  });
});

describe("the stacked bar of what you hold", () => {
  const retirement = holding({ id: "r1", name: "EPF", kind: "retirement", kindName: "Retirement", tracking: "value", unitLabel: null, unitOne: null, ratePer: 1, valuePaise: 16_399_00 });
  const retirement2 = holding({ id: "r2", name: "EPS pension", kind: "retirement", kindName: "Retirement", tracking: "value", unitLabel: null, unitOne: null, ratePer: 1, valuePaise: 8_721_00 });
  const silver = holding({ id: "s1", name: "brick", kind: "silver", kindName: "Silver", valuePaise: 22_000_00 });
  const gold = holding({ id: "g1", name: "Coins", kind: "gold", kindName: "Gold", valuePaise: 2_62_600_00 });
  const accounts = [
    { id: "gw", name: "Groww", valuePaise: 66_977_00 },
    { id: "ic", name: "ICICI Direct", valuePaise: 0 },
  ];
  const loose = looseByKind([retirement, retirement2, silver, gold], new Set(["gw", "ic"]));

  it("has a piece for each account and each kind, biggest first, with none for what is worth nothing", () => {
    const segs = worthSegments(accounts, loose);
    expect(segs.map((s) => s.label)).toEqual(["Gold", "Groww", "Retirement", "Silver"]);
    expect(segs.map((s) => s.source)).toEqual(["kind", "account", "kind", "kind"]);
  });

  it("keeps Retirement as one piece made of EPF and EPS pension, and never merges kinds into an other", () => {
    const seg = worthSegments(accounts, loose).find((s) => s.label === "Retirement");
    expect(seg?.valuePaise).toBe(25_120_00);
    expect(worthSegments(accounts, loose).some((s) => /other/i.test(s.label))).toBe(false);
  });

  it("adds up to about the whole", () => {
    const total = worthSegments(accounts, loose).reduce((sum, s) => sum + s.pct, 0);
    expect(total).toBeGreaterThan(99.8);
    expect(total).toBeLessThan(100.2);
  });

  it("gives each known kind its own colour and an added kind the next spare one", () => {
    const segs = worthSegments(accounts, loose);
    expect(segs.find((s) => s.label === "Gold")?.color).toBe(KIND_COLORS.gold);
    expect(segs.find((s) => s.label === "Silver")?.color).toBe(KIND_COLORS.silver);
    expect(segs.find((s) => s.label === "Retirement")?.color).toBe(KIND_COLORS.retirement);
    const added = looseByKind([holding({ id: "x1", kind: "k-1", kindName: "Bonds", valuePaise: 1_000_00 }), holding({ id: "x2", kind: "k-2", kindName: "Art", valuePaise: 2_000_00 })], new Set());
    const colors = worthSegments([], added).map((s) => s.color);
    expect(new Set(colors).size).toBe(2);
    for (const c of colors) expect(EXTRA_KIND_COLORS).toContain(c);
  });

  it("gives a kind added by hand the colour its name suggests", () => {
    const silverByHand = looseByKind([holding({ id: "x", kind: "01ABCDEF", kindName: "Silver", valuePaise: 1_000_00 })], new Set());
    expect(worthSegments([], silverByHand)[0]?.color).toBe(KIND_COLORS.silver);
  });

  it("gives broker accounts a green by their place by name, and the colours are all different", () => {
    const two = [
      { id: "z", name: "Zerodha", valuePaise: 5_000_00 },
      { id: "a", name: "Axis Direct", valuePaise: 4_000_00 },
    ];
    const segs = worthSegments(two, []);
    expect(segs.find((s) => s.label === "Axis Direct")?.color).toBe(BROKER_COLORS[0]);
    expect(segs.find((s) => s.label === "Zerodha")?.color).toBe(BROKER_COLORS[1]);
    const all = [...Object.values(KIND_COLORS), ...EXTRA_KIND_COLORS, ...BROKER_COLORS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("is empty when nothing is worth anything", () => {
    expect(worthSegments([{ id: "a", name: "Groww", valuePaise: 0 }], [])).toEqual([]);
  });
});

describe("a holding shared with others", () => {
  const shared = holding({
    id: "s1",
    name: "Tata",
    kind: "stock",
    kindName: "Stock",
    tracking: "value",
    unitLabel: null,
    unitOne: null,
    ratePer: 1,
    investedPaise: 1_00_000_00,
    valuePaise: 1_20_000_00,
    gainPaise: 20_000_00,
    myInvestedPaise: 60_000_00,
    myValuePaise: 72_000_00,
    myGainPaise: 12_000_00,
    shared: { mySharePct: 60, partners: [] },
  });

  it("counts only your share in a kind's totals and in the bar", () => {
    const solo = holding({ id: "s2", kind: "stock", kindName: "Stock", tracking: "value", valuePaise: 10_000_00, investedPaise: 8_000_00, gainPaise: 2_000_00 });
    const k = kindSummary("stock", "Stock", [shared, solo]);
    expect(k).toMatchObject({ valuePaise: 82_000_00, investedPaise: 68_000_00, gainPaise: 14_000_00 });
    expect(worthSegments([], looseByKind([shared, solo], new Set()))[0]?.valuePaise).toBe(82_000_00);
  });
});
