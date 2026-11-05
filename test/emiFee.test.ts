import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST). The card's statement is on the 23rd, due on the 12th of the next month.
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 10_00_000_00 });
  const card = (await api("POST", "/api/accounts", { kind: "card", name: "Millennia", creditLimitPaise: 2_00_000_00, statementDay: 23, dueDay: 12 })).json;
  const plan = (extra: object = {}) => api("POST", "/api/emi-plans", { cardAccountId: card.id, title: "Phone", totalPaise: 1_22_000_00, months: 6, startMonth: "2026-10", ...extra });
  const onCard = async () => (await api("GET", `/api/transactions?accountId=${card.id}&limit=100`)).json.items as Json[];
  const emiEntries = async () => (await onCard()).filter((t) => t.source === "emi");
  const cardFigures = async () => ((await api("GET", "/api/accounts")).json.items as Json[]).find((a) => a.id === card.id)!;
  return { api, card, plan, onCard, emiEntries, cardFigures };
}

describe("the processing fee", () => {
  it("is its own expense on the card, filed under Fees & Charges, and never part of the instalments", async () => {
    const s = await setup();
    const res = await s.plan({ feePaise: 352_82, feeDate: "2026-10-22" });
    expect(res.status).toBe(201);
    expect(res.json.totalPaise).toBe(1_22_000_00);
    const all = await s.onCard();
    const fee = all.find((t) => t.merchant === "Phone EMI processing fee")!;
    expect(fee).toMatchObject({ type: "expense", amountPaise: 352_82, txnDate: "2026-10-22", accountId: s.card.id, source: "web", status: "confirmed" });
    const cats = (await s.api("GET", "/api/categories")).json.items as Json[];
    expect(fee.categoryId).toBe(cats.find((c) => c.name === "Fees & Charges")!.id);
    expect(all.filter((t) => t.source === "emi")).toHaveLength(1);
    // The card owes the instalment and the fee; the fee is not in what is still to come.
    expect((await s.cardFigures()).outstandingPaise).toBe(20_333_33 + 352_82);
    expect(res.json.toComePaise).toBe(1_22_000_00 - 20_333_33);
  });

  it("defaults to today, and adds nothing when there is no fee", async () => {
    const s = await setup();
    expect((await s.plan({ feePaise: 100_00 })).status).toBe(201);
    const fees = (await s.onCard()).filter((t) => t.merchant === "Phone EMI processing fee");
    expect(fees).toHaveLength(1);
    expect(fees[0]!.txnDate).toBe("2026-10-27");

    const none = await setup();
    await none.plan();
    expect((await none.onCard()).some((t) => t.merchant === "Phone EMI processing fee")).toBe(false);
  });

  it("refuses a future date, and then adds no plan either", async () => {
    const s = await setup();
    expect((await s.plan({ feePaise: 100_00, feeDate: "2026-10-28" })).status).toBe(422);
    expect((await s.api("GET", "/api/emi-plans")).json.items).toHaveLength(0);
  });
});

describe("correcting one instalment", () => {
  it("changes a billed month: the entry, the schedule, the total and the card follow", async () => {
    const s = await setup();
    const p = (await s.plan()).json;
    const res = await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/1`, { amountPaise: 20_082_00 });
    expect(res.status).toBe(200);
    expect(res.json.uneven).toBe(true);
    const schedule = res.json.scheduleAmountsPaise as number[];
    expect(schedule[0]).toBe(20_082_00);
    expect(res.json.totalPaise).toBe(schedule.reduce((a, b) => a + b, 0));
    expect(res.json.billedPaise).toBe(20_082_00);
    expect((await s.emiEntries())[0]).toMatchObject({ amountPaise: 20_082_00 });
    expect((await s.cardFigures()).outstandingPaise).toBe(20_082_00);
  });

  it("changes a month still to come and leaves the entries alone", async () => {
    const s = await setup();
    const p = (await s.plan()).json;
    const res = await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/4`, { amountPaise: 21_000_00 });
    expect(res.json.scheduleAmountsPaise[3]).toBe(21_000_00);
    expect(res.json.toComePaise).toBe(p.toComePaise + (21_000_00 - p.scheduleAmountsPaise[3]));
    expect(await s.emiEntries()).toHaveLength(1);
    expect((await s.emiEntries())[0]!.amountPaise).toBe(p.scheduleAmountsPaise[0]);
  });

  it("refuses a bad month or amount, extra fields, another person's plan, and a closed plan", async () => {
    const s = await setup();
    const p = (await s.plan()).json;
    expect((await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/7`, { amountPaise: 100 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/0`, { amountPaise: 100 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/2`, { amountPaise: 0 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/2`, { amountPaise: 100, extra: 1 })).status).toBe(422);
    const other = await setup();
    expect((await other.api("PATCH", `/api/emi-plans/${p.id}/instalments/2`, { amountPaise: 100 })).status).toBe(404);
    await s.api("POST", `/api/emi-plans/${p.id}/cancel`);
    expect((await s.api("PATCH", `/api/emi-plans/${p.id}/instalments/2`, { amountPaise: 100 })).status).toBe(409);
  });
});
