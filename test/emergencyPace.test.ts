import { describe, expect, it } from "vitest";
import { runMonthlyReview } from "../src/services/reviewJob";
import { world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27. HDFC holds ₹1,00,000 and SBI ₹50,000. A ₹30,000 rent paid from SBI on 2 Oct is 26 days of
// history, so the monthly burn is ₹34,615.38 (3,461,538 paise) and six months of it is 20,769,228 paise.
const BURN = 3_461_538;
const view = async (w: W) => (await w.api("GET", "/api/emergency-fund")).json as Json;
const rent = (w: W) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 30_000_00, txnDate: "2026-10-02", accountId: w.sbi.id, categoryId: w.category("Rent") });
const flag = (w: W, account: Json, isEmergency = true) => w.api("PATCH", `/api/accounts/${account.id}`, { isEmergency });
const food = (w: W) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 10_000_00, txnDate: "2026-10-03", accountId: w.sbi.id, categoryId: w.category("Food & Dining") });
const at = (w: W, type: string, amountPaise: number, txnDate: string, category: string | null) =>
  w.api("POST", "/api/transactions", { type, amountPaise, txnDate, accountId: w.hdfc.id, ...(category && { categoryId: w.category(category) }) });

// July, August and September are three complete months: ₹1,00,000 comes in each, with ₹60,000, ₹70,000 and ₹50,000 spent,
// and ₹10,000 invested in September.
async function history(w: W) {
  for (const [month, foodPaise] of [["07", 35_000_00], ["08", 45_000_00], ["09", 25_000_00]] as const) {
    await at(w, "income", 1_00_000_00, `2026-${month}-01`, "Salary");
    await at(w, "expense", 25_000_00, `2026-${month}-02`, "Rent");
    await at(w, "expense", foodPaise, `2026-${month}-10`, "Food & Dining");
  }
  await at(w, "investment", 10_000_00, "2026-09-11", null);
}

describe("both targets, the medical layer and settings", () => {
  it("judges the fund against everything spent and against essentials only, at once", async () => {
    const w = await world();
    await rent(w);
    await food(w);
    await flag(w, w.hdfc);
    // ₹40,000 spent in 26 days is ₹46,153.85 a month; the rent alone is ₹34,615.38.
    const v = await view(w);
    expect(v).toMatchObject({ essentialsBurnPaise: BURN, lifestyleBurnPaise: 4_615_385, burnPaise: 4_615_385, targetPaise: 6 * 4_615_385 });
    expect(v.targets.lifestyle).toMatchObject({ totalPaise: 6 * 4_615_385, fundedPaise: 1_00_000_00 });
    expect(v.targets.essentials).toMatchObject({ totalPaise: 6 * BURN, fundedPaise: 1_00_000_00 });
    expect(v.targets.essentials.pct).toBeGreaterThan(v.targets.lifestyle.pct);
    expect(v.verdict).toBe("building");
  });

  it("puts the medical reserve on top of both, filled after the living costs", async () => {
    const w = await world();
    await rent(w);
    await flag(w, w.hdfc);
    await w.api("PATCH", "/api/settings", { medicalTargetPaise: 4_00_000_00 });
    const v = await view(w);
    expect(v.targetPaise).toBe(6 * BURN + 4_00_000_00);
    expect(v.targets.essentials.totalPaise).toBe(6 * BURN + 4_00_000_00);
    expect(v.living).toMatchObject({ targetPaise: 6 * BURN, fundedPaise: 1_00_000_00 });
    expect(v.medical).toMatchObject({ targetPaise: 4_00_000_00, fundedPaise: 0, gapPaise: 4_00_000_00 });
    // A typed target for living costs leaves the money beyond it for the medical layer.
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 50_000_00 });
    const typed = await view(w);
    expect(typed.medical).toMatchObject({ fundedPaise: 50_000_00 });
    // It replaces the lifestyle living costs only; essentials stays measured against spending.
    expect(typed.targets.lifestyle.livingPaise).toBe(50_000_00);
    expect(typed.targets.essentials.livingPaise).toBe(6 * BURN);
  });

  it("validates the settings, and the old basis switch is gone", async () => {
    const w = await world();
    expect((await w.api("PATCH", "/api/settings", { emergencyBasis: "essentials" })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { medicalTargetPaise: 0 })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { medicalTargetPaise: null })).status).toBe(200);
  });
});

