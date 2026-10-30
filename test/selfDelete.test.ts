import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, categories, invites, sessions, transactions, users } from "../src/db/schema";
import { linkTelegram, login, makeApp, registeredUser, uniqueEmail, type TestApp } from "./api-helpers";
import { db } from "./helpers";

type Json = Record<string, any>;

const client = (app: TestApp, cookie: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.call(method, path, { cookie, ...(body !== undefined && { body }) });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as Json, headers: res.headers };
};

async function owner() {
  const app = makeApp();
  const user = await registeredUser();
  await db.update(users).set({ isOwner: true }).where(eq(users.id, user.id));
  const cookie = await login(app, user.email);
  return { app, user, api: client(app, cookie) };
}

async function member(o: Awaited<ReturnType<typeof owner>>, email = uniqueEmail()) {
  await o.api("POST", "/api/people/invites", { email });
  const cookie = await login(o.app, email);
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return { email, id: row!.id, cookie, api: client(o.app, cookie) };
}

describe("DELETE /api/me", () => {
  it("deletes the person and everything they own, signs them out, and leaves everyone else alone", async () => {
    const o = await owner();
    const m = await member(o);
    const other = await member(o);
    const bank = (await m.api("POST", "/api/accounts", { kind: "bank", name: "Mine", openingBalancePaise: 100_00 })).json;
    const cat = ((await m.api("GET", "/api/categories")).json.items as Json[])[0]!;
    await m.api("POST", "/api/transactions", { type: "expense", amountPaise: 10_00, txnDate: "2026-10-05", accountId: bank.id, categoryId: cat.id });
    await m.api("PUT", `/api/budgets/${cat.id}`, { limitPaise: 1_000_00 });
    await linkTelegram(m.id);
    await other.api("POST", "/api/accounts", { kind: "bank", name: "Theirs", openingBalancePaise: 5_00 });

    const res = await m.api("DELETE", "/api/me", { email: m.email.toUpperCase() });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/sid=;/);

    expect(await db.select().from(users).where(eq(users.id, m.id))).toHaveLength(0);
    expect(await db.select().from(accounts).where(eq(accounts.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(categories).where(eq(categories.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, m.id))).toHaveLength(0);
    expect((await m.api("GET", "/api/me")).status).toBe(401);
    expect(((await other.api("GET", "/api/accounts")).json.items as Json[]).map((a) => a.name)).toEqual(["Theirs"]);
    expect(((await o.api("GET", "/api/people")).json.members as Json[]).some((p) => p.id === m.id)).toBe(false);
  });

  it("afterwards nothing is sent to that address, until the owner invites it again, and then they start fresh", async () => {
    const o = await owner();
    const m = await member(o);
    await m.api("POST", "/api/accounts", { kind: "bank", name: "Mine", openingBalancePaise: 100_00 });
    await m.api("DELETE", "/api/me", { email: m.email });

    const before = o.app.sentEmails.length;
    await o.app.call("POST", "/api/auth/request-code", { body: { email: m.email, channel: "email" } });
    expect(o.app.sentEmails.length).toBe(before);
    expect((await db.select().from(invites).where(eq(invites.email, m.email)))[0]?.acceptedAt).not.toBeNull();

    expect((await o.api("POST", "/api/people/invites", { email: m.email })).status).toBe(201);
    const fresh = client(o.app, await login(o.app, m.email));
    expect((await fresh("GET", "/api/accounts")).json.items).toHaveLength(0);
  });

  it("refuses a wrong, missing or extra email and deletes nothing", async () => {
    const o = await owner();
    const m = await member(o);
    expect((await m.api("DELETE", "/api/me", { email: "someone@else.com" })).status).toBe(422);
    expect((await m.api("DELETE", "/api/me", { email: "" })).status).toBe(422);
    expect((await m.api("DELETE", "/api/me", {})).status).toBe(422);
    expect((await m.api("DELETE", "/api/me", { email: m.email, extra: 1 })).status).toBe(422);
    expect((await m.api("GET", "/api/me")).status).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, m.id))).toHaveLength(1);
  });

  it("the owner cannot delete their own account from the app", async () => {
    const o = await owner();
    const res = await o.api("DELETE", "/api/me", { email: o.user.email });
    expect(res.status).toBe(409);
    expect(res.json.error.message).toContain("owner");
    expect((await o.api("GET", "/api/me")).status).toBe(200);
  });

  it("needs a session", async () => {
    expect((await makeApp().call("DELETE", "/api/me", { body: { email: "a@b.co" } })).status).toBe(401);
  });

  it("allows five attempts an hour", async () => {
    const o = await owner();
    const m = await member(o);
    for (let i = 0; i < 5; i++) expect((await m.api("DELETE", "/api/me", { email: "wrong@example.com" })).status).toBe(422);
    expect((await m.api("DELETE", "/api/me", { email: m.email })).status).toBe(429);
    expect((await m.api("GET", "/api/me")).status).toBe(200);
  });
});
