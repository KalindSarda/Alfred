import { describe, expect, it } from "vitest";
import { levelEmi } from "../src/domain/loans";
import { runMandateChecks } from "../src/services/mandateJob";
import { db } from "./helpers";
import { world } from "./bot/harness";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST). A recurring salary on the 1st puts the end of the window at 1 Nov.
const rule = (w: W, extra: object = {}) =>
  w.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: w.hdfc.id, categoryId: w.category("Rent"), frequency: "monthly", day: 29, ...extra });
const salary = (w: W, day = 1) => rule(w, { title: "Salary", type: "income", amountPaise: 90_000_00, categoryId: w.category("Salary"), day });
const view = async (w: W, query = "") => (await w.api("GET", `/api/commitments${query}`)).json as Json;
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
const mandate = (w: W, iso = "2026-10-27") => runMandateChecks({ db, telegram: w.tg, now: () => Date.parse(`${iso}T05:00:00Z`) });

describe("commitments before the next salary", () => {
  it("ends the window at the next recurring salary and lists what is coming", async () => {
    const w = await world();
    await salary(w);
    await rule(w);
    await rule(w, { title: "Gold SIP", type: "investment", categoryId: undefined, amountPaise: 5_000_00, day: 30 });
    await rule(w, { title: "Later", day: 5, amountPaise: 1_000_00 });
    const v = await view(w);
    expect(v).toMatchObject({ from: "2026-10-27", until: "2026-11-01", basis: "salary" });
    expect(v.items.map((i: Json) => [i.date, i.title, i.amountPaise, i.accountKind])).toEqual([
      ["2026-10-29", "Rent", 22_000_00, "bank"],
      ["2026-10-30", "Gold SIP", 5_000_00, "bank"],
    ]);
    expect(v.commitmentsPaise).toBe(27_000_00);
    expect(v.freeToSpendPaise).toBe(v.safeToSpendPaise - 27_000_00);
  });

  it("falls back to the next month start without a salary rule, and takes a number of days when asked", async () => {
    const w = await world();
    await rule(w);
    expect(await view(w)).toMatchObject({ until: "2026-11-01", basis: "month" });
    const week = await view(w, "?days=2");
    expect(week.until).toBe("2026-10-29");
    expect(week.items).toHaveLength(0);
    expect((await view(w, "?days=3")).items).toHaveLength(1);
    expect((await w.api("GET", "/api/commitments?days=0")).status).toBe(422);
  });

  it("lists a card bill but does not take it off a second time", async () => {
    const w = await world();
    await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 10_000_00, txnDate: "2026-10-10", accountId: w.onecard.id, categoryId: w.category("Shopping") });
    // OneCard: statement on the 20th, due on the 7th of the next month, so its bill falls after 1 Nov.
    const v = await view(w, "?days=20");
    const bill = (v.items as Json[]).find((i) => i.source === "card");
    expect(bill).toMatchObject({ title: "OneCard bill", counted: true, amountPaise: 10_000_00 });
    expect(v.commitmentsPaise).toBe(0);
    expect(v.freeToSpendPaise).toBe(v.safeToSpendPaise);
  });

  it("includes a loan EMI and borrowed money that is due, but not money you lent", async () => {
    const w = await world();
    await w.api("POST", "/api/loans", { name: "Home loan", kind: "home", accountId: w.hdfc.id, principalPaise: 10_00_000_00, ratePct: 9, months: 120, dueDay: 31 });
    await w.api("POST", "/api/debts", { name: "Asha", direction: "borrowed", amountPaise: 8_000_00, accountId: w.hdfc.id, dueDate: "2026-10-30" });
    await w.api("POST", "/api/debts", { name: "Rahul", direction: "lent", amountPaise: 5_000_00, accountId: w.hdfc.id, dueDate: "2026-10-30" });
    const items = (await view(w)).items as Json[];
    expect(items.map((i) => [i.source, i.title])).toEqual([
      ["debt", "Repay Asha"],
      ["loan", "Home loan EMI"],
    ]);
    expect(items.find((i) => i.source === "loan")!.amountPaise).toBe(levelEmi(10_00_000_00, 900, 120));
  });

  it("reports a bank debit the account cannot cover, counting earlier debits first", async () => {
    const w = await world();
    await rule(w, { amountPaise: 80_000_00, day: 28 });
    await rule(w, { title: "Insurance", amountPaise: 30_000_00, day: 29 });
    const v = await view(w);
    expect(v.shortfalls).toHaveLength(1);
    expect(v.shortfalls[0]).toMatchObject({ balancePaise: 20_000_00, shortByPaise: 10_000_00 });
    expect(v.shortfalls[0].commitment.title).toBe("Insurance");
  });

  it("leaves out a paused rule and a date already made", async () => {
    const w = await world();
    const paused = (await rule(w, { day: 28 })).json;
    await w.api("POST", `/api/recurring/${paused.id}/pause`);
    await rule(w, { title: "Gym", amountPaise: 1_000_00, day: 27 });
    // Due today with auto mode, the entry is made at once, so it is no longer a commitment.
    const items = (await view(w)).items as Json[];
    expect(items.map((i) => i.title)).not.toContain("Rent");
    expect(items.map((i) => i.title)).not.toContain("Gym");
  });

  it("shows only your own", async () => {
    const w = await world();
    const other = await world();
    await rule(other, { day: 28 });
    expect((await view(w)).items).toHaveLength(0);
    expect((await view(other)).items).toHaveLength(1);
  });
});

