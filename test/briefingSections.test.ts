import { describe, expect, it } from "vitest";
import { type BriefingFacts, buildBriefingLines, composeBriefing, SECTION_ORDER } from "../src/alfred/voice";
import { formatRupeesCompact } from "../src/domain/money";
import { world } from "./bot/harness";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

const facts = (over: Partial<BriefingFacts> = {}): BriefingFacts => ({
  today: "2026-10-27",
  periodKey: "30d",
  cycleStartDay: 1,
  safeToSpendPaise: 1_00_000_00,
  setAsidePaise: 0,
  expensePaise: 0,
  previousExpensePaise: 0,
  uncategorizedCount: 0,
  draftCount: 0,
  cards: [],
  budgets: [],
  holds: [],
  emi: { toComePaise: 0, next: null },
  recurring: null,
  ...over,
});
const lines = (over: Partial<BriefingFacts> = {}, money?: (p: number) => string) => buildBriefingLines(facts(over), (d) => d, money);
const find = (over: Partial<BriefingFacts>, key: string) => lines(over).find((l) => l.key === key);

describe("the position line", () => {
  it("merges what is in hand and what is free into one line, instead of saying it twice", () => {
    const all = lines({ commitments: { count: 1, untilDate: "2026-11-30", freeToSpendPaise: 80_000_00 } });
    expect(all.filter((l) => l.section === "position")).toHaveLength(1);
    expect(all.some((l) => l.key === "safe" || l.key === "free")).toBe(false);
    expect(find({ commitments: { count: 1, untilDate: "2026-11-30", freeToSpendPaise: 80_000_00 } }, "position")?.text).toBe("₹80,000 is free to spend until 2026-11-30. You have ₹1,00,000 in hand, with ₹20,000 still to leave in 1 payment.");
  });

  it("says when what is still to leave is more than what is free, and when cards are owed more than the banks hold", () => {
    expect(find({ commitments: { count: 2, untilDate: "2026-11-30", freeToSpendPaise: -5_000_00 } }, "position")?.text).toBe("2 payments still to leave before 2026-11-30 come to ₹5,000 more than is free to spend. You have ₹1,00,000 in hand.");
    expect(find({ safeToSpendPaise: -3_000_00 }, "position")?.text).toBe("Your recorded balances are ₹3,000 short of what your cards currently owe.");
  });

  it("can show lakhs and crores compactly for the web, while Telegram keeps exact figures", () => {
    expect(find({}, "position")?.text).toBe("₹1,00,000 is available to spend, as recorded.");
    expect(lines({ safeToSpendPaise: 7_04_549_82 }, formatRupeesCompact).find((l) => l.key === "position")?.text).toBe("₹7.05 L is available to spend, as recorded.");
  });
});

describe("which section a line is in", () => {
  it("puts a card due within three days under needs you, and a later one under coming up", () => {
    const card = (nextDueDate: string) => ({ cards: [{ name: "HDFC", nextDueDate, statementOutstandingPaise: 5_000_00 }] });
    expect(find(card("2026-10-29"), "due")).toMatchObject({ section: "needs", soon: true });
    expect(find(card("2026-10-30"), "due")).toMatchObject({ section: "needs", soon: false });
    expect(find(card("2026-11-12"), "due")).toMatchObject({ section: "coming", soon: false });
  });

  it("puts what cannot be paid, a renewal, overdue money and a logging gap under needs you", () => {
    const needs = lines({
      shortfalls: [{ title: "Rent", amountPaise: 20_000_00, accountName: "HDFC", shortByPaise: 5_000_00, date: "2026-10-29" }],
      insurance: { insurer: "Acme", kind: "health", premiumPaise: 25_000_00, date: "2026-10-30" },
      debts: { overdue: [{ name: "Asha", direction: "lent", outstandingPaise: 3_000_00, dueDate: "2026-10-01" }] },
      logging: { daysSince: 4, lastDate: "2026-10-23" },
      draftCount: 2,
    }).filter((l) => l.section === "needs");
    expect(needs.map((l) => l.key).sort()).toEqual(["debts", "drafts", "habit", "insurance", "shortfall"]);
    expect(needs.find((l) => l.key === "shortfall")?.text).toBe("Rent (₹20,000) is due in 2 days, but HDFC is ₹5,000 short.");
    expect(needs.find((l) => l.key === "insurance")?.text).toContain("Your health policy with Acme is due in 3 days: ₹25,000.");
  });

  it("puts the foundations under progress, and spending and budgets under trends", () => {
    const all = lines({
      progress: { emergency: { lifestylePct: 43, essentialsPct: 64 }, firePct: 1.3, focus: { title: "Health and life cover", detail: "No personal health cover recorded." } },
      expensePaise: 9_000_00,
      previousExpensePaise: 8_000_00,
      budgets: [{ categoryName: "Rent", pct: 99, remainingPaise: 100_00, status: "near" }],
    });
    expect(all.find((l) => l.key === "emergency")).toMatchObject({ section: "progress", text: "Emergency fund: 43% of your lifestyle goal, 64% of essentials only." });
    expect(all.find((l) => l.key === "independence")).toMatchObject({ section: "progress", text: "Independence: 1.3% of the way to your number." });
    expect(all.find((l) => l.key === "focus")).toMatchObject({ section: "progress", text: "Look at first: Health and life cover. No personal health cover recorded." });
    expect(all.find((l) => l.key === "spend")?.section).toBe("trends");
    expect(all.find((l) => l.key === "budget")?.section).toBe("trends");
  });

  it("leaves out progress that has nothing to say", () => {
    const all = lines({ progress: { emergency: null, firePct: null, focus: null } });
    expect(all.some((l) => l.section === "progress")).toBe(false);
  });
});

