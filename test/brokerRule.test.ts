import { describe, expect, it } from "vitest";
import { login, makeApp, registeredUser } from "./api-helpers";

type Json = Record<string, any>;

const E4 = 10_000;

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
  const kinds = async () => (await api("GET", "/api/holding-kinds")).json.items as Json[];
  const kind = async (key: string) => (await kinds()).find((k) => k.key === key)!;
  const broker = async (name = "Groww") => (await api("POST", "/api/investment-accounts", { name })).json;
  const holding = (body: object) => api("POST", "/api/holdings", { investedPaise: 1_000_00, valuePaise: 1_000_00, ...body });
  return { api, kinds, kind, broker, holding };
}

describe("the broker account setting on each kind", () => {
  it("starts as required for stocks, funds and crypto, and not used for the rest", async () => {
    const s = await setup();
    const by = Object.fromEntries((await s.kinds()).map((k) => [k.key, k.brokerUse]));
    expect(by).toMatchObject({ stock: "required", fund: "required", crypto: "required", gold: "never", retirement: "never", other: "never" });
  });

  it("is not used for a new kind unless chosen, and can be changed", async () => {
    const s = await setup();
    const silver = (await s.api("POST", "/api/holding-kinds", { name: "Silver", unit: "g", ratePer: 1000 })).json;
    expect(silver.brokerUse).toBe("never");
    const etf = (await s.api("POST", "/api/holding-kinds", { name: "Bonds", brokerUse: "optional" })).json;
    expect(etf.brokerUse).toBe("optional");
    const changed = await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { brokerUse: "optional" });
    expect(changed.json.brokerUse).toBe("optional");
    expect((await s.api("PATCH", `/api/holding-kinds/${silver.id}`, { brokerUse: "sometimes" })).status).toBe(422);
    expect((await s.api("POST", "/api/holding-kinds", { name: "Art", brokerUse: "always" })).status).toBe(422);
  });
});

describe("adding and editing holdings under the rule", () => {
  it("does not hold anyone up before they have a broker account", async () => {
    const s = await setup();
    expect((await s.holding({ name: "Infosys", kind: "stock" })).status).toBe(201);
  });

  it("needs an account for a required kind once there is one to choose", async () => {
    const s = await setup();
    const groww = await s.broker();
    const without = await s.holding({ name: "Infosys", kind: "stock" });
    expect(without.status).toBe(422);
    expect(without.json.error.details[0]).toMatchObject({ path: "investmentAccountId" });
    expect(without.json.error.details[0].message).toContain("needs a broker account");
    expect((await s.holding({ name: "Infosys", kind: "stock", investmentAccountId: groww.id })).status).toBe(201);
  });

  it("refuses an account for a kind that is not used with one, until that kind is changed", async () => {
    const s = await setup();
    const groww = await s.broker();
    const refused = await s.holding({ name: "Coins", kind: "gold", investmentAccountId: groww.id });
    expect(refused.status).toBe(422);
    expect(refused.json.error.details[0].message).toBe("Gold is not held in a broker account. Change that kind's setting if it is.");
    expect((await s.holding({ name: "Coins", kind: "gold" })).status).toBe(201);
    await s.api("PATCH", `/api/holding-kinds/${(await s.kind("gold")).id}`, { brokerUse: "optional" });
    expect((await s.holding({ name: "Gold ETF", kind: "gold", investmentAccountId: groww.id })).status).toBe(201);
    expect((await s.holding({ name: "Digital gold", kind: "gold" })).status).toBe(201);
  });

  it("applies when the account or kind is changed, but never holds up an edit that touches neither", async () => {
    const s = await setup();
    const loose = (await s.holding({ name: "Old stock", kind: "stock" })).json;
    const groww = await s.broker();
    // an old holding with no account can still be renamed and flagged
    expect((await s.api("PATCH", `/api/holdings/${loose.id}`, { name: "Old stock 2", isEmergency: false })).status).toBe(200);
    // but it cannot be set back to no account once chosen, and a kind that refuses accounts cannot take one
    const placed = (await s.api("PATCH", `/api/holdings/${loose.id}`, { investmentAccountId: groww.id })).json;
    expect(placed.accountName).toBe("Groww");
    expect((await s.api("PATCH", `/api/holdings/${loose.id}`, { investmentAccountId: null })).status).toBe(422);
    expect((await s.api("PATCH", `/api/holdings/${loose.id}`, { kind: "gold" })).status).toBe(422);
    const coin = (await s.holding({ name: "Coin", kind: "gold" })).json;
    expect((await s.api("PATCH", `/api/holdings/${coin.id}`, { investmentAccountId: groww.id })).status).toBe(422);
    // moving a holding from one account to another is fine
    const icici = await s.broker("ICICI Direct");
    expect((await s.api("PATCH", `/api/holdings/${loose.id}`, { investmentAccountId: icici.id })).json.accountName).toBe("ICICI Direct");
  });

  it("applies to a bulk move, naming the holding that is refused", async () => {
    const s = await setup();
    const groww = await s.broker();
    const coin = (await s.holding({ name: "Coin", kind: "gold" })).json;
    const stock = (await s.holding({ name: "Infosys", kind: "stock", investmentAccountId: groww.id })).json;
    const toAccount = await s.api("POST", "/api/holdings/move", { ids: [coin.id], investmentAccountId: groww.id });
    expect(toAccount.status).toBe(422);
    expect(toAccount.json.error.details[0].message).toContain("Gold is not held in a broker account");
    const out = await s.api("POST", "/api/holdings/move", { ids: [stock.id], investmentAccountId: null });
    expect(out.status).toBe(422);
    expect(out.json.error.details[0].message).toContain("Infosys");
  });

  it("does not stop an IPO allotment, which has no way to choose an account in Telegram", async () => {
    const s = await setup();
    await s.broker();
    const bank = (await s.api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_00_000_00 })).json;
    const hold = (await s.api("POST", "/api/holds", { accountId: bank.id, title: "Tata Tech IPO", amountPaise: 15_000_00 })).json;
    const res = await s.api("POST", `/api/holds/${hold.id}/allot`, {});
    expect(res.status).toBe(200);
    const items = (await s.api("GET", "/api/holdings")).json.holdings as Json[];
    expect(items.find((h) => h.name === "Tata Tech IPO")).toMatchObject({ accountName: null });
  });
});

