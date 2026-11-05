import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

type W = Awaited<ReturnType<typeof world>>;
const make = (w: W, name: string, extra: object = {}) => w.api("POST", "/api/holdings", { name, kind: "stock", investedPaise: 10_000_00, valuePaise: 12_000_00, ...extra });
const holdings = async (w: W) => ((await w.api("GET", "/api/holdings")).json.holdings as Record<string, any>[]);

describe("/invest", () => {
  it("says how to start when there are none", async () => {
    const w = await world();
    await w.say("/invest");
    expect(w.tg.last.text).toBe("You have no investments recorded yet. Add one in the app, under Accounts and commitments, then Investments.");
  });

  it("lists each holding with its value, gain and how old the value is, and the total", async () => {
    const w = await world();
    await make(w, "Tata Tech");
    await make(w, "Gold", { kind: "gold", investedPaise: 5_000_00, valuePaise: 4_500_00 });
    await w.say("/invest");
    const text = w.tg.last.text;
    expect(text).toContain("Your investments are worth ₹16,500: ₹15,000 put in, up ₹1,500.");
    expect(text).toContain("Tata Tech: ₹12,000, up ₹2,000 (20%), valued today");
    expect(text).toContain("Gold: ₹4,500, down ₹500 (-10%), valued today");
    expect(text).toContain("/value tata 15200");
  });
});

describe("/value", () => {
  it("updates the named holding, by part of its name, with the amount last or first", async () => {
    const w = await world();
    await make(w, "Tata Tech");
    await w.say("/value tata 15200");
    expect(w.tg.last.text).toBe("Noted. Tata Tech is worth ₹15,200, up ₹5,200 on what you put in.");
    await w.say("/value 16k tata");
    expect(w.tg.last.text).toContain("worth ₹16,000");
    expect((await holdings(w))[0]!.valuePaise).toBe(16_000_00);
  });

  it("uses the only holding when no name is given", async () => {
    const w = await world();
    await make(w, "Tata Tech");
    await w.say("/value 11000");
    expect(w.tg.last.text).toContain("Tata Tech is worth ₹11,000, up ₹1,000");
  });

  it("asks which one when several fit, then sets it", async () => {
    const w = await world();
    await make(w, "Tata Tech");
    await make(w, "Tata Motors");
    await w.say("/value tata 9000");
    const m = w.tg.last;
    expect(m.text).toBe("Which investment is worth ₹9,000?");
    expect(buttonNames(m)).toEqual(expect.arrayContaining(["Tata Tech", "Tata Motors"]));
    await w.press(w.button(m, "Tata Motors"), m.id);
    expect(m.text).toContain("Tata Motors is worth ₹9,000");
    const rows = await holdings(w);
    expect(rows.find((h) => h.name === "Tata Tech")!.valuePaise).toBe(12_000_00);
  });

  it("prefers an exact name over a longer one that contains it", async () => {
    const w = await world();
    await make(w, "Gold");
    await make(w, "Gold ETF");
    await w.say("/value gold 6000");
    expect(w.tg.last.text).toContain("Noted. Gold is worth ₹6,000");
  });

  it("needs an amount and an investment that exists", async () => {
    const w = await world();
    await w.say("/value tata");
    expect(w.tg.last.text).toBe("How much is it worth now? For example: /value tata 15200.");
    await w.say("/value tata 100");
    expect(w.tg.last.text).toBe("You have no investments recorded yet. Add one in the app, under Accounts and commitments, then Investments.");
    await make(w, "Tata Tech");
    await w.say("/value reliance 100");
    expect(w.tg.last.text).toBe("I could not find that investment. /invest lists them.");
  });

  it("a button for a closed holding, or someone else's, changes nothing", async () => {
    const w = await world();
    const other = await world();
    const mine = (await make(w, "Tata Tech")).json;
    const theirs = (await make(other, "Secret")).json;
    await w.say("/invest");
    const m = w.tg.last;
    await w.api("POST", `/api/holdings/${mine.id}/close`);
    await w.press(`i:${mine.id}:v:5000`, m.id);
    expect(m.text).toBe("That investment is closed, so I have left it alone.");
    await w.press(`i:${theirs.id}:v:5000`, m.id);
    expect((await holdings(other))[0]!.valuePaise).toBe(12_000_00);
  });
});

describe("/balance", () => {
  it("counts investments in net worth", async () => {
    const w = await world();
    await w.say("/balance");
    const before = /Net worth: ₹([\d,.]+)/.exec(w.tg.last.text)![1]!;
    await make(w, "Tata Tech", { investedPaise: 0, valuePaise: 10_000_00 });
    await w.say("/balance");
    const after = /Net worth: ₹([\d,.]+)/.exec(w.tg.last.text)![1]!;
    const n = (s: string) => Number(s.replace(/,/g, ""));
    expect(n(after) - n(before)).toBe(10_000);
  });
});
