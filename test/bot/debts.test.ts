import { describe, expect, it } from "vitest";
import { db } from "../helpers";
import { runDebtReminders } from "../../src/services/debtJob";
import { buttonNames, world } from "./harness";

type W = Awaited<ReturnType<typeof world>>;
const balance = async (w: W, id: string) => (((await w.api("GET", "/api/accounts")).json.items as Record<string, any>[]).find((a) => a.id === id)!.balancePaise as number);
const people = async (w: W, status = "open") => ((await w.api("GET", `/api/debts?status=${status}`)).json.people as Record<string, any>[]);
const remind = (w: W, iso: string) => runDebtReminders({ db, telegram: w.tg, now: () => Date.parse(`${iso}T05:00:00Z`) });

describe("/owed", () => {
  it("says so when there is nothing", async () => {
    const w = await world();
    await w.say("/owed");
    expect(w.tg.last.text).toContain("Nobody owes you anything");
    expect(w.tg.last.text).toContain("/lent 5000 hdfc rahul");
  });

  it("lists who owes you and whom you owe, and marks the trusted", async () => {
    const w = await world();
    await w.say("/lent 5000 hdfc rahul");
    await w.say("/lent 2000 hdfc meera");
    await w.say("/borrowed 8000 sbi asha");
    const [meera] = (await people(w)).filter((p) => p.name === "Meera");
    await w.api("PATCH", `/api/contacts/${meera!.contactId}`, { trusted: true });
    await w.say("/owed");
    const text = w.tg.last.text;
    expect(text).toContain("Owed to you: ₹7,000");
    expect(text).toContain("Rahul: ₹5,000");
    expect(text).toContain("Meera: ₹2,000 (trusted, so I will not follow up)");
    expect(text).toContain("You owe: ₹8,000");
    expect(text).toContain("Asha: ₹8,000");
  });
});

describe("/lent and /borrowed", () => {
  it("notes money lent through a bank, moving that balance, and offers Undo", async () => {
    const w = await world();
    const before = await balance(w, w.hdfc.id);
    await w.say("/lent 5000 hdfc rahul");
    const m = w.tg.last;
    expect(m.text).toBe("Noted. You lent ₹5,000 to Rahul, through HDFC Bank. I will follow up if it is not paid back; you can mark Rahul as trusted in the app to stop that.");
    expect(await balance(w, w.hdfc.id)).toBe(before - 5_000_00);
    expect((await people(w))[0]).toMatchObject({ name: "Rahul", owedToYouPaise: 5_000_00 });
    await w.press(w.button(m, "Undo"), m.id);
    expect(m.text).toBe("Removed. That loan is gone from your records.");
    expect(await balance(w, w.hdfc.id)).toBe(before);
    expect(await people(w, "all")).toEqual([]);
  });

  it("notes money borrowed, raising that balance", async () => {
    const w = await world();
    const before = await balance(w, w.sbi.id);
    await w.say("/borrowed 8000 sbi asha");
    expect(w.tg.last.text).toBe("Noted. You borrowed ₹8,000 from Asha, through SBI.");
    expect(await balance(w, w.sbi.id)).toBe(before + 8_000_00);
  });

  it("says the person is trusted when they are", async () => {
    const w = await world();
    await w.say("/lent 1000 hdfc rahul");
    await w.api("PATCH", `/api/contacts/${(await people(w))[0]!.contactId}`, { trusted: true });
    await w.say("/lent 500 hdfc rahul");
    expect(w.tg.last.text).toBe("Noted. You lent ₹500 to Rahul, through HDFC Bank. Rahul is trusted, so I will not follow up.");
  });

  it("asks which account, banks only, with a cash choice", async () => {
    const w = await world();
    await w.say("/lent 5000 rahul");
    const m = w.tg.last;
    expect(buttonNames(m)).toEqual(expect.arrayContaining(["HDFC Bank", "SBI", "Cash or not tracked", "Cancel"]));
    expect(buttonNames(m)).not.toContain("OneCard");
    await w.press(w.button(m, "SBI"), m.id);
    expect(m.text).toContain("through SBI");
  });

  it("cash records only the debt, whether said up front or chosen", async () => {
    const w = await world();
    const before = await balance(w, w.hdfc.id);
    await w.say("/lent 3000 cash meera");
    expect(w.tg.last.text).toBe("Noted. You lent ₹3,000 to Meera, in cash. I will follow up if it is not paid back; you can mark Meera as trusted in the app to stop that.");
    await w.say("/lent 1000 kiran");
    const m = w.tg.last;
    await w.press(w.button(m, "Cash or not tracked"), m.id);
    expect(m.text).toContain("Kiran, in cash");
    expect(await balance(w, w.hdfc.id)).toBe(before);
    expect((await w.transactions()).filter((t) => t.type === "debt_out")).toHaveLength(0);
    expect(await people(w)).toHaveLength(2);
  });

  it("asks whom it was with when no name was given", async () => {
    const w = await world();
    await w.say("/lent 5000 hdfc");
    expect(w.tg.last.text).toBe("Whom was it with? For example: /lent 5000 hdfc rahul.");
    expect(await people(w, "all")).toEqual([]);
  });

  it("Undo refuses once repayments exist", async () => {
    const w = await world();
    await w.say("/lent 5000 hdfc rahul");
    const m = w.tg.last;
    const d = (await people(w))[0]!.debts[0];
    await w.api("POST", `/api/debts/${d.id}/payments`, { amountPaise: 1_000_00 });
    await w.press(w.button(m, "Undo"), m.id);
    expect(m.text).toBe("That loan already has repayments, so please change it in the app.");
    expect(await people(w)).toHaveLength(1);
  });

  it("/undo leaves a loan alone", async () => {
    const w = await world();
    await w.say("/lent 5000 hdfc rahul");
    await w.say("/undo");
    expect(w.tg.last.text).toBe("I have not logged anything for you that I can remove.");
  });
});

