import { describe, expect, it } from "vitest";
import { runMorningPush, runSalaryPlans } from "../src/services/planJob";
import { buttonNames, world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27; the jobs run the morning after. HDFC holds ₹1,00,000 and SBI ₹50,000.
const at = (iso: string) => ({ db, now: () => Date.parse(`${iso}T05:00:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
const plans = (w: W, date = "2026-10-28") => runSalaryPlans({ ...at(date), telegram: w.tg });
const push = (w: W, date = "2026-10-28") => runMorningPush({ ...at(date), telegram: w.tg });
const pay = (w: W, extra: object = {}) => w.api("POST", "/api/transactions", { type: "income", amountPaise: 90_000_00, txnDate: "2026-10-27", accountId: w.hdfc.id, categoryId: w.category("Salary"), ...extra });
const rent = (w: W, extra: object = {}) => w.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: w.hdfc.id, categoryId: w.category("Rent"), frequency: "monthly", day: 29, ...extra });

describe("the salary day plan", () => {
  it("is sent once when a salary arrives: what is still to leave, what is free, and a day's share", async () => {
    const w = await world();
    await pay(w);
    await rent(w);
    await plans(w);
    const text = mine(w).at(-1)!.text;
    expect(text).toBe(
      [
        "Salary of ₹90,000 came in on 27 Oct.",
        "",
        "Still to leave before 1 Nov:",
        "29 Oct: Rent ₹22,000 (HDFC Bank)",
        "",
        "Free to spend until then: ₹2,18,000, which is ₹2,40,000 safe to spend less ₹22,000 of what is coming.",
        "That is about ₹54,500 a day for 4 days.",
        "",
        "I do not know your salary day, so I have planned to your month start. Add your pay as repeating income, under Plan, then Recurring, and I shall plan up to it.",
      ].join("\n"),
    );
    const sent = mine(w).length;
    await plans(w);
    await plans(w, "2026-10-29");
    expect(mine(w)).toHaveLength(sent);
  });

  it("plans up to the next salary when a repeating salary is known", async () => {
    const w = await world();
    await w.api("POST", "/api/recurring", { title: "Salary", type: "income", amountPaise: 90_000_00, accountId: w.hdfc.id, categoryId: w.category("Salary"), frequency: "monthly", day: 1 });
    await pay(w);
    await plans(w);
    const text = mine(w).at(-1)!.text;
    expect(text).toContain("Nothing is due before 1 Nov.");
    expect(text).not.toContain("I do not know your salary day");
  });

  it("does not plan for old salaries, other income, drafts or entries you deleted", async () => {
    const w = await world();
    await pay(w, { txnDate: "2026-10-20" });
    await w.api("POST", "/api/transactions", { type: "income", amountPaise: 5_000_00, txnDate: "2026-10-27", accountId: w.hdfc.id, categoryId: w.category("Interest") });
    await pay(w, { status: "draft" });
    const gone = (await pay(w, { amountPaise: 1_000_00 })).json;
    await w.api("DELETE", `/api/transactions/${gone.id}`);
    await plans(w);
    expect(mine(w)).toHaveLength(0);
  });

  it("offers to set money aside for a goal that wants it, and the button does so", async () => {
    const w = await world();
    await pay(w);
    await w.api("POST", "/api/goals", { name: "Laptop", targetPaise: 20_000_00, targetDate: "2027-01-27" });
    await plans(w);
    const m = mine(w).at(-1)!;
    expect(m.text).toMatch(/Goals that want money this month: Laptop ₹[\d,.]+\./);
    const label = buttonNames(m)[0]!;
    expect(label).toMatch(/^Set aside ₹[\d,.]+ for Laptop$/);
    await w.press(w.button(m, label), m.id);
    const goal = ((await w.api("GET", "/api/goals")).json.goals as Json[])[0]!;
    expect(goal.savedPaise).toBeGreaterThan(0);
  });

  it("/salary gives the plan for the latest salary, or says where things stand when there is none", async () => {
    const w = await world();
    await w.say("/salary");
    expect(w.tg.last.text).toContain("I have no salary entry yet.");
    await pay(w, { txnDate: "2026-10-20" });
    await w.say("/salary");
    expect(w.tg.last.text).toContain("Salary of ₹90,000 came in on 20 Oct.");
  });
});

describe("the morning briefing on Telegram", () => {
  it("is off until switched on", async () => {
    const w = await world();
    await rent(w);
    await push(w);
    expect(mine(w)).toHaveLength(0);
    expect(((await w.api("GET", "/api/settings")).json as Json).morningPush).toBe(false);
  });

  it("sends the greeting, what is available and only what needs attention, once a day", async () => {
    const w = await world();
    await rent(w);
    await w.api("PATCH", "/api/settings", { morningPush: true });
    await push(w);
    const text = mine(w).at(-1)!.text;
    expect(text).toMatch(/^Good morning/);
    expect(text).toContain("is available to spend, as recorded.");
    expect(text).toContain("• After 1 payment still to leave before 1 Nov, ₹1,28,000 is free to spend.");
    expect(text).not.toContain("Goals");
    const sent = mine(w).length;
    await push(w);
    expect(mine(w)).toHaveLength(sent);
    await push(w, "2026-10-29");
    expect(mine(w).length).toBe(sent + 1);
  });

  it("says nothing on a quiet day", async () => {
    const w = await world();
    await w.api("PATCH", "/api/settings", { morningPush: true });
    await push(w);
    expect(mine(w)).toHaveLength(0);
  });

  it("/settings says whether it is on", async () => {
    const w = await world();
    await w.say("/settings");
    expect(w.tg.last.text).toContain("I shall not send a morning briefing here unless you ask me to, in Settings.");
    await w.api("PATCH", "/api/settings", { morningPush: true });
    await w.say("/settings");
    expect(w.tg.last.text).toContain("I send your briefing here each morning when something needs attention.");
  });
});
