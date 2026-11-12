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
const holding = async (w: W, name: string, valuePaise: number) => (await w.api("POST", "/api/holdings", { name, kind: "fund", valuePaise })).json as Json;

describe("the emergency fund", () => {
  it("is sized from essential spending, and funded by the accounts you flag", async () => {
    const w = await world();
    await rent(w);
    expect((await flag(w, w.hdfc)).status).toBe(200);
    const v = await view(w);
    expect(v).toMatchObject({ months: 6, burnPaise: BURN, targetPaise: 6 * BURN, targetBasis: "burn", fundedPaise: 1_00_000_00, bankPaise: 1_00_000_00, nothingFlagged: false, early: true, fundedMonths: 2.8 });
    expect(v.gapPaise).toBe(6 * BURN - 1_00_000_00);
    expect(v.topUpPaise).toBe(Math.ceil((6 * BURN - 1_00_000_00) / 12));
    expect(v.accounts).toEqual([{ id: w.hdfc.id, name: "HDFC Bank", paise: 1_00_000_00 }]);
  });

  it("counts flagged investments at their worth, and not closed ones", async () => {
    const w = await world();
    await rent(w);
    await flag(w, w.hdfc);
    const liquid = await holding(w, "Liquid fund", 50_000_00);
    await w.api("PATCH", `/api/holdings/${liquid.id}`, { isEmergency: true });
    expect((await view(w))).toMatchObject({ holdingsPaise: 50_000_00, fundedPaise: 1_50_000_00 });
    expect((await view(w)).holdings).toEqual([{ id: liquid.id, name: "Liquid fund", paise: 50_000_00 }]);

    await w.api("POST", `/api/holdings/${liquid.id}/close`);
    expect(await view(w)).toMatchObject({ holdingsPaise: 0, fundedPaise: 1_00_000_00 });
  });

  it("does not count an unflagged holding or account, and says what the banks alone would cover", async () => {
    const w = await world();
    await rent(w);
    await holding(w, "Index fund", 2_00_000_00);
    const v = await view(w);
    expect(v).toMatchObject({ nothingFlagged: true, fundedPaise: 0, holdingsPaise: 0, liquidPaise: 1_20_000_00 });
    // ₹1,20,000 of bank money at ₹34,615.38 a month.
    expect(v.liquidMonths).toBe(3.4);
  });

  it("uses a typed target instead, and clearing it goes back to the months", async () => {
    const w = await world();
    await rent(w);
    await flag(w, w.hdfc);
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 3_00_000_00 });
    expect(await view(w)).toMatchObject({ targetPaise: 3_00_000_00, targetBasis: "manual", gapPaise: 2_00_000_00 });
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: null, emergencyMonths: 3, emergencyHorizonMonths: 6 });
    const v = await view(w);
    expect(v).toMatchObject({ months: 3, targetPaise: 3 * BURN, targetBasis: "burn", horizonMonths: 6 });
    expect(v.topUpPaise).toBe(Math.ceil((3 * BURN - 1_00_000_00) / 6));
  });

  it("has no target without history, until one is typed", async () => {
    const w = await world();
    await flag(w, w.hdfc);
    expect(await view(w)).toMatchObject({ essentialsBurnPaise: null, targetPaise: null, targetBasis: null, gapPaise: null, fundedPaise: 1_00_000_00 });
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 2_00_000_00 });
    expect(await view(w)).toMatchObject({ targetPaise: 2_00_000_00, gapPaise: 1_00_000_00 });
  });

  it("takes blocked money off a flagged account", async () => {
    const w = await world();
    await flag(w, w.hdfc);
    const held = await w.api("POST", "/api/holds", { accountId: w.hdfc.id, amountPaise: 10_000_00, title: "IPO" });
    expect(held.status).toBe(201);
    expect((await view(w)).fundedPaise).toBe(90_000_00);
  });

  it("leaves safe-to-spend alone, and refuses a card", async () => {
    const w = await world();
    const before = (await w.api("GET", "/api/accounts")).json.overview;
    await flag(w, w.hdfc);
    expect((await w.api("GET", "/api/accounts")).json.overview).toEqual(before);
    expect((await flag(w, w.millennia)).status).toBe(422);
  });

  it("validates the settings, and keeps one person's fund apart from another's", async () => {
    const w = await world();
    const other = await world();
    expect((await w.api("PATCH", "/api/settings", { emergencyMonths: 0 })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { emergencyMonths: 25 })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { emergencyHorizonMonths: 0 })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 0 })).status).toBe(422);
    await flag(w, w.hdfc);
    expect((await view(other)).nothingFlagged).toBe(true);
  });
});

