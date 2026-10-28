import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

const setBudget = (w: Awaited<ReturnType<typeof world>>, name: string, limitPaise: number) =>
  w.api("PUT", `/api/budgets/${w.category(name)}`, { limitPaise });

describe("/budget", () => {
  it("says so when there are no budgets, and points to the app", async () => {
    const w = await world();
    await w.say("/budget");
    expect(w.tg.last.text).toBe("You have not set any budgets yet. You can add them in the app, under Budgets.");
  });

  it("lists each budget with what is left, and a total", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 6_000_00);
    await setBudget(w, "Fuel", 2_000_00);
    await w.say("/add 2750 food swiggy using sbi");
    await w.say("/budget");
    const text = w.tg.last.text;
    expect(text).toContain("Your budgets for 1 Oct to 31 Oct:");
    expect(text).toContain("Food & Dining: ₹2,750 of ₹6,000 (45.8%), ₹3,250 remaining");
    expect(text).toContain("Fuel: ₹0 of ₹2,000 (0%), ₹2,000 remaining");
    expect(text).toContain("In total: ₹2,750 of ₹8,000.");
  });

  it("marks a budget that is close to its limit, and one that is over", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 1_000_00);
    await setBudget(w, "Fuel", 1_000_00);
    await w.say("/add 850 food swiggy using sbi");
    await w.say("/add 1200 fuel using sbi");
    await w.say("/budget");
    expect(w.tg.last.text).toContain("Fuel: ₹1,200 of ₹1,000 (120%), ₹200 over");
    expect(w.tg.last.text).toContain("Food & Dining: ₹850 of ₹1,000 (85%), ₹150 remaining, close to the limit");
  });

  it("also answers to /budgets", async () => {
    const w = await world();
    await w.say("/budgets");
    expect(w.tg.last.text).toContain("not set any budgets");
  });
});

describe("the note after logging a spend", () => {
  it("says what remains in a budgeted category", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 6_000_00);
    await w.say("/add 2750 food swiggy using sbi");
    expect(w.tg.last.text).toBe("Noted. ₹2,750 at Swiggy, under Food & Dining, from SBI. Your Food & Dining budget has ₹3,250 remaining.");
  });

  it("warns plainly when a spend brings a budget close to its limit", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 1_000_00);
    await w.say("/add 850 food swiggy using sbi");
    expect(w.tg.last.text).toContain("Your Food & Dining budget has ₹150 remaining, which is close to the limit.");
  });

  it("says when a spend goes over, without scolding", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 1_000_00);
    await w.say("/add 1200 food swiggy using sbi");
    expect(w.tg.last.text).toContain("That puts Food & Dining ₹200 over its budget.");
    expect(w.tg.last.text).not.toMatch(/overspen|careful|should|too much|!/i);
  });

  it("says nothing about budgets for categories without one, or for income and transfers", async () => {
    const w = await world();
    await setBudget(w, "Fuel", 1_000_00);
    await w.say("/add 450 food swiggy using sbi");
    expect(w.tg.last.text).not.toContain("budget");
    await w.say("/income 5000 salary sbi");
    expect(w.tg.last.text).not.toContain("budget");
    await w.say("/transfer 100 hdfc sbi");
    expect(w.tg.last.text).not.toContain("budget");
  });

  it("includes the note when a text entry is confirmed with a tap", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 6_000_00);
    await w.say("450 swiggy using sbi");
    const confirm = w.tg.last;
    await w.press(w.button(confirm, "Record it"), confirm.id);
    expect(confirm.text).toContain("budget has ₹5,550 remaining");
  });

  it("an entry that is later undone no longer counts against the budget", async () => {
    const w = await world();
    await setBudget(w, "Food & Dining", 6_000_00);
    await w.say("/add 2750 food swiggy using sbi");
    const receipt = w.tg.last;
    await w.press(w.button(receipt, "Undo"), receipt.id);
    await w.say("/budget");
    expect(w.tg.last.text).toContain("Food & Dining: ₹0 of ₹6,000");
  });

  it("only offers /budget in the menu list and in /help", async () => {
    const w = await world();
    await w.say("/help");
    expect(w.tg.last.text).toContain("/budget");
    expect(buttonNames(w.tg.last)).toEqual([]);
  });
});
