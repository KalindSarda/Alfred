import { describe, expect, it } from "vitest";
import { world } from "./bot/harness";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27.
const account = (w: W, name: string, purpose?: string) => w.api("POST", "/api/investment-accounts", { name, ...(purpose !== undefined && { purpose }) });
const holding = (w: W, name: string, valuePaise: number, extra: object = {}) => w.api("POST", "/api/holdings", { name, kind: "stock", investedPaise: Math.round(valuePaise / 2), valuePaise, ...extra });
const overview = async (w: W, query = "") => (await w.api("GET", `/api/investment-accounts${query}`)).json as Json;

describe("investment accounts", () => {
  it("are created with a name and what they are for, and listed with their totals", async () => {
    const w = await world();
    const icici = (await account(w, "ICICI Direct", "Long term, family")).json;
    const groww = (await account(w, "Groww", "IPOs, learning and SIP")).json;
    expect(icici).toMatchObject({ name: "ICICI Direct", purpose: "Long term, family" });
    await holding(w, "Index fund", 3_00_000_00, { investmentAccountId: icici.id });
    await holding(w, "Gold", 1_00_000_00, { investmentAccountId: icici.id });
    await holding(w, "Tata Tech", 1_00_000_00, { investmentAccountId: groww.id });
    await holding(w, "Loose share", 1_00_000_00);

    const o = await overview(w);
    expect(o.totalValuePaise).toBe(6_00_000_00);
    expect(o.accounts.map((a: Json) => a.name)).toEqual(["ICICI Direct", "Groww"]);
    expect(o.accounts[0]).toMatchObject({ holdingCount: 2, valuePaise: 4_00_000_00, investedPaise: 2_00_000_00, gainPaise: 2_00_000_00, gainPct: 100, sharePct: 66.7 });
    expect(o.accounts[1]).toMatchObject({ holdingCount: 1, valuePaise: 1_00_000_00, sharePct: 16.7 });
    expect(o.unassigned).toMatchObject({ holdingCount: 1, valuePaise: 1_00_000_00 });
  });

  it("show on each holding, and net worth still counts everything", async () => {
    const w = await world();
    const a = (await account(w, "Groww")).json;
    const h = (await holding(w, "Tata Tech", 1_00_000_00, { investmentAccountId: a.id })).json;
    expect(h).toMatchObject({ investmentAccountId: a.id, accountName: "Groww" });
    expect(((await w.api("GET", "/api/accounts")).json.overview as Json).investmentsPaise).toBe(1_00_000_00);
    const loose = (await holding(w, "Loose", 10_000_00)).json;
    expect(loose).toMatchObject({ investmentAccountId: null, accountName: null });
  });

  it("have unique names for a person, rename, change their purpose and clear it", async () => {
    const w = await world();
    const other = await world();
    const a = (await account(w, "Groww", "Learning")).json;
    expect((await account(w, " groww ")).status).toBe(422);
    expect((await account(other, "Groww")).status).toBe(201);
    expect((await account(w, "")).status).toBe(422);
    const renamed = await w.api("PATCH", `/api/investment-accounts/${a.id}`, { name: "Groww Demat", purpose: null });
    expect(renamed.json).toMatchObject({ name: "Groww Demat", purpose: null });
    expect((await w.api("PATCH", `/api/investment-accounts/${a.id}`, { name: "Zerodha" })).status).toBe(200);
  });

  it("are one person's own", async () => {
    const w = await world();
    const other = await world();
    const a = (await account(w, "Groww")).json;
    expect((await other.api("PATCH", `/api/investment-accounts/${a.id}`, { name: "Mine" })).status).toBe(404);
    expect((await other.api("POST", `/api/investment-accounts/${a.id}/archive`)).status).toBe(404);
    expect((await overview(other)).accounts).toEqual([]);
    expect((await holding(other, "Tata", 1_000_00, { investmentAccountId: a.id })).status).toBe(404);
  });

  it("can only be archived once nothing active is in them, and an archived one takes no new holdings", async () => {
    const w = await world();
    const a = (await account(w, "Groww")).json;
    const h = (await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: a.id })).json;
    expect((await w.api("POST", `/api/investment-accounts/${a.id}/archive`)).status).toBe(409);
    await w.api("PATCH", `/api/holdings/${h.id}`, { investmentAccountId: null });
    expect((await w.api("POST", `/api/investment-accounts/${a.id}/archive`)).status).toBe(200);
    expect((await overview(w)).accounts).toEqual([]);
    expect(((await overview(w, "?includeArchived=true")).accounts as Json[]).map((x) => x.archived)).toEqual([true]);
    expect((await holding(w, "New", 1_000_00, { investmentAccountId: a.id })).status).toBe(422);
    expect((await w.api("POST", `/api/investment-accounts/${a.id}/unarchive`)).status).toBe(200);
    expect((await holding(w, "New", 1_000_00, { investmentAccountId: a.id })).status).toBe(201);
  });
});

