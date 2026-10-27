import { describe, expect, it } from "vitest";
import { buildBriefing, cardsByDue, dayPart, daysBetween, greeting, inDays } from "../web/src/alfred";
import type { Account, CardAccount, Summary } from "../web/src/api";

const card = (over: Partial<CardAccount>): CardAccount => ({
  id: "c1",
  kind: "card",
  name: "HDFC Millennia",
  last4: null,
  creditLimitPaise: 2_00_000_00,
  statementDay: 23,
  dueDay: 12,
  openingOutstandingPaise: 0,
  archived: false,
  outstandingPaise: 0,
  unbilledPaise: 0,
  statementOutstandingPaise: 0,
  utilizationPct: 0,
  nextStatementDate: "2026-11-23",
  nextDueDate: "2026-11-12",
  ...over,
});

const summary = (over: Partial<Summary> = {}): Summary => ({
  period: { key: "30d", from: "2026-09-28", to: "2026-10-27" },
  safeToSpendPaise: 1_71_922_00,
  incomePaise: 0,
  expensePaise: 0,
  netPaise: 0,
  previousExpensePaise: 0,
  reviewCount: 0,
  ...over,
});

const fmt = (d: string) => d;
const TODAY = "2026-10-27";

describe("greeting", () => {
  it("follows IST, not the machine's timezone", () => {
    expect(dayPart(new Date("2026-10-27T00:00:00Z"))).toBe("morning"); // 05:30 IST
    expect(dayPart(new Date("2026-10-27T06:29:00Z"))).toBe("morning"); // 11:59 IST
    expect(dayPart(new Date("2026-10-27T06:30:00Z"))).toBe("afternoon"); // 12:00 IST
    expect(dayPart(new Date("2026-10-27T11:30:00Z"))).toBe("evening"); // 17:00 IST
  });

  it("treats the small hours as evening and 05:00 IST as the start of morning", () => {
    expect(dayPart(new Date("2026-10-27T22:29:00Z"))).toBe("evening"); // 03:59 IST
    expect(dayPart(new Date("2026-10-27T23:30:00Z"))).toBe("morning"); // 05:00 IST
  });

  it("uses the name, and says sir only on every seventh day of the month", () => {
    expect(greeting("Kalind", new Date("2026-10-27T14:00:00Z"))).toBe("Good evening, Kalind."); // 19:30 IST
    expect(greeting("Kalind", new Date("2026-10-26T14:00:00Z"))).toBe("Good evening, Kalind.");
    expect(greeting("Kalind", new Date("2026-10-27T10:00:00Z"))).toBe("Good afternoon, Kalind."); // 15:30 IST
    expect(greeting("Kalind", new Date("2026-10-21T04:00:00Z"))).toBe("Good morning, sir.");
    expect(greeting("Kalind", new Date("2026-10-14T04:00:00Z"))).toBe("Good morning, sir.");
  });

  it("is stable for the same moment", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    expect(greeting("Kalind", now)).toBe(greeting("Kalind", now));
  });
});

describe("date phrases", () => {
  it("counts days between IST dates", () => {
    expect(daysBetween("2026-10-27", "2026-11-07")).toBe(11);
    expect(daysBetween("2026-10-27", "2026-10-27")).toBe(0);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("phrases them naturally", () => {
    expect(inDays(0)).toBe("today");
    expect(inDays(-2)).toBe("today");
    expect(inDays(1)).toBe("tomorrow");
    expect(inDays(11)).toBe("in 11 days");
  });
});

describe("buildBriefing", () => {
  it("states safe-to-spend as recorded", () => {
    const lines = buildBriefing(summary(), [], TODAY, fmt);
    expect(lines[0]?.text).toBe("₹1,71,922 is available to spend, as recorded.");
  });

  it("explains a shortfall without blame", () => {
    const lines = buildBriefing(summary({ safeToSpendPaise: -2_500_00 }), [], TODAY, fmt);
    expect(lines[0]?.text).toBe("Your recorded balances are ₹2,500 short of what your cards currently owe.");
  });

  it("names the soonest card with money due and counts the rest", () => {
    const accounts: Account[] = [
      card({ id: "a", name: "Amazon Pay", nextDueDate: "2026-10-30", statementOutstandingPaise: 5_000_00 }),
      card({ id: "b", name: "OneCard", nextDueDate: "2026-11-07", statementOutstandingPaise: 1_200_00 }),
      card({ id: "c", name: "Paid card", nextDueDate: "2026-10-29", statementOutstandingPaise: 0 }),
    ];
    const due = buildBriefing(summary(), accounts, TODAY, fmt).find((l) => l.key === "due");
    expect(due?.text).toBe("Amazon Pay: ₹5,000 is due on 2026-10-30 (in 3 days), with 1 more card to follow.");
  });

  it("says so when nothing is pending, and omits the line when there are no cards", () => {
    const paid = [card({ statementOutstandingPaise: 0 })];
    expect(buildBriefing(summary(), paid, TODAY, fmt).find((l) => l.key === "due")?.text).toBe("No card payments are pending.");
    expect(buildBriefing(summary(), [], TODAY, fmt).some((l) => l.key === "due")).toBe(false);
  });

  it("ignores archived cards", () => {
    expect(cardsByDue([card({ archived: true, statementOutstandingPaise: 9_000_00 })])).toHaveLength(0);
  });

  it("compares spending with the period before, neutrally", () => {
    const more = buildBriefing(summary({ expensePaise: 44_318_00, previousExpensePaise: 40_000_00 }), [], TODAY, fmt);
    expect(more.find((l) => l.key === "spend")?.text).toBe(
      "You have spent ₹44,318 over the last 30 days. That is ₹4,318 more than the period before.",
    );
    const less = buildBriefing(summary({ expensePaise: 10_000_00, previousExpensePaise: 12_000_00 }), [], TODAY, fmt);
    expect(less.find((l) => l.key === "spend")?.text).toContain("₹2,000 less than the period before");
    const same = buildBriefing(summary({ expensePaise: 5_000_00, previousExpensePaise: 5_000_00 }), [], TODAY, fmt);
    expect(same.find((l) => l.key === "spend")?.text).toContain("That matches the period before.");
    const first = buildBriefing(summary({ expensePaise: 5_000_00 }), [], TODAY, fmt);
    expect(first.find((l) => l.key === "spend")?.text).toContain("no earlier spending to compare with");
  });

  it("omits the spending line when there is nothing to say", () => {
    expect(buildBriefing(summary(), [], TODAY, fmt).some((l) => l.key === "spend")).toBe(false);
  });

  it("mentions entries needing review, with correct grammar", () => {
    const one = buildBriefing(summary({ reviewCount: 1 }), [], TODAY, fmt).find((l) => l.key === "review");
    expect(one?.text).toBe("1 entry needs a category or confirmation.");
    const many = buildBriefing(summary({ reviewCount: 3 }), [], TODAY, fmt).find((l) => l.key === "review");
    expect(many?.text).toBe("3 entries need a category or confirmation.");
    expect(buildBriefing(summary({ reviewCount: 0 }), [], TODAY, fmt).some((l) => l.key === "review")).toBe(false);
  });
});
