import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

describe("/accounts", () => {
  it("lists accounts and cards with an Archive button for each", async () => {
    const w = await world();
    await w.say("/accounts");
    const m = w.tg.last;
    expect(m.text).toContain("Bank accounts");
    expect(m.text).toContain("HDFC Bank: ₹1,00,000");
    expect(m.text).toContain("Credit cards");
    expect(m.text).toContain("OneCard: owes ₹0");
    expect(buttonNames(m)).toEqual(["Archive HDFC Bank", "Archive SBI", "Archive HDFC Millennia", "Archive OneCard"]);
    expect(m.text).toContain("in the app");
  });

  it("archives an account when its button is tapped, and offers to restore it", async () => {
    const w = await world();
    await w.say("/accounts");
    const m = w.tg.last;
    await w.press(w.button(m, "Archive SBI"), m.id);
    expect(m.text).toContain("Archived SBI.");
    expect(buttonNames(m)).not.toContain("Archive SBI");
    expect(buttonNames(m)).toContain("Restore SBI");
    const items = (await w.api("GET", "/api/accounts")).json.items as Record<string, any>[];
    expect(items.some((a) => a.name === "SBI")).toBe(false);
  });

  it("restores an archived account", async () => {
    const w = await world();
    await w.say("/accounts");
    const m = w.tg.last;
    await w.press(w.button(m, "Archive SBI"), m.id);
    await w.press(w.button(m, "Restore SBI"), m.id);
    expect(m.text).toContain("Restored SBI.");
    expect(buttonNames(m)).toContain("Archive SBI");
    const items = (await w.api("GET", "/api/accounts")).json.items as Record<string, any>[];
    expect(items.some((a) => a.name === "SBI")).toBe(true);
  });

  it("will not archive a card that still owes money, and says why", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 500_00, txnDate: "2026-10-05", accountId: w.onecard.id });
    await w.say("/accounts");
    const m = w.tg.last;
    await w.press(w.button(m, "Archive OneCard"), m.id);
    expect(m.text).toContain("I could not archive OneCard.");
    expect(m.text).toContain("outstanding balance");
    expect(buttonNames(m)).toContain("Archive OneCard");
  });

  it("an archived account no longer takes entries from the bot", async () => {
    const w = await world();
    await w.say("/accounts");
    const m = w.tg.last;
    await w.press(w.button(m, "Archive SBI"), m.id);
    await w.say("/add 100 food using sbi");
    expect(w.tg.last.text).not.toContain("from SBI");
  });

  it("ignores a button for an account that no longer exists", async () => {
    const w = await world();
    await w.say("/accounts");
    const m = w.tg.last;
    const sbi = w.sbi.id as string;
    await w.api("DELETE", `/api/accounts/${sbi}`);
    await w.press(`a:${sbi}:x`, m.id);
    expect(m.text).toContain("already been removed");
  });

  it("will not archive another user's account through a forged button", async () => {
    const w = await world();
    const other = await world();
    await w.say("/accounts");
    const m = w.tg.last;
    await w.press(`a:${other.sbi.id}:x`, m.id);
    const items = (await other.api("GET", "/api/accounts")).json.items as Record<string, any>[];
    expect(items.some((a) => a.name === "SBI")).toBe(true);
  });

  it("says so when there are no accounts", async () => {
    const w = await world();
    for (const a of [w.hdfc, w.sbi, w.millennia, w.onecard]) await w.api("DELETE", `/api/accounts/${a.id}`);
    await w.say("/accounts");
    expect(w.tg.last.text).toContain("no accounts");
  });
});