describe("the pace of closing the gap", () => {
  it("works out what is left in a typical and in a lean month, after what is already invested", async () => {
    const w = await world();
    await history(w);
    const v = await view(w);
    // Left over: ₹40,000 in July, ₹30,000 in August and, in September after ₹10,000 of investing, ₹40,000.
    expect(v.pace).toMatchObject({ cycles: 3, early: false, cautiousPaise: 30_000_00 });
    expect(v.pace.typicalPaise).toBe(Math.round(110_000_00 / 3));
    expect(v.pace.investingPaise).toBe(Math.round(10_000_00 / 3));
  });

  it("says how long each gap takes at that pace", async () => {
    const w = await world();
    await history(w);
    await flag(w, w.hdfc);
    await w.api("PATCH", "/api/settings", { medicalTargetPaise: 4_00_000_00 });
    const v = await view(w);
    const life = v.targets.lifestyle;
    const ess = v.targets.essentials;
    expect(life.monthsAtTypical).toBe(Math.ceil(life.gapPaise / v.pace.typicalPaise));
    expect(life.monthsAtCautious).toBe(Math.ceil(life.gapPaise / v.pace.cautiousPaise));
    expect(life.monthsAtCautious).toBeGreaterThanOrEqual(life.monthsAtTypical);
    expect(ess.gapPaise).toBeLessThan(life.gapPaise);
    expect(ess.monthsAtTypical).toBeLessThanOrEqual(life.monthsAtTypical);
    expect(v.verdict).toBe("building");
  });

  it("reports that essentials are covered when only the lifestyle gap is left", async () => {
    const w = await world();
    await history(w);
    await flag(w, w.hdfc);
    const v = await view(w);
    expect(v.targets.essentials.gapPaise).toBe(0);
    expect(v.targets.lifestyle.gapPaise).toBeGreaterThan(0);
    expect(v.verdict).toBe("essentials");
    expect(v.monthsOnEssentials).toBeGreaterThan(6);
  });

  it("uses the recent weeks, as an estimate, while no month is complete yet", async () => {
    const w = await world();
    await rent(w);
    const v = await view(w);
    expect(v.pace).toMatchObject({ cycles: 0, early: true });
    // Nothing came in, so nothing is left over and no time can be given.
    expect(v.pace.typicalPaise).toBeLessThan(0);
    expect(v.targets.lifestyle.monthsAtTypical).toBeNull();
  });

  it("has no pace with no history at all, and keeps each person apart", async () => {
    const w = await world();
    const other = await world();
    expect((await view(w)).pace).toBeNull();
    await history(w);
    expect((await view(other)).pace).toBeNull();
  });
});

describe("the emergency fund in Telegram", () => {
  it("is in /balance, flagged or not", async () => {
    const w = await world();
    await rent(w);
    await w.say("/balance");
    expect(w.tg.last.text).toContain("Emergency fund: nothing is marked as one yet. Your bank money alone would cover about 3.4 months of your spending");
    await flag(w, w.hdfc);
    await w.say("/balance");
    expect(w.tg.last.text).toContain("Emergency fund: ₹1,00,000, which is 48.1% of your lifestyle goal (₹2,07,692.28) and 48.1% of essentials only (₹2,07,692.28)");
    expect(w.tg.last.text).toContain("That covers about 2.8 months of essentials alone.");
    expect(w.tg.last.text).toContain("Recent months leave nothing over after spending and investing, so I cannot give a time.");
  });

  it("gives the pace once there is history", async () => {
    const w = await world();
    await history(w);
    await flag(w, w.hdfc);
    await w.api("PATCH", "/api/settings", { medicalTargetPaise: 4_00_000_00 });
    await w.say("/balance");
    const text = w.tg.last.text;
    expect(text).toContain("of your lifestyle goal");
    expect(text).toContain("At your usual surplus of ₹36,666.67 a month, after what you already invest, about ");
    expect(text).toContain("months to the full goal");
  });

  it("is in the monthly review", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 1_00_000_00, txnDate: "2026-09-05", accountId: w.hdfc.id, categoryId: w.category("Salary") });
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 20_000_00, txnDate: "2026-09-07", accountId: w.sbi.id, categoryId: w.category("Rent") });
    await flag(w, w.hdfc);
    await runMonthlyReview({ db, telegram: w.tg, now: () => Date.parse("2026-10-01T05:00:00Z") });
    const sent = w.tg.messages.filter((m) => m.chatId === String(w.chat)).at(-1)!.text;
    expect(sent).toContain("Emergency fund: ₹2,00,000, which is 100% of your lifestyle goal");
    expect(sent).toContain("Both are covered: your full lifestyle and essentials.");
  });
});
