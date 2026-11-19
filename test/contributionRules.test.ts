import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { holdingContributions, recurringRules, telegramLinks } from "../src/db/schema";
import { runRecurring } from "../src/services/recurringJob";
import { FakeTelegram, linkTelegram, login, makeApp, registeredUser } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

const at = (iso: string) => () => Date.parse(`${iso}T05:00:00Z`); // 10:30 IST

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
  const make = async (name: string, extra: object = {}) => (await api("POST", "/api/holdings", { name, kind: "retirement", investedPaise: 0, valuePaise: 10_000_00, valueDate: "2026-10-01", ...extra })).json;
  const get = async (id: string) => ((await api("GET", "/api/holdings")).json.holdings as Json[]).find((h) => h.id === id)!;
  const epf = await make("EPF");
  const eps = await make("EPS pension", { valuePaise: 0 });
  const rule = (over: object = {}) =>
    api("POST", "/api/recurring", { type: "contribution", holdingId: epf.id, ownPaise: 3_000_00, employerPaise: 917_00, pensionPaise: 2_083_00, pensionHoldingId: eps.id, frequency: "monthly", day: 15, startDate: "2026-12-15", ...over });
  const tg = new FakeTelegram();
  const run = (iso: string) => runRecurring({ db, telegram: tg, now: at(iso) });
  return { api, make, get, epf, eps, rule, tg, run, userId: user.id };
}