describe("one rate for a kind", () => {
  async function silver() {
    const s = await setup();
    const kind = (await s.api("POST", "/api/holding-kinds", { name: "Silver", unit: "g", ratePer: 1000, brokerUse: "optional" })).json;
    const counted = (name: string, extra: object = {}) =>
      s.holding({ name, kind: kind.key, tracking: "units", unitsE4: 100 * E4, investedPaise: 8_000_00, valuePaise: undefined, ...extra });
    return { ...s, silverKind: kind, counted };
  }

  it("puts the rate on every holding of the kind counted by weight and outside a broker account", async () => {
    const s = await silver();
    const groww = await s.broker();
    const bar = (await s.counted("Silver bar")).json;
    const coins = (await s.counted("Silver coins", { unitsE4: 50 * E4 })).json;
    const etf = (await s.counted("Silver ETF", { investmentAccountId: groww.id })).json;
    const res = await s.api("POST", `/api/holding-kinds/${s.silverKind.id}/rate`, { ratePaise: 95_000_00 });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ updated: 2 });
    const by = async (id: string) => (await s.api("GET", "/api/holdings")).json.holdings.find((h: Json) => h.id === id) as Json;
    // ₹95,000 for 1,000 g: 100 g is ₹9,500 and 50 g is ₹4,750
    expect((await by(bar.id)).valuePaise).toBe(9_500_00);
    expect((await by(coins.id)).valuePaise).toBe(4_750_00);
    expect((await by(etf.id)).ratePaise).toBeNull();
  });

  it("refuses a kind valued by typing, a kind with nothing to price, a future day and a bad rate", async () => {
    const s = await silver();
    const crypto = await s.kind("crypto");
    expect((await s.api("POST", `/api/holding-kinds/${crypto.id}/rate`, { ratePaise: 1_000_00 })).status).toBe(422);
    expect((await s.api("POST", `/api/holding-kinds/${s.silverKind.id}/rate`, { ratePaise: 1_000_00 })).status).toBe(422);
    await s.counted("Silver bar");
    expect((await s.api("POST", `/api/holding-kinds/${s.silverKind.id}/rate`, { ratePaise: 1_000_00, date: "2026-12-01" })).status).toBe(422);
    expect((await s.api("POST", `/api/holding-kinds/${s.silverKind.id}/rate`, { ratePaise: 0 })).status).toBe(422);
    expect((await s.api("POST", `/api/holding-kinds/nope/rate`, { ratePaise: 1_000_00 })).status).toBe(404);
  });

  it("does not touch another person's holdings, and needs a sign-in", async () => {
    const s = await silver();
    await s.counted("Silver bar");
    const other = await setup();
    expect((await other.api("POST", `/api/holding-kinds/${s.silverKind.id}/rate`, { ratePaise: 95_000_00 })).status).toBe(404);
    const anon = await makeApp().call("POST", `/api/holding-kinds/${s.silverKind.id}/rate`, { body: { ratePaise: 1_000_00 } });
    expect(anon.status).toBe(401);
  });
});
