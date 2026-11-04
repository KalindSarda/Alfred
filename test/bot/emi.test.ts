import { describe, expect, it } from "vitest";
import { world } from "./harness";

// The test clock is 2026-10-27. The Millennia statement is on the 23rd, due on the 12th of the next month.
const plan = (w: Awaited<ReturnType<typeof world>>, extra: object = {}) =>
  w.api("POST", "/api/emi-plans", { cardAccountId: w.millennia.id, title: "Phone", totalPaise: 1_22_000_00, months: 6, startMonth: "2026-10", categoryId: w.category("Shopping"), ...extra });

describe("/emi", () => {
  it("says so when no plan is running", async () => {
    const w = await world();
    await w.say("/emi");
    expect(w.tg.last.text).toBe("You have no EMI plans running. You can add one in the app, under Accounts and cards, then Commitments.");
  });

  it("lists running plans with progress, the next instalment and the total still to come", async () => {
    const w = await world();
    await plan(w);
    await w.say("/emi");
    const text = w.tg.last.text;
    expect(text).toContain("Your EMI plans:");
    expect(text).toContain("Phone (HDFC Millennia): 1 of 6 billed, ₹1,01,666.67 still to come, next ₹20,333.33 on 23 Nov");
    expect(text).toContain("In total ₹1,01,666.67 is still to be billed.");
  });

  it("does not list a closed plan", async () => {
    const w = await world();
    const p = (await plan(w)).json;
    await w.api("POST", `/api/emi-plans/${p.id}/cancel`);
    await w.say("/emi");
    expect(w.tg.last.text).toContain("no EMI plans running");
  });

  it("/balance shows the EMI on the card and as a total, and explains who counts it", async () => {
    const w = await world();
    await plan(w);
    await w.say("/balance");
    const text = w.tg.last.text;
    expect(text).toContain("HDFC Millennia: owes ₹20,333.33, due 12 Nov, ₹1,01,666.67 in EMIs to come");
    expect(text).toContain("EMIs still to be billed: ₹1,01,666.67. Net worth counts them; safe to spend does not");
  });

  it("a plan does not change what /balance calls safe to spend beyond the billed instalment", async () => {
    const w = await world();
    await plan(w);
    await w.say("/balance");
    expect(w.tg.last.text).toContain("Safe to spend: ₹1,29,666.67, as recorded.");
  });
});