describe("the living and medical layers", () => {
  const food = (w: W) => w.api("POST", "/api/transactions", { type: "expense", amountPaise: 10_000_00, txnDate: "2026-10-03", accountId: w.sbi.id, categoryId: w.category("Food & Dining") });

  it("measures on everything spent by default, or on essentials only, and shows both", async () => {
    const w = await world();
    await rent(w);
    await food(w);
    await flag(w, w.hdfc);
    // ₹40,000 spent in 26 days is ₹46,153.85 a month; the rent alone is ₹34,615.38.
    const v = await view(w);
    expect(v).toMatchObject({ basis: "lifestyle", essentialsBurnPaise: BURN, lifestyleBurnPaise: 4_615_385, burnPaise: 4_615_385, targetPaise: 6 * 4_615_385, essentialsTargetPaise: 6 * BURN, lifestyleTargetPaise: 6 * 4_615_385 });
    await w.api("PATCH", "/api/settings", { emergencyBasis: "essentials" });
    expect(await view(w)).toMatchObject({ basis: "essentials", burnPaise: BURN, targetPaise: 6 * BURN });
  });

  it("puts the medical reserve on top of the living costs and fills it second", async () => {
    const w = await world();
    await rent(w);
    await flag(w, w.hdfc);
    await w.api("PATCH", "/api/settings", { emergencyBasis: "essentials", medicalTargetPaise: 4_00_000_00 });
    const v = await view(w);
    expect(v.targetPaise).toBe(6 * BURN + 4_00_000_00);
    expect(v.living).toMatchObject({ targetPaise: 6 * BURN, fundedPaise: 1_00_000_00 });
    expect(v.medical).toMatchObject({ targetPaise: 4_00_000_00, fundedPaise: 0, gapPaise: 4_00_000_00 });
    // Money beyond the living costs goes into the medical layer.
    await w.api("PATCH", "/api/settings", { emergencyTargetPaise: 50_000_00 });
    expect((await view(w)).medical).toMatchObject({ fundedPaise: 50_000_00 });
  });

  it("validates the new settings", async () => {
    const w = await world();
    expect((await w.api("PATCH", "/api/settings", { emergencyBasis: "everything" })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { medicalTargetPaise: 0 })).status).toBe(422);
    expect((await w.api("PATCH", "/api/settings", { medicalTargetPaise: null })).status).toBe(200);
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
    expect(w.tg.last.text).toContain("Emergency fund: ₹1,00,000 of ₹2,07,692.28, about 2.8 months of your spending");
    expect(w.tg.last.text).toContain("Still to build:");
  });

  it("is in the monthly review", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 1_00_000_00, txnDate: "2026-09-05", accountId: w.hdfc.id, categoryId: w.category("Salary") });
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 20_000_00, txnDate: "2026-09-07", accountId: w.sbi.id, categoryId: w.category("Rent") });
    await flag(w, w.hdfc);
    await runMonthlyReview({ db, telegram: w.tg, now: () => Date.parse("2026-10-01T05:00:00Z") });
    const sent = w.tg.messages.filter((m) => m.chatId === String(w.chat)).at(-1)!.text;
    expect(sent).toContain("Emergency fund: ₹2,00,000 of ₹1,33,333.32");
  });
});