describe("holdings and their accounts", () => {
  it("allow the same stock in two accounts, but not twice in one", async () => {
    const w = await world();
    const icici = (await account(w, "ICICI Direct")).json;
    const groww = (await account(w, "Groww")).json;
    expect((await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: icici.id })).status).toBe(201);
    expect((await holding(w, "Tata Tech", 2_000_00, { investmentAccountId: groww.id })).status).toBe(201);
    const twice = await holding(w, "tata tech", 3_000_00, { investmentAccountId: groww.id });
    expect(twice.status).toBe(422);
    expect(twice.json.error.details[0].message).toBe("That account already holds an investment with that name");
    // With no account the old rule stands.
    expect((await holding(w, "Loose", 1_000_00)).status).toBe(201);
    expect((await holding(w, "loose", 1_000_00)).status).toBe(422);
  });

  it("move between accounts one at a time, with the same checks", async () => {
    const w = await world();
    const icici = (await account(w, "ICICI Direct")).json;
    const groww = (await account(w, "Groww")).json;
    const a = (await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: icici.id })).json;
    await holding(w, "Tata Tech", 2_000_00, { investmentAccountId: groww.id });
    expect((await w.api("PATCH", `/api/holdings/${a.id}`, { investmentAccountId: groww.id })).status).toBe(422);
    const b = (await holding(w, "Infosys", 1_000_00, { investmentAccountId: icici.id })).json;
    const moved = await w.api("PATCH", `/api/holdings/${b.id}`, { investmentAccountId: groww.id });
    expect(moved.json).toMatchObject({ accountName: "Groww" });
  });

  it("move in bulk, into an account or out of all of them", async () => {
    const w = await world();
    const icici = (await account(w, "ICICI Direct")).json;
    const ids: string[] = [];
    for (let i = 1; i <= 30; i += 1) ids.push(((await holding(w, `Stock ${i}`, 1_000_00)).json as Json).id);
    const res = await w.api("POST", "/api/holdings/move", { ids, investmentAccountId: icici.id });
    expect(res.json).toEqual({ moved: 30 });
    expect((await overview(w)).accounts[0]).toMatchObject({ name: "ICICI Direct", holdingCount: 30, valuePaise: 30_000_00 });
    expect((await overview(w)).unassigned.holdingCount).toBe(0);
    expect((await w.api("POST", "/api/holdings/move", { ids: ids.slice(0, 5), investmentAccountId: null })).json).toEqual({ moved: 5 });
    expect((await overview(w)).unassigned.holdingCount).toBe(5);
  });

  it("refuse a bulk move that would put two of the same name together, or into another person's account", async () => {
    const w = await world();
    const other = await world();
    const icici = (await account(w, "ICICI Direct")).json;
    const groww = (await account(w, "Groww")).json;
    await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: icici.id });
    const here = (await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: groww.id })).json;
    const clash = await w.api("POST", "/api/holdings/move", { ids: [here.id], investmentAccountId: icici.id });
    expect(clash.status).toBe(422);
    expect(clash.json.error.details[0].message).toBe("Tata Tech is already in that account");
    const theirs = (await account(other, "Theirs")).json;
    expect((await w.api("POST", "/api/holdings/move", { ids: [here.id], investmentAccountId: theirs.id })).status).toBe(404);
    expect((await w.api("POST", "/api/holdings/move", { ids: ["nope"], investmentAccountId: icici.id })).status).toBe(404);
    expect((await w.api("POST", "/api/holdings/move", { ids: [], investmentAccountId: icici.id })).status).toBe(422);
  });

  it("let a SIP follow its holding into the account", async () => {
    const w = await world();
    const groww = (await account(w, "Groww")).json;
    const h = (await holding(w, "Flexi Cap", 60_000_00, { kind: "fund", investmentAccountId: groww.id })).json;
    const rule = await w.api("POST", "/api/recurring", { title: "SIP", type: "investment", amountPaise: 2_000_00, accountId: w.hdfc.id, frequency: "monthly", day: 10, startDate: "2026-11-10", holdingId: h.id });
    expect(rule.status).toBe(201);
    expect(((await w.api("GET", `/api/holdings?status=active`)).json.holdings as Json[]).find((x) => x.id === h.id)).toMatchObject({ accountName: "Groww" });
  });

  it("go to the chosen account when an IPO is allotted", async () => {
    const w = await world();
    const groww = (await account(w, "Groww")).json;
    const hold = (await w.api("POST", "/api/holds", { accountId: w.hdfc.id, title: "Acme IPO", amountPaise: 15_000_00 })).json;
    const allotted = await w.api("POST", `/api/holds/${hold.id}/allot`, { investmentAccountId: groww.id });
    expect(allotted.status).toBe(200);
    const h = ((await w.api("GET", "/api/holdings?status=active")).json.holdings as Json[]).find((x) => x.name === "Acme IPO");
    expect(h).toMatchObject({ accountName: "Groww" });
  });
});

describe("/invest", () => {
  it("lists holdings under their account, the biggest first, with what is not in one last", async () => {
    const w = await world();
    const icici = (await account(w, "ICICI Direct")).json;
    const groww = (await account(w, "Groww")).json;
    await holding(w, "Index fund", 3_00_000_00, { investmentAccountId: icici.id });
    await holding(w, "Tata Tech", 50_000_00, { investmentAccountId: groww.id });
    await holding(w, "Loose", 10_000_00);
    await w.say("/invest");
    const text = w.tg.last.text;
    expect(text).toContain("ICICI Direct: ₹3,00,000, 1 holding");
    expect(text.indexOf("ICICI Direct")).toBeLessThan(text.indexOf("Groww: ₹50,000"));
    expect(text.indexOf("Groww")).toBeLessThan(text.indexOf("Not in an account yet: ₹10,000"));
  });

  it("is unchanged when no account exists", async () => {
    const w = await world();
    await holding(w, "Tata Tech", 12_000_00);
    await w.say("/invest");
    expect(w.tg.last.text).not.toContain("Not in an account yet");
    expect(w.tg.last.text).toContain("Tata Tech:");
  });

  it("tells a stock apart in /value when it is in two accounts", async () => {
    const w = await world();
    const icici = (await account(w, "ICICI Direct")).json;
    const groww = (await account(w, "Groww")).json;
    await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: icici.id });
    await holding(w, "Tata Tech", 1_000_00, { investmentAccountId: groww.id });
    await w.say("/value tata 5000");
    const labels = w.tg.last.buttons.flat().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["Tata Tech (ICICI Direct)", "Tata Tech (Groww)"]));
  });
});
