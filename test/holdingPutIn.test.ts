import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

// The test clock is 2026-10-27 (IST).
async function setup() {
  const app = makeApp();
  const user = await registeredUser();
  const cookie = await login(app, user.email);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as Json };
  };
  const bank = (await api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
  const epf = () => api("POST", "/api/holdings", { name: "EPF", kind: "retirement", investedPaise: 12_000_00, valuePaise: 12_000_00 });
  return { api, bank, epf };
}

describe("the total put in, for something valued by typing", () => {
  it("is changed from the passbook, and the gain follows what was typed as worth", async () => {
    const s = await setup();
    const h = (await s.epf()).json;
    expect(h).toMatchObject({ investedPaise: 12_000_00, gainPaise: 0 });
    await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 16_399_00 });
    const updated = await s.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: 16_399_00 });
    expect(updated.status).toBe(200);
    expect(updated.json).toMatchObject({ investedPaise: 16_399_00, valuePaise: 16_399_00, gainPaise: 0 });
  });

  it("includes what bank purchases already show, and refuses a total below them", async () => {
    const s = await setup();
    const h = (await s.epf()).json;
    await s.api("POST", `/api/holdings/${h.id}/buy`, { amountPaise: 5_000_00, accountId: s.bank.id, date: "2026-10-20" });
    // 12,000 before tracking plus 5,000 bought is 17,000 put in
    const before = (await s.api("PATCH", `/api/holdings/${h.id}`, { name: "EPF" })).json;
    expect(before.investedPaise).toBe(17_000_00);
    const raised = await s.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: 20_000_00 });
    expect(raised.json.investedPaise).toBe(20_000_00);
    const tooLow = await s.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: 4_000_00 });
    expect(tooLow.status).toBe(422);
    expect(tooLow.json.error.details[0]).toMatchObject({ path: "investedPaise" });
    expect(tooLow.json.error.details[0].message).toBe("That is less than the ₹5,000 your entries already show");
    // exactly what the bank entries show is allowed: nothing was put in before
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: 5_000_00 })).json.investedPaise).toBe(5_000_00);
  });

  it("is refused for a holding counted by quantity, and for a bad amount", async () => {
    const s = await setup();
    const gold = (await s.api("POST", "/api/holdings", { name: "Coins", kind: "gold", tracking: "units", unitsE4: 100_000, investedPaise: 50_000_00 })).json;
    const refused = await s.api("PATCH", `/api/holdings/${gold.id}`, { investedPaise: 60_000_00 });
    expect(refused.status).toBe(422);
    expect(refused.json.error.details[0].message).toBe("Counted by quantity, what was put in comes from its purchases");
    const h = (await s.epf()).json;
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: -1 })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: 10.5 })).status).toBe(422);
  });

  it("leaves it alone when an edit does not send it, and never touches another person's holding", async () => {
    const s = await setup();
    const h = (await s.epf()).json;
    expect((await s.api("PATCH", `/api/holdings/${h.id}`, { name: "EPF account" })).json).toMatchObject({ name: "EPF account", investedPaise: 12_000_00 });
    const other = await setup();
    expect((await other.api("PATCH", `/api/holdings/${h.id}`, { investedPaise: 1_00 })).status).toBe(404);
  });
});
