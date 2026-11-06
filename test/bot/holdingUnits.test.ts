import { describe, expect, it } from "vitest";
import { runUnitsCheckIns } from "../../src/services/holdingsJob";
import { runRecurring } from "../../src/services/recurringJob";
import { db } from "../helpers";
import { world } from "./harness";

type W = Awaited<ReturnType<typeof world>>;
const gold = (w: W) => w.api("POST", "/api/holdings", { name: "Gold coins", kind: "gold", tracking: "units", unitsE4: 152_000, investedPaise: 1_90_000_00, ratePaise: 1_30_000_00 });
const holdings = async (w: W) => (await w.api("GET", "/api/holdings")).json.holdings as Record<string, any>[];

describe("holdings counted by quantity in the bot", () => {
  it("/value types the rate (gold: for 10 g), and the worth follows", async () => {
    const w = await world();
    await gold(w);
    await w.say("/value gold 132000");
    expect(w.tg.last.text).toBe("Noted. Gold coins is worth ₹2,00,640, up ₹10,640 on what you put in.");
    const [h] = await holdings(w);
    expect(h).toMatchObject({ ratePaise: 1_32_000_00, valuePaise: 2_00_640_00 });
  });

  it("/invest shows the quantity and the rate", async () => {
    const w = await world();
    await gold(w);
    await w.say("/invest");
    expect(w.tg.last.text).toContain("Gold coins: 15.2 g at ₹1,30,000 per 10 g, ₹1,97,600, up ₹7,600 (4%), valued today");
    expect(w.tg.last.text).toContain("/value gold 13200");
  });
});

describe("asking how much a SIP bought", () => {
  const at = (iso: string) => ({ db, now: () => Date.parse(`${iso}T05:00:00Z`) });
  const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
  const sip = async (w: W, mode = "auto") => {
    const h = (await gold(w)).json;
    await w.api("POST", "/api/recurring", { title: "Gold SIP", type: "investment", amountPaise: 5_000_00, accountId: w.hdfc.id, holdingId: h.id, frequency: "monthly", day: 27, mode });
    await runRecurring({ ...at("2026-10-27"), telegram: w.tg });
    return h;
  };

  it("asks on the day with a Tell me button, then reads the next message as the quantity", async () => {
    const w = await world();
    const h = await sip(w);
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: w.tg });
    expect(mine(w).filter((x) => x.text.includes("How many grams"))).toHaveLength(1);
    const m = mine(w).at(-1)!;
    expect(m.text).toBe("₹5,000 went into Gold coins. How many grams did that buy?");
    await w.press(w.button(m, "Tell me"), m.id);
    expect(m.text).toBe("Send how many grams, such as 0.5.");
    await w.say("0.4 g");
    expect(w.tg.last.text).toBe("Noted: 0.4 grams added to Gold coins. You now hold 15.6 grams.");
    const [after] = await holdings(w);
    expect(after).toMatchObject({ id: h.id, unitsHeldE4: 156_000, missingUnits: 0 });
    const sent = mine(w).length;
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: w.tg });
    expect(mine(w)).toHaveLength(sent);
  });

  it("does not ask about holdings valued by typing, nor on another day", async () => {
    const w = await world();
    const typed = (await w.api("POST", "/api/holdings", { name: "Tata", kind: "stock", valuePaise: 1000 })).json;
    await w.api("POST", "/api/recurring", { title: "Tata SIP", type: "investment", amountPaise: 5_000_00, accountId: w.hdfc.id, holdingId: typed.id, frequency: "monthly", day: 27 });
    await runRecurring({ ...at("2026-10-27"), telegram: w.tg });
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: w.tg });
    expect(mine(w).filter((x) => x.text.includes("How many"))).toHaveLength(0);
    const w2 = await world();
    await sip(w2);
    await runUnitsCheckIns({ ...at("2026-10-28"), telegram: w2.tg });
    expect(mine(w2).filter((x) => x.text.includes("How many"))).toHaveLength(0);
  });

  it("a message that is not a quantity carries on as a normal entry", async () => {
    const w = await world();
    await sip(w);
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: w.tg });
    const m = mine(w).at(-1)!;
    await w.press(w.button(m, "Tell me"), m.id);
    await w.say("450 food swiggy hdfc");
    expect(w.tg.last.text).toContain("450");
    expect((await holdings(w))[0]!.missingUnits).toBe(1);
  });

  it("a forged button changes nothing", async () => {
    const w = await world();
    const other = await world();
    await sip(other);
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: other.tg });
    const theirs = other.button(mine(other).at(-1)!, "Tell me");
    await sip(w);
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: w.tg });
    const m = mine(w).at(-1)!;
    await w.press(theirs, m.id);
    expect(m.text).toBe("I cannot find that entry any more, so there is nothing to add the quantity to.");
    await w.say("0.4");
    expect((await holdings(other))[0]!.missingUnits).toBe(1);
    expect((await holdings(w))[0]!.missingUnits).toBe(1);
  });

  it("a draft is asked about when it is confirmed, not before", async () => {
    const w = await world();
    await sip(w, "draft");
    await runUnitsCheckIns({ ...at("2026-10-27"), telegram: w.tg });
    expect(mine(w).filter((x) => x.text.includes("How many"))).toHaveLength(0);
    const draft = (await w.transactions()).find((t) => t.status === "draft" && t.holdingId)!;
    await w.say("/help");
    await w.press(`r:${draft.id}:ok`, w.tg.last.id);
    const question = mine(w).at(-1)!;
    expect(question.text).toBe("₹5,000 went into Gold coins. How many grams did that buy?");
    await w.press(w.button(question, "Tell me"), question.id);
    await w.say("0.5");
    expect((await holdings(w))[0]).toMatchObject({ unitsHeldE4: 157_000, missingUnits: 0 });
  });
});
