import { describe, expect, it } from "vitest";
import { runSalaryPlans } from "../src/services/planJob";
import { runMonthlyReview } from "../src/services/reviewJob";
import { world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27. HDFC holds ₹1,00,000 and SBI ₹50,000. A ₹30,000 rent paid from SBI on 2 Oct leaves ₹1,20,000
// in banks and gives a monthly burn of ₹34,615.38 (3,461,538 paise) over 26 days.
const BURN = 3_461_538;
const ladder = async (w: W) => (await w.api("GET", "/api/ladder")).json as Json;
const suggestion = async (w: W) => (await w.api("GET", "/api/transfer-suggestion")).json as Json;
const stepOf = (l: Json, key: string) => l.steps.find((s: Json) => s.key === key);
const rent = (w: W) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 30_000_00, txnDate: "2026-10-02", accountId: w.sbi.id, categoryId: w.category("Rent") });
const reserve = async (w: W, countsTowardSafeToSpend = false) => (await w.api("POST", "/api/accounts", { kind: "bank", name: "Reserve", openingBalancePaise: 0, countsTowardSafeToSpend, isEmergency: true })).json as Json;
const loan = (w: W, ratePct: number) => w.api("POST", "/api/loans", { name: "Personal loan", kind: "personal", accountId: w.hdfc.id, principalPaise: 3_00_000_00, ratePct, months: 24, dueDay: 5, asOf: "2026-09-01" });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));

describe("the next-step ladder", () => {
  it("starts with the starter buffer until there is history, then moves to protection when there is no cover", async () => {
    const w = await world();
    const early = await ladder(w);
    expect(early.next).toMatchObject({ key: "starter", amountPaise: null });
    expect(early.steps.map((s: Json) => s.key)).toEqual(["starter", "debt", "protection", "emergency", "medical", "fire"]);

    await rent(w);
    const l = await ladder(w);
    expect(stepOf(l, "starter").status).toBe("done");
    expect(stepOf(l, "debt").status).toBe("done");
    expect(l.next.key).toBe("protection");
    expect(l.next.detail).toContain("No personal health cover recorded");
  });

  it("puts a costly loan first, and the rate that counts as costly is the person's to set", async () => {
    const w = await world();
    await rent(w);
    expect((await loan(w, 14)).status).toBe(201);
    const l = await ladder(w);
    expect(l.next).toMatchObject({ key: "debt" });
    expect(l.next.detail).toContain("Personal loan costs 14% a year");
    expect(l.next.amountPaise).toBeGreaterThan(0);

    await w.api("PATCH", "/api/settings", { costlyDebtBp: 1500 });
    expect(stepOf(await ladder(w), "debt").status).toBe("done");
    expect((await w.api("PATCH", "/api/settings", { costlyDebtBp: 50 })).status).toBe(422);
  });

  it("moves on to the emergency fund once protection is in place, then the medical layer", async () => {
    const w = await world();
    await rent(w);
    await w.api("PUT", "/api/protection/profile", { dependants: "no", employerHealth: "yes" });
    await w.api("POST", "/api/insurance", { kind: "health", insurer: "Acme", coverPaise: 10_00_000_00, premiumPaise: 20_000_00, renewalDate: "2027-03-01" });
    let l = await ladder(w);
    expect(l.next.key).toBe("emergency");
    expect(l.next.detail).toContain("Nothing is marked");

    await w.api("PATCH", `/api/accounts/${w.hdfc.id}`, { isEmergency: true });
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 50_000_00, medicalTargetPaise: 4_00_000_00 });
    l = await ladder(w);
    expect(stepOf(l, "emergency").status).toBe("done");
    expect(l.next.key).toBe("medical");
  });

  it("passes over a skipped step, and keeps the choice", async () => {
    const w = await world();
    await rent(w);
    const res = await w.api("PATCH", "/api/settings", { ladderSkipped: ["protection"] });
    expect(res.json.ladderSkipped).toEqual(["protection"]);
    const l = await ladder(w);
    expect(stepOf(l, "protection").status).toBe("skipped");
    expect(l.next.key).toBe("emergency");
    expect(l.skipped).toEqual(["protection"]);
    expect((await w.api("PATCH", "/api/settings", { ladderSkipped: ["everything"] })).status).toBe(422);
    await w.api("PATCH", "/api/settings", { ladderSkipped: [] });
    expect(stepOf(await ladder(w), "protection").status).toBe("next");
  });
});

