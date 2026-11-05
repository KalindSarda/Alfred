import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

type W = Awaited<ReturnType<typeof world>>;
const goalsOf = async (w: W, status = "active") => ((await w.api("GET", `/api/goals?status=${status}`)).json.goals as Record<string, any>[]);
const make = (w: W, name: string, targetPaise = 20_000_00, extra: object = {}) => w.api("POST", "/api/goals", { name, targetPaise, ...extra });
const safe = async (w: W) => ((await w.api("GET", "/api/accounts")).json.overview.safeToSpendPaise as number);

describe("/goals", () => {
  it("says how to start when there are none", async () => {
    const w = await world();
    await w.say("/goals");
    expect(w.tg.last.text).toBe("You have no savings goals yet. Add one in the app, under Plan, then Goals. Then /save 5000 laptop puts money toward it.");
  });

  it("lists progress, the monthly pace, and what is held back", async () => {
    const w = await world();
    const g = (await make(w, "Laptop", 20_000_00, { targetDate: "2027-01-27" })).json;
    await make(w, "Trip", 50_000_00);
    await w.api("POST", `/api/goals/${g.id}/contributions`, { amountPaise: 5_000_00 });
    await w.say("/goals");
    const text = w.tg.last.text;
    expect(text).toContain("Laptop: ₹5,000 of ₹20,000 (25%), ₹5,000 a month to reach it by 27 Jan");
    expect(text).toContain("Trip: ₹0 of ₹50,000 (0%)");
    expect(text).toContain("Put toward goals: ₹5,000. It stays in your bank, but is not counted as spendable.");
  });
});

describe("/save", () => {
  it("puts money toward the named goal, lowers safe-to-spend, and offers Undo", async () => {
    const w = await world();
    await make(w, "Laptop");
    const before = await safe(w);
    await w.say("/save 5000 laptop");
    const m = w.tg.last;
    expect(m.text).toBe("Noted. ₹5,000 put toward Laptop: ₹5,000 of ₹20,000. It stays in your bank, but I take it off what you can spend.");
    expect(await safe(w)).toBe(before - 5_000_00);
    await w.press(w.button(m, "Undo"), m.id);
    expect(m.text).toBe("Removed. That money is no longer put toward the goal.");
    expect(await safe(w)).toBe(before);
  });

  it("uses the only goal when no name is given, and matches part of a name", async () => {
    const w = await world();
    await make(w, "New laptop");
    await w.say("/save 2k");
    expect(w.tg.last.text).toContain("₹2,000 put toward New laptop");
    await w.say("/save 1000 lap");
    expect(w.tg.last.text).toContain("₹3,000 of ₹20,000");
  });

  it("says when the goal is reached", async () => {
    const w = await world();
    await make(w, "Laptop", 5_000_00);
    await w.say("/save 5000 laptop");
    expect(w.tg.last.text).toContain("That reaches the goal. Mark it achieved in the app once you have spent it.");
  });

  it("asks which goal when several could fit, or none was named", async () => {
    const w = await world();
    await make(w, "Laptop");
    await make(w, "Lap pool");
    await w.say("/save 3000 lap");
    const m = w.tg.last;
    expect(m.text).toBe("Which goal is the ₹3,000 for?");
    expect(buttonNames(m)).toEqual(expect.arrayContaining(["Laptop", "Lap pool"]));
    await w.press(w.button(m, "Lap pool"), m.id);
    expect(m.text).toContain("₹3,000 put toward Lap pool");
    await w.say("/save 100");
    expect(w.tg.last.text).toBe("Which goal is the ₹100 for?");
  });

  it("prefers an exact name over a longer one that contains it", async () => {
    const w = await world();
    await make(w, "Trip");
    await make(w, "Trip to Goa");
    await w.say("/save 1000 trip");
    expect(w.tg.last.text).toContain("put toward Trip:");
  });

  it("needs an amount and a goal that exists", async () => {
    const w = await world();
    await w.say("/save laptop");
    expect(w.tg.last.text).toBe("How much? For example: /save 5000 laptop.");
    await w.say("/save 500 laptop");
    expect(w.tg.last.text).toBe("You have no savings goals yet. Add one in the app, under Plan, then Goals.");
    await make(w, "Laptop");
    await w.say("/save 500 holiday");
    expect(w.tg.last.text).toBe("I could not find that goal. /goals lists them.");
    expect(await goalsOf(w)).toMatchObject([{ savedPaise: 0 }]);
  });

  it("a button for a closed goal, or someone else's, changes nothing", async () => {
    const w = await world();
    const other = await world();
    const mine = (await make(w, "Laptop")).json;
    const theirs = (await make(other, "Secret")).json;
    await w.say("/save 100");
    const m = w.tg.last;
    await w.api("POST", `/api/goals/${mine.id}/achieve`);
    await w.press(`g:${mine.id}:s:5000`, m.id);
    expect(m.text).toBe("That goal is already closed.");
    await w.press(`g:${theirs.id}:s:5000`, m.id);
    expect(m.text).toBe("That goal is already closed.");
    await w.press(`g:${theirs.id}:u:whatever`, m.id);
    expect((await goalsOf(other))[0]).toMatchObject({ savedPaise: 0 });
  });
});

describe("/balance", () => {
  it("shows what is put toward goals", async () => {
    const w = await world();
    const g = (await make(w, "Laptop")).json;
    await w.api("POST", `/api/goals/${g.id}/contributions`, { amountPaise: 5_000_00 });
    await w.say("/balance");
    expect(w.tg.last.text).toContain("Put toward goals, not spendable: ₹5,000.");
  });
});
