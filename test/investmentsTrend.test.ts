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
  const trend = async () => (await api("GET", "/api/dashboard/networth")).json.points as Json[];
  const headline = async () => ((await api("GET", "/api/accounts")).json.overview as Json).netWorthPaise as number;
  const briefing = async (key: string) => ((await api("GET", "/api/alfred/briefing")).json.lines as Json[]).find((l) => l.key === key);
  return { api, bank, trend, headline, briefing };
}

describe("investments in the net worth trend", () => {
  it("counts the value as it stood at each month end, and ends on the headline figure", async () => {
    const s = await setup();
    await s.api("POST", "/api/transactions", { type: "expense", amountPaise: 100_00, txnDate: "2026-08-10", accountId: s.bank.id, merchant: "Shop" });
    const h = (await s.api("POST", "/api/holdings", { name: "Tata Tech", kind: "stock", investedPaise: 10_000_00, valuePaise: 10_000_00, valueDate: "2026-08-15" })).json;
    await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 12_000_00, date: "2026-09-20" });
    await s.api("POST", `/api/holdings/${h.id}/value`, { valuePaise: 15_000_00, date: "2026-10-10" });
    const points = await s.trend();
    expect(points.map((p) => [p.month, p.investmentsPaise])).toEqual([
      ["2026-08", 10_000_00],
      ["2026-09", 12_000_00],
      ["2026-10", 15_000_00],
    ]);
    const last = points.at(-1)!;
    expect(last.netWorthPaise).toBe(last.banksPaise + last.investmentsPaise);
    expect(last.netWorthPaise).toBe(await s.headline());
  });

  it("a sale leaves net worth where it was, moving value into the bank", async () => {
    const s = await setup();
    const h = (await s.api("POST", "/api/holdings", { name: "Gold", kind: "gold", investedPaise: 10_000_00, valuePaise: 10_000_00, valueDate: "2026-10-01" })).json;
    const before = await s.headline();
    await s.api("POST", `/api/holdings/${h.id}/sell`, { amountPaise: 4_000_00, accountId: s.bank.id, date: "2026-10-20" });
    expect(await s.headline()).toBe(before);
    expect((await s.trend()).at(-1)!.netWorthPaise).toBe(before);
  });
});

describe("the briefing and stale values", () => {
  it("says nothing while values are fresh, or when there are no investments", async () => {
    const s = await setup();
    expect(await s.briefing("investments")).toBeUndefined();
    await s.api("POST", "/api/holdings", { name: "Tata Tech", kind: "stock", valuePaise: 10_000_00 });
    expect(await s.briefing("investments")).toBeUndefined();
  });

  it("mentions a value older than 35 days, or never typed, linking to Investments", async () => {
    const s = await setup();
    await s.api("POST", "/api/holdings", { name: "Tata Tech", kind: "stock", valuePaise: 10_000_00, valueDate: "2026-08-17" });
    const line = (await s.briefing("investments"))!;
    expect(line.text).toBe("One of your investments was last valued 71 days ago. A fresh value keeps your net worth honest.");
    expect(line.to).toBe("/accounts?view=investments");
    await s.api("POST", "/api/holdings", { name: "Gold", kind: "gold", investedPaise: 5_000_00 });
    expect((await s.briefing("investments"))!.text).toBe("2 of your investments need a fresh value; the oldest has none yet.");
  });
});