describe("answering a follow-up", () => {
  const followUp = async (w: W) => {
    await w.say("/lent 5000 hdfc rahul");
    const d = (await people(w))[0]!.debts[0];
    await w.api("PATCH", `/api/debts/${d.id}`, { dueDate: "2026-11-10" });
    await remind(w, "2026-11-10");
    return { m: w.tg.last, id: d.id as string };
  };

  it("Paid in full asks where it came in, then settles it and moves that balance", async () => {
    const w = await world();
    const { m } = await followUp(w);
    const before = await balance(w, w.hdfc.id);
    await w.press(w.button(m, "Paid in full"), m.id);
    expect(m.text).toBe("Rahul's ₹5,000 was paid. Which account did it come into? Or say it was cash.");
    await w.press(w.button(m, "HDFC Bank"), m.id);
    expect(m.text).toBe("Marked as paid: Rahul's ₹5,000 has come into HDFC Bank.");
    expect(await balance(w, w.hdfc.id)).toBe(before + 5_000_00);
    expect(await people(w)).toEqual([]);
  });

  it("Paid in full as cash settles without moving a balance", async () => {
    const w = await world();
    const { m } = await followUp(w);
    const before = await balance(w, w.hdfc.id);
    await w.press(w.button(m, "Paid in full"), m.id);
    await w.press(w.button(m, "Cash or not tracked"), m.id);
    expect(m.text).toBe("Marked as paid: Rahul's ₹5,000, received in cash.");
    expect(await balance(w, w.hdfc.id)).toBe(before);
    expect(await people(w)).toEqual([]);
  });

  it("Later just acknowledges, and Stop following up stops it for good", async () => {
    const w = await world();
    const { m, id } = await followUp(w);
    await w.press(w.button(m, "Later"), m.id);
    expect(m.text).toBe("Very well. I will ask again in a couple of weeks.");

    const w2 = await world();
    const second = await followUp(w2);
    await w2.press(w2.button(second.m, "Stop following up"), second.m.id);
    expect(second.m.text).toBe("Understood. I will not follow up about Rahul's money again. You can change that in the app.");
    // Other tests' people share this database, so look only at this person's chat.
    const before = w2.tg.messages.filter((x) => x.chatId === second.m.chatId).length;
    await remind(w2, "2026-12-30");
    expect(w2.tg.messages.filter((x) => x.chatId === second.m.chatId)).toHaveLength(before);
    void id;
  });

  it("a button for something already settled says so and changes nothing", async () => {
    const w = await world();
    const { m, id } = await followUp(w);
    await w.api("POST", `/api/debts/${id}/forgive`);
    await w.press(w.button(m, "Paid in full"), m.id);
    expect(m.text).toBe("That one has already been settled.");
  });

  it("another person's loan cannot be settled through a forged button", async () => {
    const w = await world();
    const other = await world();
    const { id } = await followUp(other);
    await w.say("/owed");
    const m = w.tg.last;
    await w.press(`f:${id}:p`, m.id);
    await w.press(`f:${id}:a:cash`, m.id);
    expect((await people(other))[0]).toMatchObject({ owedToYouPaise: 5_000_00 });
  });
});
