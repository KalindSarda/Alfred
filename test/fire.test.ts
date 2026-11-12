import { describe, expect, it } from "vitest";
import { runMonthlyReview } from "../src/services/reviewJob";
import { world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27. HDFC holds ₹1,00,000 and SBI ₹50,000. A ₹30,000 rent paid from SBI on 2 Oct leaves ₹1,20,000 in banks
// and, over 26 days of history, a monthly spend of ₹34,615.38 (3,461,538 paise).
const get = async (w: W) => (await w.api("GET", "/api/fire")).json as Json;
const put = (w: W, body: object) => w.api("PUT", "/api/fire", body);
const rent = (w: W) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 30_000_00, txnDate: "2026-10-02", accountId: w.sbi.id, categoryId: w.category("Rent") });
const fund = async (w: W, name: string, valuePaise: number, kind = "fund") => (await w.api("POST", "/api/holdings", { name, kind, valuePaise })).json as Json;
const flat = { ageNow: 30, targetAge: 40, monthlySpendPaise: 10_000_00, withdrawalRateBp: 400, returnBp: 0, inflationBp: 0, monthlySavingPaise: 50_000_00, stepupBp: 0 };

describe("the FIRE plan", () => {
  it("starts with nothing to project until there is a spend, typed or from history", async () => {
    const w = await world();
    const v = await get(w);
    expect(v).toMatchObject({ numberPaise: null, projection: null, sensitivity: [] });
    expect(v.assumptions).toMatchObject({ ageNow: null, monthlySpendPaise: null, withdrawalRateBp: 350, inflationBp: 600, returnBp: 1000, stepupBp: 0 });
  });

  it("falls back to the recent average spend, saying so", async () => {
    const w = await world();
    await rent(w);
    const v = await get(w);
    expect(v.assumptions).toMatchObject({ monthlySpendPaise: 3_461_538, spendIsDefault: true, monthlySavingPaise: 0, savingIsDefault: true });
    expect(v).toMatchObject({ early: true, numberPaise: Math.round((3_461_538 * 12 * 10_000) / 350) });
    await put(w, { monthlySpendPaise: 50_000_00 });
    expect((await get(w)).assumptions).toMatchObject({ monthlySpendPaise: 50_000_00, spendIsDefault: false });
  });

  it("works out the number, the progress and the date from typed assumptions", async () => {
    const w = await world();
    await rent(w);
    expect((await put(w, flat)).status).toBe(200);
    const v = await get(w);
    // ₹10,000 a month at 4% needs ₹30,00,000; ₹1,20,000 is in the banks; ₹50,000 more a month closes ₹28,80,000 in 58 months.
    expect(v).toMatchObject({ numberPaise: 30_00_000_00, progressPct: 4, corpus: { totalPaise: 1_20_000_00, bankPaise: 1_20_000_00, holdingsPaise: 0, emergencyNotMarked: true } });
    expect(v.projection).toEqual({ months: 58, years: 4.8, year: 2031, age: 34, reached: false });
    // The target age is ten years away, which this beats.
    expect(v.requiredSavingPaise).toBeLessThan(50_000_00);
    expect(v.coastPaise).toBe(30_00_000_00);
    expect(v.coastReached).toBe(false);
    expect(v.sensitivity.map((s: Json) => s.key)).toEqual(["saving", "spend", "return"]);
  });

  it("counts investments that are switched on, and leaves out ones switched off or in the emergency fund", async () => {
    const w = await world();
    await rent(w);
    await put(w, flat);
    const a = await fund(w, "Index fund", 2_00_000_00);
    const b = await fund(w, "Liquid fund", 1_00_000_00);
    const gold = await fund(w, "Gold coins", 50_000_00, "gold");
    expect((await get(w)).corpus).toMatchObject({ holdingsPaise: 3_50_000_00, totalPaise: 4_70_000_00 });

    await w.api("PATCH", `/api/holdings/${a.id}`, { countsForFire: false });
    await w.api("PATCH", `/api/holdings/${b.id}`, { isEmergency: true });
    const v = await get(w);
    expect(v.corpus.holdingsPaise).toBe(50_000_00);
    expect(v.corpus.holdings.find((h: Json) => h.id === a.id)).toMatchObject({ counts: false });
    expect(v.corpus.holdings.find((h: Json) => h.id === b.id)).toMatchObject({ inEmergencyFund: true });
    expect(v.corpus.holdings.find((h: Json) => h.id === gold.id)).toMatchObject({ counts: true, paise: 50_000_00 });
  });

  it("leaves bank money in the emergency fund out of the corpus", async () => {
    const w = await world();
    await put(w, flat);
    await w.api("PATCH", `/api/accounts/${w.hdfc.id}`, { isEmergency: true });
    expect((await get(w)).corpus).toMatchObject({ bankPaise: 50_000_00, emergencyNotMarked: false });
  });

  it("counts retirement money (EPF, PPF, NPS) once typed in", async () => {
    const w = await world();
    await put(w, flat);
    const epf = await w.api("POST", "/api/holdings", { name: "EPF", kind: "retirement", valuePaise: 8_00_000_00 });
    expect(epf.status).toBe(201);
    expect(epf.json.kindName).toBe("Retirement (EPF, PPF, NPS)");
    expect((await get(w)).corpus.holdingsPaise).toBe(8_00_000_00);
  });

  it("reports already reached when the corpus covers the number", async () => {
    const w = await world();
    await put(w, { ...flat, monthlySpendPaise: 300_00 });
    expect((await get(w)).projection).toMatchObject({ months: 0, reached: true });
  });

  it("rejects what makes no sense, and keeps one person's plan apart from another's", async () => {
    const w = await world();
    const other = await world();
    expect((await put(w, { withdrawalRateBp: 50 })).status).toBe(422);
    expect((await put(w, { targetAge: 50 })).status).toBe(422);
    expect((await put(w, { ageNow: 40, targetAge: 40 })).status).toBe(422);
    expect((await put(w, { returnBp: 5000 })).status).toBe(422);
    await put(w, flat);
    expect((await get(other)).assumptions.ageNow).toBeNull();
    // A partial update keeps the rest.
    await put(w, { returnBp: 800 });
    expect((await get(w)).assumptions).toMatchObject({ ageNow: 30, returnBp: 800, monthlySpendPaise: 10_000_00 });
  });
});

describe("the FIRE plan in the monthly review", () => {
  it("adds a line, using the recent spend until one is typed", async () => {
    const w = await world();
    const send = async () => {
      await runMonthlyReview({ db, telegram: w.tg, now: () => Date.parse("2026-10-01T05:00:00Z") });
      return w.tg.messages.filter((m) => m.chatId === String(w.chat)).at(-1)?.text ?? "";
    };
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 1_00_000_00, txnDate: "2026-09-05", accountId: w.hdfc.id, categoryId: w.category("Salary") });
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 20_000_00, txnDate: "2026-09-07", accountId: w.sbi.id, categoryId: w.category("Rent") });
    expect(await send()).toContain("Financial independence: ");
    await put(w, { ...flat, ageNow: 30 });
    await w.say("/review");
    expect(w.tg.last.text).toMatch(/Financial independence: ₹[\d,.]+ of ₹30,00,000 \(\d+(\.\d)?%\)\. At the current saving and assumptions, around \d{4}, at about \d+\. An estimate, not a promise\./);
  });
});
