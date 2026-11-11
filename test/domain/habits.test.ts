import { describe, expect, it } from "vitest";
import { shouldNudge, silentDaysSince, type UsualEntry, usualItems } from "../../src/domain/habits";

describe("silentDaysSince", () => {
  it("counts days, and is null when nothing was ever logged", () => {
    expect(silentDaysSince("2026-11-07", "2026-11-11")).toBe(4);
    expect(silentDaysSince("2026-11-11", "2026-11-11")).toBe(0);
    expect(silentDaysSince(null, "2026-11-11")).toBeNull();
  });
});

describe("shouldNudge", () => {
  const nights = Array.from({ length: 41 }, (_, d) => d).filter(shouldNudge);

  it("is silent when logged today, nightly for four days, then every third day up to a month", () => {
    expect(shouldNudge(0)).toBe(false);
    expect(nights).toEqual([1, 2, 3, 4, 7, 10, 13, 16, 19, 22, 25, 28]);
  });

  it("stops after a month of silence", () => {
    expect([31, 34, 40, 100].some(shouldNudge)).toBe(false);
  });
});

// 2026-11-09 is a Monday, 2026-11-14 a Saturday.
const e = (id: string, txnDate: string, extra: Partial<UsualEntry> = {}): UsualEntry => ({ id, type: "expense", amountPaise: 5000, merchant: "Rapido", note: null, accountId: "hdfc", txnDate, ...extra });
const commute = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d, i) => e(`c${i}`, d));

describe("usualItems", () => {
  it("offers a spend repeated at least three times, with the latest entry as the template", () => {
    const items = usualItems(commute, "2026-11-09");
    expect(items).toEqual([{ templateId: "c3", name: "Rapido", amountPaise: 5000, count: 4 }]);
  });

  it("needs three repeats, the same amount and the same account", () => {
    expect(usualItems(commute.slice(0, 2), "2026-11-09")).toEqual([]);
    const mixed = [e("a", "2026-11-02"), e("b", "2026-11-03", { amountPaise: 5200 }), e("c", "2026-11-04", { accountId: "sbi" })];
    expect(usualItems(mixed, "2026-11-09")).toEqual([]);
  });

  it("leaves out what is already logged today, and ignores income and old entries", () => {
    expect(usualItems([...commute, e("t", "2026-11-09")], "2026-11-09")).toEqual([]);
    expect(usualItems(commute.map((x) => ({ ...x, type: "income" })), "2026-11-09")).toEqual([]);
    expect(usualItems(commute.map((x, i) => ({ ...x, txnDate: `2026-08-0${i + 1}` })), "2026-11-09")).toEqual([]);
  });

  it("does not offer a weekday habit on a weekend, but does offer one that happens at weekends", () => {
    expect(usualItems(commute, "2026-11-14")).toEqual([]);
    const weekend = ["2026-10-17", "2026-10-24", "2026-10-31"].map((d, i) => e(`w${i}`, d, { merchant: "Zomato", amountPaise: 30000 }));
    expect(usualItems([...commute, ...weekend], "2026-11-14").map((i) => i.name)).toEqual(["Zomato"]);
  });

  it("uses the note when there is no merchant, orders by how often, and returns at most three", () => {
    const many = ["A", "B", "C", "D"].flatMap((n, k) => Array.from({ length: 3 + (k === 3 ? 2 : 0) }, (_, i) => e(`${n}${i}`, `2026-11-0${i + 2}`, { merchant: null, note: n, amountPaise: 1000 + k })));
    const items = usualItems(many, "2026-11-09");
    expect(items).toHaveLength(3);
    expect(items[0]!.name).toBe("D");
  });
});
