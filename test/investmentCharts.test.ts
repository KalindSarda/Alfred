import { describe, expect, it } from "vitest";
import type { Holding, PriceOutcome, TrendPoint, TrendSeries } from "../web/src/api";
import { gainAt, gainBars, netPutIn, pointLabel, seriesColors, stackColumn, worthPaths, xAt, yAt } from "../web/src/investmentCharts";
import { changeLines } from "../web/src/priceChanges";

const point = (over: Partial<TrendPoint> = {}): TrendPoint => ({ asOf: "2026-10-27", worthPaise: 0, putInPaise: 0, soldPaise: 0, addedPaise: 0, growthPaise: 0, ...over });

describe("labels and scales", () => {
  it("labels a weekly point by its day and a monthly one by its month", () => {
    expect(pointLabel("2026-10-20", "3m")).toBe("20 Oct");
    expect(pointLabel("2026-09-30", "1y")).toBe("Sep 26");
    expect(pointLabel("2026-01-05", "3m")).toBe("5 Jan");
  });

  it("spreads points across the width and puts bigger values higher", () => {
    expect(xAt(0, 5, 600, 10)).toBe(10);
    expect(xAt(4, 5, 600, 10)).toBe(590);
    expect(xAt(0, 1, 600, 10)).toBe(300);
    expect(yAt(100, 0, 100, 150, 10)).toBe(10);
    expect(yAt(0, 0, 100, 150, 10)).toBe(140);
    expect(yAt(5, 5, 5, 150, 10)).toBe(75);
  });
});

describe("worth against what was put in", () => {
  it("never counts less than nothing as put in", () => {
    expect(netPutIn(point({ putInPaise: 100, soldPaise: 30 }))).toBe(70);
    expect(netPutIn(point({ putInPaise: 100, soldPaise: 130 }))).toBe(0);
  });

  it("works out the gain, counting what was taken out, and its percentage", () => {
    expect(gainAt(point({ worthPaise: 160_00, putInPaise: 110_00 }))).toEqual({ gainPaise: 50_00, pct: 45.5 });
    expect(gainAt(point({ worthPaise: 100_00, putInPaise: 100_00, soldPaise: 15_00 }))).toEqual({ gainPaise: 15_00, pct: 15 });
    expect(gainAt(point({ worthPaise: 5_00 })).pct).toBeNull();
  });

  it("draws a line for each and tints the gap between them", () => {
    const pts = [point({ asOf: "2026-08-31", worthPaise: 100, putInPaise: 100 }), point({ asOf: "2026-09-30", worthPaise: 120, putInPaise: 100 }), point({ asOf: "2026-10-27", worthPaise: 160, putInPaise: 110 })];
    const p = worthPaths(pts, 600, 150, 10);
    expect(p.worth.startsWith("M10.0")).toBe(true);
    expect(p.putIn.split("L")).toHaveLength(3);
    expect(p.gap.endsWith("Z")).toBe(true);
    expect(p.ys[2] as number).toBeLessThan(p.ys[0] as number);
    expect(worthPaths([pts[0] as TrendPoint], 600, 150, 10).gap).toBe("");
  });
});

describe("stacked columns", () => {
  const series: TrendSeries[] = [
    { key: "stock", name: "Stock or IPO", worthPaise: [600, 300] },
    { key: "gold", name: "Gold", worthPaise: [400, 0] },
  ];

  it("stacks the kinds bottom up, scaled to the biggest day, and skips what is nought", () => {
    const first = stackColumn(series, 0, 1000, 100);
    expect(first.map((s) => [s.key, s.h])).toEqual([["stock", 60], ["gold", 40]]);
    expect(first[0]?.y).toBe(40);
    expect(first[1]?.y).toBe(0);
    expect(stackColumn(series, 1, 1000, 100).map((s) => s.key)).toEqual(["stock"]);
  });

  it("colours a known kind as the rest of the app does, a kind of your own from the spare ones, and brokers in green", () => {
    const own: TrendSeries[] = [{ key: "abc123", name: "Silver", worthPaise: [1] }, { key: "zzz", name: "Art", worthPaise: [1] }];
    const kinds = seriesColors([...series, ...own], "kind");
    expect(kinds[0]).toBe("#2b6cde");
    expect(kinds[1]).toBe("#d9a21b");
    expect(kinds[2]).toBe("#94a3b8");
    expect(kinds[3]).toBe("#c2457a");
    expect(seriesColors([{ key: "none", name: "Not in a broker account", worthPaise: [1] }], "broker")).toEqual(["#6b7280"]);
  });
});

describe("gain by investment", () => {
  const h = (over: Partial<Holding>) => ({ id: "x", name: "A", kindName: "Stock or IPO", status: "active", myGainPaise: 0, myInvestedPaise: 0, ...over }) as Holding;

  it("lists active ones best to worst with a bar length relative to the biggest", () => {
    const bars = gainBars([h({ id: "a", name: "Up", myGainPaise: 50_000, myInvestedPaise: 100_000 }), h({ id: "b", name: "Down", myGainPaise: -100_000, myInvestedPaise: 400_000 }), h({ id: "c", name: "Closed", status: "closed", myGainPaise: 9_000_000 }), h({ id: "d", name: "Flat" })]);
    expect(bars.map((b) => b.name)).toEqual(["Up", "Flat", "Down"]);
    expect(bars[0]).toMatchObject({ pct: 50, share: 0.5 });
    expect(bars[2]).toMatchObject({ pct: -25, share: 1 });
    expect(bars[1]?.pct).toBeNull();
  });
});

describe("what changed after a refresh", () => {
  const o = (over: Partial<PriceOutcome>): PriceOutcome => ({ holdingId: "h", name: "X", source: "Yahoo", per: "share", status: "updated", ratePaise: 110_00, previousPaise: 100_00, changePaise: 0, reason: null, ...over });

  it("puts the biggest move in rupees first, and counts only what changed", () => {
    const lines = changeLines([
      o({ holdingId: "a", name: "Small", changePaise: 200_00 }),
      o({ holdingId: "b", name: "Big loss", ratePaise: 87_00, previousPaise: 100_00, changePaise: -3_804_00, per: "kg" }),
      o({ holdingId: "c", name: "Same", status: "unchanged", ratePaise: 100_00 }),
      o({ holdingId: "d", name: "Held", status: "held" }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(["Big loss", "Small"]);
    expect(lines[0]).toMatchObject({ from: 100_00, to: 87_00, per: "kg", ratePct: -13 });
    expect(lines[1]?.ratePct).toBe(10);
  });

  it("handles a first price, with nothing to compare it with", () => {
    const [line] = changeLines([o({ previousPaise: null, changePaise: 0 })]);
    expect(line).toMatchObject({ from: null, ratePct: null });
  });
});