describe("the transfer suggestion", () => {
  it("suggests moving what is free beyond a cushion for the days left, into the emergency account", async () => {
    const w = await world();
    await rent(w);
    await reserve(w);
    const s = await suggestion(w);
    // Six months of the rent-only spend is the target; the whole of it is missing from an empty reserve.
    expect(s.gapPaise).toBe(6 * BURN);
    expect(s).toMatchObject({ none: null, daysLeft: 5, until: "2026-11-01", freeToSpendPaise: 1_20_000_00, from: { name: "HDFC Bank", availablePaise: 1_00_000_00 }, to: { name: "Reserve", countsTowardSafeToSpend: false } });
    // ₹30,000 over 26 days of history is the everyday spend; five days of it is kept back.
    expect(s.cushionPaise).toBe(5 * Math.round(30_000_00 / 26));
    expect(s.movablePaise).toBe(Math.min(1_20_000_00 - s.cushionPaise, 1_00_000_00));
    expect(s.amountPaise).toBe(Math.floor(s.movablePaise / 10_000) * 10_000);
    expect(s.remainingPaise).toBe(s.gapPaise - s.amountPaise);
  });

  it("keeps back money committed before the next salary", async () => {
    const w = await world();
    await rent(w);
    await reserve(w);
    const before = await suggestion(w);
    await w.api("POST", "/api/recurring", { type: "expense", title: "Rent", amountPaise: 40_000_00, accountId: w.hdfc.id, categoryId: w.category("Rent"), frequency: "monthly", day: 30 });
    const after = await suggestion(w);
    expect(after.freeToSpendPaise).toBe(before.freeToSpendPaise - 40_000_00);
    expect(after.amountPaise).toBeLessThan(before.amountPaise);
  });

  it("says why there is nothing to move", async () => {
    const w = await world();
    expect((await suggestion(w)).none).toBe("no_target");
    await rent(w);
    expect((await suggestion(w)).none).toBe("no_destination");
    await reserve(w);
    expect((await suggestion(w)).none).toBeNull();
    // A tiny typed target that a flagged account already covers.
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 1_000_00 });
    await w.api("PATCH", `/api/accounts/${w.hdfc.id}`, { isEmergency: true });
    expect((await suggestion(w)).none).toBe("fund_complete");
  });

  it("is quiet for another person", async () => {
    const w = await world();
    const other = await world();
    await rent(w);
    await reserve(w);
    expect((await suggestion(other)).to).toBeNull();
  });
});

describe("the ladder in Telegram", () => {
  it("/fund shows the ladder and offers a record button; pressing it records the transfer once", async () => {
    const w = await world();
    await rent(w);
    const dest = await reserve(w);
    await w.say("/fund");
    const m = w.tg.last;
    expect(m.text).toContain("Where you stand, in a common order (a rule of thumb, not advice):");
    expect(m.text).toContain("1. A starter buffer: done");
    expect(m.text).toContain("Next: Health and life cover.");
    expect(m.text).toContain("You could move ₹");
    expect(m.text).toContain("from HDFC Bank to Reserve today");
    expect(m.text).toContain("Move it at your bank first, then tap Record.");

    const before = (await w.api("GET", "/api/accounts")).json.items.find((a: Json) => a.name === "Reserve").balancePaise;
    const record = m.buttons.flat().find((b) => b.text.startsWith("Record "))!;
    await w.press(record.data, m.id);
    const after = (await w.api("GET", "/api/accounts")).json.items.find((a: Json) => a.id === dest.id).balancePaise;
    expect(after).toBeGreaterThan(before);
    expect(w.tg.last.text).toContain("moved from HDFC Bank to Reserve.");
    expect(w.tg.last.text).toContain("Emergency fund:");

    // Pressing again, or an old button, records nothing more.
    await w.press(record.data, m.id);
    expect((await w.api("GET", "/api/accounts")).json.items.find((a: Json) => a.id === dest.id).balancePaise).toBe(after);
  });

  it("'Not now' records nothing, and a forged button does nothing", async () => {
    const w = await world();
    await rent(w);
    const dest = await reserve(w);
    await w.say("/fund");
    const m = w.tg.last;
    await w.press(m.buttons.flat().find((b) => b.text === "Not now")!.data, m.id);
    expect(w.tg.last.text).toContain("Nothing recorded");
    await w.press("t:zzzzzzzzzz:y", m.id);
    expect((await w.api("GET", "/api/accounts")).json.items.find((a: Json) => a.id === dest.id).balancePaise).toBe(0);
  });

  it("another person cannot press someone else's record button", async () => {
    const w = await world();
    const other = await world();
    await rent(w);
    await reserve(w);
    await w.say("/fund");
    const m = w.tg.last;
    const data = m.buttons.flat().find((b) => b.text.startsWith("Record "))!.data;
    await other.press(data, 1);
    expect(mine(other).some((x) => x.text.includes("moved from"))).toBe(false);
  });

  it("explains itself when there is nothing to move", async () => {
    const w = await world();
    await w.say("/fund");
    expect(w.tg.last.text).toContain("I cannot size your emergency fund yet");
    expect(w.tg.last.buttons.flat()).toEqual([]);
  });

  it("is part of the salary day plan when there is something to move", async () => {
    const w = await world();
    await rent(w);
    await reserve(w);
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 1_00_000_00, txnDate: "2026-10-27", accountId: w.hdfc.id, categoryId: w.category("Salary") });
    await runSalaryPlans({ db, telegram: w.tg, now: () => Date.parse("2026-10-27T05:00:00Z") });
    const plan = mine(w).at(-1)!;
    expect(plan.text).toContain("You could move ₹");
    expect(plan.buttons.flat().some((b) => b.text.startsWith("Record "))).toBe(true);
  });

  it("adds the next step to the monthly review", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 1_00_000_00, txnDate: "2026-09-05", accountId: w.hdfc.id, categoryId: w.category("Salary") });
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 20_000_00, txnDate: "2026-09-07", accountId: w.sbi.id, categoryId: w.category("Rent") });
    await runMonthlyReview({ db, telegram: w.tg, now: () => Date.parse("2026-10-01T05:00:00Z") });
    expect(mine(w).at(-1)!.text).toContain("Next step: Health and life cover.");
  });
});