describe("contribution rules", () => {
  // Every test in a file shares one database, so earlier tests' linked chats would also be messaged.
  beforeEach(async () => {
    await db.delete(telegramLinks);
    await db.delete(recurringRules);
  });

  it("are made like any recurring rule, with no account, and show what they add", async () => {
    const s = await setup();
    const res = await s.rule();
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      type: "contribution",
      title: "EPF contribution",
      accountId: null,
      accountName: null,
      amountPaise: 3_917_00,
      ownPaise: 3_000_00,
      employerPaise: 917_00,
      pensionPaise: 2_083_00,
      holdingId: s.epf.id,
      holdingName: "EPF",
      pensionHoldingId: s.eps.id,
      pensionHoldingName: "EPS pension",
      frequency: "monthly",
      day: 15,
      mode: "auto",
      status: "active",
      nextDate: "2026-12-15",
      entries: 0,
    });
    const list = (await s.api("GET", "/api/recurring")).json.items as Json[];
    expect(list.map((r) => r.id)).toContain(res.json.id);
  });

  it("refuse what does not fit", async () => {
    const s = await setup();
    const other = await setup();
    const bank = (await s.api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_000_00 })).json;
    const cases: [object, number][] = [
      [{ holdingId: undefined }, 422],
      [{ accountId: bank.id }, 422],
      [{ mode: "draft" }, 422],
      [{ frequency: "weekly", day: 3 }, 422],
      [{ amountPaise: 100_00 }, 422],
      [{ ownPaise: 0, employerPaise: 0 }, 422],
      [{ pensionHoldingId: null }, 422],
      [{ pensionHoldingId: s.epf.id }, 422],
      [{ holdingId: other.epf.id, pensionHoldingId: s.eps.id }, 404],
      [{ pensionHoldingId: other.eps.id }, 404],
    ];
    for (const [over, status] of cases) expect([JSON.stringify(over), (await s.rule(over)).status]).toEqual([JSON.stringify(over), status]);
    const counted = (await s.api("POST", "/api/holdings", { name: "Coins", kind: "gold", tracking: "units", unitsE4: 10_0000, investedPaise: 50_000_00, ratePaise: 1_30_000_00 })).json;
    expect((await s.rule({ holdingId: counted.id })).status).toBe(422);
    await s.api("POST", `/api/holdings/${s.eps.id}/close`);
    expect((await s.rule()).status).toBe(422);
    await s.api("POST", `/api/holdings/${s.epf.id}/close`);
    expect((await s.rule({ pensionPaise: 0, pensionHoldingId: null })).status).toBe(422);
  });

  it("add each due month to the investment, with the pension share as a linked entry, once", async () => {
    const s = await setup();
    await linkTelegram(s.userId, "chat-a");
    await s.rule();
    expect(await s.run("2026-12-14")).toEqual({ added: 0, sent: 0 });
    expect(await s.run("2026-12-15")).toEqual({ added: 1, sent: 1 });
    expect(await s.run("2026-12-15")).toEqual({ added: 0, sent: 0 });
    expect(s.tg.last.text).toBe("Added your EPF month: ₹3,917 and ₹2,083 to EPS pension. Check it against your passbook; if it differs, edit it in Alfred.");
    const epf = await s.get(s.epf.id);
    expect(epf.contributions).toHaveLength(1);
    expect(epf.contributions[0]).toMatchObject({ date: "2026-12-15", ownPaise: 3_000_00, employerPaise: 917_00, linked: { role: "primary", holdingName: "EPS pension", paise: 2_083_00 } });
    const [made] = await s.api("GET", "/api/recurring").then((r) => r.json.items as Json[]);
    expect(made).toMatchObject({ entries: 1, nextDate: "2027-01-15" });
  });

  it("count as put in from their day, and raise the worth when after the latest value typed; a start in the past adds the month at once", async () => {
    const s = await setup();
    const res = await s.rule({ startDate: "2026-10-15" });
    expect(res.json).toMatchObject({ entries: 1, nextDate: "2026-11-15" });
    expect(await s.get(s.epf.id)).toMatchObject({ investedPaise: 3_917_00, valuePaise: 13_917_00 });
    expect(await s.get(s.eps.id)).toMatchObject({ investedPaise: 2_083_00, valuePaise: 2_083_00 });
  });

  it("catch up the months missed, clamp a day the month lacks, and leave the pension out when it has none", async () => {
    const s = await setup();
    await s.rule({ day: 31, startDate: "2027-01-01", pensionPaise: 0, pensionHoldingId: null });
    await s.run("2027-02-28");
    const epf = await s.get(s.epf.id);
    expect(epf.contributions.map((c: Json) => c.date).sort()).toEqual(["2027-01-31", "2027-02-28"]);
    expect(epf.contributions.every((c: Json) => c.linked === null)).toBe(true);
    expect((await s.get(s.eps.id)).contributions).toHaveLength(0);
  });

  it("do not bring back a month that was removed, and skip it in the list", async () => {
    const s = await setup();
    await s.rule({ startDate: "2026-11-15" });
    await s.run("2026-11-15");
    const epf = await s.get(s.epf.id);
    expect((await s.api("DELETE", `/api/holdings/${s.epf.id}/contributions/${epf.contributions[0].id}`)).status).toBe(200);
    expect((await s.get(s.eps.id)).contributions).toHaveLength(0);
    expect(await s.run("2026-11-16")).toEqual({ added: 0, sent: 0 });
    expect((await s.get(s.epf.id)).contributions).toHaveLength(0);
    const [rule] = (await s.api("GET", "/api/recurring")).json.items as Json[];
    expect(rule).toMatchObject({ entries: 0, nextDate: "2026-12-15" });
    // removing it from the pension side counts too
    await s.run("2026-12-15");
    const eps = await s.get(s.eps.id);
    await s.api("DELETE", `/api/holdings/${s.eps.id}/contributions/${eps.contributions[0].id}`);
    expect(await s.run("2026-12-16")).toEqual({ added: 0, sent: 0 });
  });

  it("keep the day when the person edits the month the rule made, and never make it twice", async () => {
    const s = await setup();
    await s.rule({ startDate: "2026-11-15" });
    await s.run("2026-11-15");
    const epf = await s.get(s.epf.id);
    const edited = await s.api("PATCH", `/api/holdings/${s.epf.id}/contributions/${epf.contributions[0].id}`, { date: "2026-10-20", ownPaise: 3_100_00, employerPaise: 917_00, pensionPaise: 2_083_00, pensionHoldingId: s.eps.id });
    expect(edited.status).toBe(200);
    expect(await s.run("2026-11-25")).toEqual({ added: 0, sent: 0 });
    expect((await s.get(s.epf.id)).contributions).toHaveLength(1);
  });

  it("wait while paused, skip what the pause covered, and can skip the next one", async () => {
    const s = await setup();
    const { json: rule } = await s.rule({ startDate: "2026-11-15" });
    expect((await s.api("POST", `/api/recurring/${rule.id}/pause`)).json.status).toBe("paused");
    expect(await s.run("2026-11-16")).toEqual({ added: 0, sent: 0 });
    const skipped = await s.api("POST", `/api/recurring/${rule.id}/skip`);
    expect(skipped.status).toBe(200);
    expect((await s.api("POST", `/api/recurring/${rule.id}/resume`)).status).toBe(200);
    expect((await s.get(s.epf.id)).contributions).toHaveLength(0);
  });

  it("can be changed, and refuse an account, a category, a draft or another investment", async () => {
    const s = await setup();
    const { json: rule } = await s.rule();
    const changed = await s.api("PATCH", `/api/recurring/${rule.id}`, { ownPaise: 3_200_00, pensionPaise: 0, day: 20 });
    expect(changed.status).toBe(200);
    expect(changed.json).toMatchObject({ amountPaise: 4_117_00, ownPaise: 3_200_00, pensionPaise: 0, pensionHoldingId: null, day: 20 });
    const bank = (await s.api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 1_000_00 })).json;
    for (const body of [{ accountId: bank.id }, { mode: "draft" }, { frequency: "weekly", day: 2 }, { holdingId: s.eps.id }, { amountPaise: 5_00 }, { ownPaise: 0, employerPaise: 0 }]) {
      expect([JSON.stringify(body), (await s.api("PATCH", `/api/recurring/${rule.id}`, body)).status]).toEqual([JSON.stringify(body), 422]);
    }
    expect((await s.api("DELETE", `/api/recurring/${rule.id}`)).status).toBe(204);
  });

  it("leave a closed investment alone, and leave the pension share out when its investment is closed", async () => {
    const s = await setup();
    await linkTelegram(s.userId, "chat-b");
    await s.rule({ startDate: "2026-11-15" });
    await s.api("POST", `/api/holdings/${s.eps.id}/close`);
    await s.run("2026-11-15");
    expect(s.tg.last.text).toBe("Added your EPF month: ₹3,917. The pension share was left out, since its investment is closed. Check it against your passbook; if it differs, edit it in Alfred.");
    expect((await s.get(s.epf.id)).contributions[0].linked).toBeNull();
    await s.api("POST", `/api/holdings/${s.epf.id}/close`);
    expect(await s.run("2026-12-15")).toEqual({ added: 0, sent: 0 });
  });

  it("go when their investment is deleted", async () => {
    const s = await setup();
    await s.rule();
    expect((await s.api("DELETE", `/api/holdings/${s.epf.id}`)).status).toBe(204);
    expect(await db.select().from(recurringRules).where(and(eq(recurringRules.userId, s.userId), eq(recurringRules.type, "contribution")))).toHaveLength(0);
    expect(await db.select().from(holdingContributions).where(eq(holdingContributions.userId, s.userId))).toHaveLength(0);
  });

  it("are no money leaving a bank: commitments, the briefing and the reminders ignore them, other rules are unchanged", async () => {
    const s = await setup();
    const bank = (await s.api("POST", "/api/accounts", { kind: "bank", name: "HDFC", openingBalancePaise: 500_000_00 })).json;
    await s.api("POST", "/api/recurring", { title: "Rent", type: "expense", amountPaise: 22_000_00, accountId: bank.id, frequency: "monthly", day: 5, startDate: "2026-11-05" });
    await s.rule({ startDate: "2026-10-28" });
    const commitments = (await s.api("GET", "/api/commitments")).json;
    expect(JSON.stringify(commitments)).not.toContain("EPF");
    const briefing = (await s.api("GET", "/api/alfred/briefing")).json;
    expect(JSON.stringify(briefing)).not.toContain("EPF contribution");
    const list = (await s.api("GET", "/api/recurring")).json.items as Json[];
    expect(list.find((r) => r.title === "Rent")).toMatchObject({ type: "expense", accountName: "HDFC", holdingName: null, ownPaise: 0 });
    const { rulesOnAccount } = await import("../src/services/recurring");
    expect(await rulesOnAccount(db, s.userId, bank.id)).toBe(1);
  });

  it("show in /recurring in the chat as adding to the investment", async () => {
    const s = await setup();
    const { recurringReply } = await import("../src/alfred/botVoice");
    const [r] = ((await s.api("GET", "/api/recurring")).json.items as Json[]).concat((await s.rule()).json);
    const text = recurringReply([{ title: r!.title, type: r!.type, amountPaise: r!.amountPaise, accountName: r!.accountName, holdingName: r!.holdingName, repeat: r!.repeat, nextDate: r!.nextDate, mode: r!.mode, status: r!.status }]);
    expect(text).toContain("EPF contribution: ₹3,917 added to EPF, every month on the 15th, next 15 Dec");
  });
});

describe("the data export", () => {
  it("includes contributions, broker accounts, policies, the independence plan and the protection answers", async () => {
    const s = await setup();
    await s.api("POST", `/api/holdings/${s.epf.id}/contributions`, { date: "2026-10-15", ownPaise: 1_800_00, employerPaise: 550_00 });
    await s.api("POST", "/api/investment-accounts", { name: "Groww" });
    const out = (await s.api("GET", "/api/export/json")).json;
    expect(out.holdingContributions).toHaveLength(1);
    expect(out.holdingContributions[0]).toMatchObject({ ownPaise: 1_800_00, employerPaise: 550_00 });
    expect(out.holdingContributions[0].userId).toBeUndefined();
    expect(out.investmentAccounts.map((a: Json) => a.name)).toEqual(["Groww"]);
    expect(Array.isArray(out.insurancePolicies)).toBe(true);
    expect("firePlan" in out && "protectionProfile" in out).toBe(true);
  });
});
