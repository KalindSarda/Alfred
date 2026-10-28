import { describe, expect, it } from "vitest";
import { type BriefingCard, type BriefingFacts, buildBriefingLines, dayPart, daysBetween, greeting, inDays, subline } from "../src/alfred/voice";
import { login, makeApp, registeredUser } from "./api-helpers";

const card = (over: Partial<BriefingCard> = {}): BriefingCard => ({
  name: "HDFC Millennia",
  nextDueDate: "2026-11-12",
  statementOutstandingPaise: 0,
  ...over,
});

const facts = (over: Partial<BriefingFacts> = {}): BriefingFacts => ({
  today: "2026-10-27",
  periodKey: "30d",
  cycleStartDay: 1,
  safeToSpendPaise: 1_71_922_00,
  setAsidePaise: 0,
  expensePaise: 0,
  previousExpensePaise: 0,
  uncategorizedCount: 0,
  draftCount: 0,
  cards: [],
  ...over,
});

const fmt = (d: string) => d;
const lines = (over: Partial<BriefingFacts> = {}) => buildBriefingLines(facts(over), fmt);
const find = (over: Partial<BriefingFacts>, key: string) => lines(over).find((l) => l.key === key);

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

  it("is stable for the same moment, and the subline varies across days", () => {
    const now = new Date("2026-10-27T14:00:00Z");
    expect(greeting("Kalind", now)).toBe(greeting("Kalind", now));
    expect(subline(now)).toBe(subline(now));
    const seen = new Set([0, 1, 2, 3].map((d) => subline(new Date(Date.UTC(2026, 9, 27 + d, 14)))));
    expect(seen.size).toBeGreaterThan(1);
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

describe("briefing lines", () => {
  it("states safe-to-spend as recorded", () => {
    expect(lines()[0]?.text).toBe("₹1,71,922 is available to spend, as recorded.");
  });

  it("says how much is set aside when some accounts are not counted", () => {
    expect(lines({ safeToSpendPaise: 86_542_00, setAsidePaise: 84_380_00 })[0]?.text).toBe(
      "₹86,542 is available to spend, as recorded. A further ₹84,380 is set aside and not counted.",
    );
    expect(lines({ setAsidePaise: 0 })[0]?.text).not.toContain("set aside");
  });

  it("words the user's own month naturally, and compares with the same point last month", () => {
    const calendar = find({ periodKey: "cycle", cycleStartDay: 1, expensePaise: 9_000_00, previousExpensePaise: 8_000_00 }, "spend")?.text;
    expect(calendar).toBe("You have spent ₹9,000 so far this month. That is ₹1,000 more than the same point last month.");
    const payday = find({ periodKey: "cycle", cycleStartDay: 30, expensePaise: 10_000_00, previousExpensePaise: 10_000_00 }, "spend")?.text;
    expect(payday).toBe("You have spent ₹10,000 since the 30th. That matches the same point last month.");
    expect(find({ periodKey: "cycle", cycleStartDay: 1, expensePaise: 5_000_00 }, "spend")?.text).toContain("no earlier spending to compare with");
  });

  it.each([
    [1, "since the 1st"],
    [2, "since the 2nd"],
    [3, "since the 3rd"],
    [11, "since the 11th"],
    [21, "since the 21st"],
    [22, "since the 22nd"],
    [30, "since the 30th"],
  ])("orders day %i as an ordinal", (day, expected) => {
    // day 1 is the calendar month, so use 2+ for the "since" wording and check 1 separately above
    if (day === 1) return;
    expect(find({ periodKey: "cycle", cycleStartDay: day, expensePaise: 100_00 }, "spend")?.text).toContain(expected);
  });

  it("explains a shortfall without blame", () => {
    expect(lines({ safeToSpendPaise: -2_500_00 })[0]?.text).toBe("Your recorded balances are ₹2,500 short of what your cards currently owe.");
  });

  it("names the soonest card with money due and counts the rest", () => {
    const cards = [
      card({ name: "Amazon Pay", nextDueDate: "2026-10-30", statementOutstandingPaise: 5_000_00 }),
      card({ name: "OneCard", nextDueDate: "2026-11-07", statementOutstandingPaise: 1_200_00 }),
      card({ name: "Paid card", nextDueDate: "2026-10-29", statementOutstandingPaise: 0 }),
    ];
    expect(find({ cards }, "due")?.text).toBe("Amazon Pay: ₹5,000 is due on 2026-10-30 (in 3 days), with 1 more card to follow.");
  });

  it("says so when nothing is pending, and omits the line when there are no cards", () => {
    expect(find({ cards: [card()] }, "due")?.text).toBe("No card payments are pending.");
    expect(lines().some((l) => l.key === "due")).toBe(false);
  });

  it("compares spending with the period before, neutrally", () => {
    expect(find({ expensePaise: 44_318_00, previousExpensePaise: 40_000_00 }, "spend")?.text).toBe(
      "You have spent ₹44,318 over the last 30 days. That is ₹4,318 more than the period before.",
    );
    expect(find({ expensePaise: 10_000_00, previousExpensePaise: 11_000_00 }, "spend")?.text).toContain("₹1,000 less than the period before");
    expect(find({ expensePaise: 5_000_00, previousExpensePaise: 5_000_00 }, "spend")?.text).toContain("That matches the period before.");
    expect(find({ expensePaise: 5_000_00 }, "spend")?.text).toContain("no earlier spending to compare with");
  });

  it("allows a dry aside only for a clear swing, and never a scolding one", () => {
    expect(find({ expensePaise: 13_000_00, previousExpensePaise: 10_000_00 }, "spend")?.text).toContain("Your money has been rather busy.");
    expect(find({ expensePaise: 7_000_00, previousExpensePaise: 10_000_00 }, "spend")?.text).toContain("A restrained stretch.");
    expect(find({ expensePaise: 11_000_00, previousExpensePaise: 10_000_00 }, "spend")?.text).not.toMatch(/busy|restrained/);
    expect(find({ expensePaise: 5_000_00 }, "spend")?.text).not.toMatch(/busy|restrained/);
    const words = lines({ expensePaise: 50_000_00, previousExpensePaise: 10_000_00 }).map((l) => l.text).join(" ");
    expect(words).not.toMatch(/overspen|too much|should|careful|waste/i);
  });

  it("omits the spending line when there is nothing to say", () => {
    expect(lines().some((l) => l.key === "spend")).toBe(false);
  });

  it("reports entries needing a category and drafts as separate lines with correct grammar", () => {
    expect(find({ uncategorizedCount: 1 }, "uncategorized")?.text).toBe("1 entry needs a category.");
    expect(find({ uncategorizedCount: 2 }, "uncategorized")?.text).toBe("2 entries need a category.");
    expect(find({ draftCount: 1 }, "drafts")?.text).toBe("1 entry is waiting for your confirmation.");
    expect(find({ draftCount: 3 }, "drafts")?.text).toBe("3 entries are waiting for your confirmation.");
  });

  it("each review line links to its own filtered list", () => {
    const l = lines({ uncategorizedCount: 2, draftCount: 1 });
    expect(l.find((x) => x.key === "uncategorized")?.to).toBe("/transactions?category=none");
    expect(l.find((x) => x.key === "drafts")?.to).toBe("/transactions?status=draft");
  });

  it("shows neither review line when nothing needs attention", () => {
    expect(lines().some((l) => l.key === "uncategorized" || l.key === "drafts")).toBe(false);
  });
});

describe("GET /api/alfred/briefing", () => {
  async function session() {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const api = async (method: string, path: string, body?: unknown) => {
      const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, any> };
    };
    return { api };
  }

  it("greets by name and invites you to set up when nothing is recorded", async () => {
    const { api } = await session();
    const res = await api("GET", "/api/alfred/briefing");
    expect(res.status).toBe(200);
    expect(res.json.greeting).toMatch(/^Good (morning|afternoon|evening), \S+\.$/);
    expect(res.json.source).toBe("template");
    expect(res.json.lines.map((l: { key: string }) => l.key)).toEqual(["start", "demo"]);
    expect(res.json.footer).toContain("recorded transactions");
  });

  it("builds the briefing from the user's recorded figures", async () => {
    const { api } = await session();
    const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "Main", openingBalancePaise: 10_000_00 })).json;
    await api("POST", "/api/accounts", { kind: "card", name: "Millennia", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 });
    await api("POST", "/api/transactions", { type: "expense", amountPaise: 1_000_00, txnDate: "2026-10-20", accountId: bank.id });
    const res = (await api("GET", "/api/alfred/briefing")).json;
    const byKey = Object.fromEntries(res.lines.map((l: { key: string; text: string }) => [l.key, l.text]));
    expect(byKey.safe).toBe("₹9,000 is available to spend, as recorded.");
    expect(byKey.due).toBe("No card payments are pending.");
    expect(byKey.spend).toContain("You have spent ₹1,000 so far this month.");
    expect(byKey.uncategorized).toBe("1 entry needs a category.");
  });

  it("uses the saved display name", async () => {
    const { api } = await session();
    await api("PATCH", "/api/settings", { displayName: "Kalind" });
    const greetingText = (await api("GET", "/api/alfred/briefing")).json.greeting as string;
    expect(greetingText).toMatch(/Kalind\.|sir\./);
  });

  it("requires a session", async () => {
    expect((await makeApp().call("GET", "/api/alfred/briefing")).status).toBe(401);
  });
});
