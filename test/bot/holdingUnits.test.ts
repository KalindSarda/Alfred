import { describe, expect, it } from "vitest";
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
