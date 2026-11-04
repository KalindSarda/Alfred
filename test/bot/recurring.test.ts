import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

// The test clock is 2026-10-27.
const rule = (w: Awaited<ReturnType<typeof world>>, extra: object = {}) =>
  w.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: w.hdfc.id, categoryId: w.category("Rent"), frequency: "monthly", day: 5, ...extra });

describe("/recurring", () => {
  it("says so when nothing repeats", async () => {
    const w = await world();
    await w.say("/recurring");
    expect(w.tg.last.text).toContain("Nothing is set to repeat");
    expect(w.tg.last.text).toContain("under Plan, then Recurring");
  });

  it("lists what repeats with the next date, and marks the ones it will ask about", async () => {
    const w = await world();
    await rule(w);
    await rule(w, { title: "Salary", type: "income", amountPaise: 90_000_00, categoryId: w.category("Salary"), day: 1 });
    await rule(w, { title: "Electricity", categoryId: w.category("Bills & Utilities"), amountPaise: 3_000_00, mode: "draft", day: 15 });
    await w.say("/recurring");
    const text = w.tg.last.text;
    expect(text).toContain("What repeats:");
    expect(text).toContain("Rent: ₹22,000 from HDFC Bank, every month on the 5th, next 5 Nov");
    expect(text).toContain("Salary: ₹90,000 in HDFC Bank, every month on the 1st, next 1 Nov");
    expect(text).toContain("Electricity: ₹3,000 from HDFC Bank, every month on the 15th, next 15 Nov (I will ask you to confirm it)");
    // Soonest first.
    expect(text.indexOf("Salary")).toBeLessThan(text.indexOf("Rent"));
    expect(text.indexOf("Rent")).toBeLessThan(text.indexOf("Electricity"));
  });

  it("leaves out a paused rule", async () => {
    const w = await world();
    const r = (await rule(w)).json;
    await w.api("POST", `/api/recurring/${r.id}/pause`);
    await w.say("/recurring");
    expect(w.tg.last.text).toContain("Nothing is set to repeat");
  });
});

describe("confirming a draft from Telegram", () => {
  const draftFor = async (w: Awaited<ReturnType<typeof world>>) => {
    await rule(w, { title: "Electricity", categoryId: w.category("Bills & Utilities"), amountPaise: 3_000_00, mode: "draft", startDate: "2026-10-01" });
    return (await w.transactions()).find((t) => t.source === "recurring")!;
  };

  it("Confirm turns the draft into a real entry", async () => {
    const w = await world();
    const draft = await draftFor(w);
    expect(draft.status).toBe("draft");
    await w.say("/help");
    const m = w.tg.last;
    await w.press(`r:${draft.id}:ok`, m.id);
    expect(m.text).toBe("Confirmed. Electricity now counts in your records.");
    expect((await w.transactions()).find((t) => t.id === draft.id)!.status).toBe("confirmed");
  });

  it("Discard removes it", async () => {
    const w = await world();
    const draft = await draftFor(w);
    await w.say("/help");
    const m = w.tg.last;
    await w.press(`r:${draft.id}:no`, m.id);
    expect(m.text).toBe("Removed. Electricity for that day is gone from your records.");
    expect((await w.transactions()).some((t) => t.id === draft.id)).toBe(false);
  });

  it("a second tap says it is already settled", async () => {
    const w = await world();
    const draft = await draftFor(w);
    await w.say("/help");
    const m = w.tg.last;
    await w.press(`r:${draft.id}:ok`, m.id);
    await w.press(`r:${draft.id}:ok`, m.id);
    expect(m.text).toBe("That one has already been settled.");
  });

  it("a confirmed entry made by hand cannot be removed through this button", async () => {
    const w = await world();
    const manual = (await w.api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-10-05", accountId: w.hdfc.id })).json;
    await w.say("/help");
    const m = w.tg.last;
    await w.press(`r:${manual.id}:no`, m.id);
    expect(m.text).toBe("That one has already been settled.");
    expect((await w.transactions()).some((t) => t.id === manual.id)).toBe(true);
  });

  it("another person's draft cannot be touched through a forged button", async () => {
    const w = await world();
    const other = await world();
    const theirs = await draftFor(other);
    await w.say("/help");
    const m = w.tg.last;
    await w.press(`r:${theirs.id}:no`, m.id);
    expect((await other.transactions()).some((t) => t.id === theirs.id)).toBe(true);
    expect(buttonNames(m)).toEqual([]);
  });
});