describe("warning that an account cannot cover a debit", () => {
  it("warns once, with how short the account is", async () => {
    const w = await world();
    await rule(w, { amountPaise: 1_20_000_00, day: 28 });
    expect((await mandate(w)).sent).toBeGreaterThanOrEqual(1);
    const text = mine(w).at(-1)!.text;
    expect(text).toBe("Rent: ₹1,20,000 is due to leave HDFC Bank tomorrow, and it holds ₹1,00,000. It is ₹20,000 short. A transfer in beforehand would spare you a failed debit.");
    const sent = mine(w).length;
    await mandate(w);
    expect(mine(w)).toHaveLength(sent);
  });

  it("says nothing when the balance covers it, or when it is not due for three days", async () => {
    const w = await world();
    await rule(w, { amountPaise: 90_000_00, day: 28 });
    await rule(w, { title: "Big", amountPaise: 5_00_000_00, day: 30 });
    await mandate(w);
    expect(mine(w)).toHaveLength(0);
  });

  it("warns again for the next date of the same rule", async () => {
    const w = await world();
    await rule(w, { amountPaise: 1_20_000_00, day: 28 });
    await mandate(w);
    const first = mine(w).length;
    await rule(w, { title: "Other", amountPaise: 1_20_000_00, day: 28 });
    await mandate(w);
    expect(mine(w).length).toBe(first + 1);
  });
});

describe("/due", () => {
  it("lists what is coming before the next salary and what is free to spend", async () => {
    const w = await world();
    await salary(w);
    await rule(w);
    await w.say("/due");
    const text = w.tg.last.text;
    expect(text).toContain("Still to leave before 1 Nov (your next salary):");
    expect(text).toContain("29 Oct: Rent ₹22,000 (HDFC Bank)");
    expect(text).toContain("Free to spend until then: ₹1,28,000, which is ₹1,50,000 safe to spend less ₹22,000 of what is coming.");
  });

  it("keeps the old answers when nothing is coming", async () => {
    const w = await world();
    await w.say("/due");
    expect(w.tg.last.text).toBe("No card payments are pending.");
  });
});

describe("the briefing", () => {
  it("says what is free to spend after what is still to leave, and says nothing when nothing is coming", async () => {
    const w = await world();
    const lines = async () => ((await w.api("GET", "/api/alfred/briefing")).json.lines as Json[]).map((l) => [l.key, l.text]);
    expect((await lines()).some(([k]) => k === "free")).toBe(false);
    await salary(w);
    await rule(w);
    const free = (await lines()).find(([k]) => k === "free");
    expect(free![1]).toBe("After 1 payment still to leave before 1 Nov, ₹1,28,000 is free to spend.");
  });
});