describe("composeBriefing", () => {
  const rich = lines({
    shortfalls: [{ title: "Rent", amountPaise: 20_000_00, accountName: "HDFC", shortByPaise: 5_000_00, date: "2026-10-29" }],
    insurance: { insurer: "Acme", kind: "term", premiumPaise: 0, date: "2026-10-30" },
    logging: { daysSince: 3, lastDate: "2026-10-24" },
    draftCount: 1,
    progress: { emergency: { lifestylePct: 43, essentialsPct: 64 }, firePct: 1.3, focus: { title: "Costly debt", detail: "x" } },
    emi: { toComePaise: 1_00_000_00, next: { title: "Phone", amountPaise: 20_000_00, date: "2026-11-23" } },
    recurring: { title: "Rent", type: "expense", amountPaise: 22_000_00, date: "2026-10-29" },
    expensePaise: 9_000_00,
    previousExpensePaise: 8_000_00,
    budgets: [{ categoryName: "Rent", pct: 99, remainingPaise: 100_00, status: "near" }],
    uncategorizedCount: 3,
  });

  it("keeps about seven lines, always the position and the most important", () => {
    const c = composeBriefing(rich);
    expect(rich.length).toBeGreaterThan(7);
    expect(c.lines).toHaveLength(7);
    expect(c.lines.some((l) => l.key === "position")).toBe(true);
    expect(c.lines.some((l) => l.key === "shortfall")).toBe(true);
    // The least important (an uncategorised count) is the first to go.
    expect(c.lines.some((l) => l.key === "uncategorized")).toBe(false);
  });

  it("groups by section in reading order, most important first inside each, and hides empty sections", () => {
    const c = composeBriefing(rich);
    const order = c.sections.map((s) => s.key);
    expect(order).toEqual(SECTION_ORDER.filter((k) => order.includes(k)));
    expect(c.sections.map((s) => s.title)).toContain("Needs you");
    const needs = c.sections.find((s) => s.key === "needs")!;
    expect(needs.lines.map((l) => l.importance)).toEqual([...needs.lines.map((l) => l.importance)].sort((a, b) => b - a));
    expect(composeBriefing(lines()).sections.map((s) => s.key)).toEqual(["position"]);
    // The flat list follows the sections.
    expect(c.lines.map((l) => l.key)).toEqual(c.sections.flatMap((s) => s.lines.map((l) => l.key)));
  });

  it("keeps everything when there is little to say", () => {
    const small = lines({ draftCount: 1 });
    expect(composeBriefing(small).lines).toHaveLength(small.length);
  });
});

describe("GET /api/alfred/briefing", () => {
  const get = async (w: W) => (await w.api("GET", "/api/alfred/briefing")).json as Json;

  it("returns sections, with the position first of the rest and no duplicate of it", async () => {
    const w = await world();
    const b = await get(w);
    expect(b.sections.map((s: Json) => s.key)).toContain("position");
    expect(b.lines.map((l: Json) => l.key)).toEqual(b.sections.flatMap((s: Json) => s.lines.map((l: Json) => l.key)));
    expect(b.lines.filter((l: Json) => l.key === "position")).toHaveLength(1);
  });

  it("shows the emergency fund and independence as progress once they are set up", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 30_000_00, txnDate: "2026-10-02", accountId: w.sbi.id, categoryId: w.category("Rent") });
    await w.api("PATCH", `/api/accounts/${w.hdfc.id}`, { isEmergency: true });
    const b = await get(w);
    const progress = b.sections.find((s: Json) => s.key === "progress");
    expect(progress.lines.map((l: Json) => l.key)).toContain("emergency");
    expect(progress.lines.find((l: Json) => l.key === "emergency").text).toMatch(/^Emergency fund: [\d.]+% of your lifestyle goal, [\d.]+% of essentials only\.$/);
  });

  it("names the foundation to look at first", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 30_000_00, txnDate: "2026-10-02", accountId: w.sbi.id, categoryId: w.category("Rent") });
    const focus = (await get(w)).lines.find((l: Json) => l.key === "focus");
    expect(focus.text).toContain("Look at first: Health and life cover.");
    expect(focus.to).toBe("/freedom#foundations");
  });

  it("puts an insurance renewal within a week under needs you", async () => {
    const w = await world();
    await w.api("POST", "/api/insurance", { kind: "health", insurer: "Acme", coverPaise: 10_00_000_00, premiumPaise: 25_000_00, renewalDate: "2026-10-30" });
    const needs = (await get(w)).sections.find((s: Json) => s.key === "needs");
    expect(needs.lines.find((l: Json) => l.key === "insurance").text).toContain("Your health policy with Acme is due in 3 days");
  });

  it("warns when a debit in the next few days cannot be covered", async () => {
    const w = await world();
    // Rent of more than the HDFC balance, due on the 29th.
    await w.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 2_00_000_00, accountId: w.hdfc.id, categoryId: w.category("Rent"), frequency: "monthly", day: 29 });
    const needs = (await get(w)).sections.find((s: Json) => s.key === "needs");
    expect(needs.lines.find((l: Json) => l.key === "shortfall").text).toContain("is due in 2 days, but HDFC Bank is");
  });

  it("shows lakhs compactly on the web", async () => {
    const w = await world();
    const text = (await get(w)).lines.find((l: Json) => l.key === "position").text as string;
    expect(text).toContain("₹1.5 L");
  });
});
