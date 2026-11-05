import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

describe("/menu", () => {
  it("offers buttons for the main things, and each answers like its command", async () => {
    const w = await world();
    await w.say("/menu");
    const m = w.tg.last;
    expect(m.text).toContain("What would you like to see?");
    expect(buttonNames(m)).toEqual(expect.arrayContaining(["Balance", "Card dues", "Budgets", "Owed", "Goals", "EMIs", "IPO blocks", "Recurring", "Today"]));

    await w.press(w.button(m, "Owed"), m.id);
    expect(w.tg.last.text).toContain("Nobody owes you anything");
    await w.press(w.button(m, "Goals"), m.id);
    expect(w.tg.last.text).toContain("no savings goals yet");
    await w.press(w.button(m, "Balance"), m.id);
    expect(w.tg.last.text).toContain("Safe to spend");
  });

  it("ignores a button it does not know", async () => {
    const w = await world();
    await w.say("/menu");
    const before = w.tg.messages.length;
    await w.press("m:rm-rf", w.tg.last.id);
    expect(w.tg.messages.length).toBe(before);
  });

  it("is listed in /help", async () => {
    const w = await world();
    await w.say("/help");
    expect(w.tg.last.text).toContain("/menu");
  });
});
