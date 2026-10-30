import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invitationMessages } from "../src/alfred/messages";
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

/** Invites an email and signs that person in for the first time. */
async function invitedMember(o: Awaited<ReturnType<typeof owner>>, email = uniqueEmail()) {
  await o.api("POST", "/api/people/invites", { email });
  const cookie = await login(o.app, email);
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return { email, id: row!.id, cookie, api: client(o.app, cookie) };
}

describe("inviting", () => {
  it("emails the invitation and lists it as pending", async () => {
    const o = await owner();
    const email = uniqueEmail();
    const res = await o.api("POST", "/api/people/invites", { email: email.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.json.emailed).toBe(true);
    const mail = o.app.sentEmails.find((m) => m.to === email);
    expect(mail?.subject).toMatch(/^An invitation from /);
    expect(mail?.text).toContain("http://localhost");
    const people = (await o.api("GET", "/api/people")).json;
    expect(people.invites.filter((i: Json) => i.email === email)).toHaveLength(1);
  });

  it("an invited email gets a code and an account with the default categories", async () => {
    const o = await owner();
    const email = uniqueEmail();
    await o.api("POST", "/api/people/invites", { email });
    const before = o.app.sentEmails.length;
    const res = await o.app.call("POST", "/api/auth/request-code", { body: { email, channel: "email" } });
    expect(res.status).toBe(202);
    expect(o.app.sentEmails.length).toBe(before + 1);

    const cookie = await login(o.app, email);
    const api = client(o.app, cookie);
    const me = (await api("GET", "/api/me")).json;
    expect(me).toMatchObject({ email, isOwner: false, needsSetup: true });
    expect(((await api("GET", "/api/categories")).json.items as Json[]).length).toBeGreaterThan(20);
    expect(((await o.api("GET", "/api/people")).json.invites as Json[]).some((i) => i.email === email)).toBe(false);
  });

  it("an email that was never invited gets nothing, and looks exactly the same", async () => {
    const o = await owner();
    const email = uniqueEmail();
    const invited = uniqueEmail();
    await o.api("POST", "/api/people/invites", { email: invited });
    const a = await o.app.call("POST", "/api/auth/request-code", { body: { email: invited, channel: "email" } });
    const before = o.app.sentEmails.length;
    const b = await o.app.call("POST", "/api/auth/request-code", { body: { email, channel: "email" } });
    expect([b.status, await b.text()]).toEqual([a.status, await a.clone().text()]);
    expect(o.app.sentEmails.length).toBe(before);
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
  });

  it("a withdrawn invitation stops working", async () => {
    const o = await owner();
    const email = uniqueEmail();
    const { invite } = (await o.api("POST", "/api/people/invites", { email })).json;
    expect((await o.api("DELETE", `/api/people/invites/${invite.id}`)).status).toBe(204);
    const before = o.app.sentEmails.length;
    await o.app.call("POST", "/api/auth/request-code", { body: { email, channel: "email" } });
    expect(o.app.sentEmails.length).toBe(before);
    expect((await o.api("DELETE", `/api/people/invites/${invite.id}`)).status).toBe(404);
  });

  it("inviting twice sends again but keeps one pending invitation", async () => {
    const o = await owner();
    const email = uniqueEmail();
    await o.api("POST", "/api/people/invites", { email });
    await o.api("POST", "/api/people/invites", { email });
    expect(o.app.sentEmails.filter((m) => m.to === email)).toHaveLength(2);
    expect(((await o.api("GET", "/api/people")).json.invites as Json[]).filter((i) => i.email === email)).toHaveLength(1);
  });

  it("refuses to invite someone who already has an account, and a bad address", async () => {
    const o = await owner();
    expect((await o.api("POST", "/api/people/invites", { email: o.user.email })).status).toBe(409);
    expect((await o.api("POST", "/api/people/invites", { email: "not-an-email" })).status).toBe(422);
    expect((await o.api("POST", "/api/people/invites", { email: "a@b.co", extra: 1 })).status).toBe(422);
  });

  it("limits invitations to twenty a day", async () => {
    const o = await owner();
    for (let i = 0; i < 20; i++) expect((await o.api("POST", "/api/people/invites", { email: uniqueEmail() })).status).toBe(201);
    expect((await o.api("POST", "/api/people/invites", { email: uniqueEmail() })).status).toBe(429);
  });

  it("still succeeds, and says so, when the email cannot be sent", async () => {
    const o = await owner();
    const original = o.app.sentEmails.push.bind(o.app.sentEmails);
    o.app.sentEmails.push = () => {
      throw new Error("smtp down");
    };
    const res = await o.api("POST", "/api/people/invites", { email: uniqueEmail() });
    o.app.sentEmails.push = original;
    expect(res.status).toBe(201);
    expect(res.json.emailed).toBe(false);
  });
});

describe("the owner only", () => {
  it("everything under /api/people is forbidden to other people", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    expect((await m.api("GET", "/api/people")).status).toBe(403);
    expect((await m.api("POST", "/api/people/invites", { email: uniqueEmail() })).status).toBe(403);
    expect((await m.api("POST", `/api/people/${o.user.id}/disable`)).status).toBe(403);
    expect((await m.api("DELETE", `/api/people/${o.user.id}`)).status).toBe(403);
    expect((await makeApp().call("GET", "/api/people")).status).toBe(401);
  });

  it("the owner cannot remove themselves", async () => {
    const o = await owner();
    expect((await o.api("POST", `/api/people/${o.user.id}/disable`)).status).toBe(409);
    expect((await o.api("DELETE", `/api/people/${o.user.id}`)).status).toBe(409);
    expect((await o.api("GET", "/api/me")).status).toBe(200);
  });
});

describe("removing access", () => {
  it("ends their session at once and refuses new codes, keeping their data", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    await m.api("POST", "/api/accounts", { kind: "bank", name: "Mine", openingBalancePaise: 100_00 });
    expect((await o.api("POST", `/api/people/${m.id}/disable`)).status).toBe(200);

    expect((await m.api("GET", "/api/me")).status).toBe(401);
    const before = o.app.sentEmails.length;
    await o.app.call("POST", "/api/auth/request-code", { body: { email: m.email, channel: "email" } });
    expect(o.app.sentEmails.length).toBe(before);
    expect(await db.select().from(accounts).where(eq(accounts.userId, m.id))).toHaveLength(1);
    const listed = ((await o.api("GET", "/api/people")).json.members as Json[]).find((x) => x.id === m.id);
    expect(listed?.disabled).toBe(true);
  });

  it("a code that was already sent no longer signs them in", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    await o.app.call("POST", "/api/auth/request-code", { body: { email: m.email, channel: "email" } });
    const code = /\b(\d{6})\b/.exec(o.app.sentEmails.at(-1)!.text)![1];
    await o.api("POST", `/api/people/${m.id}/disable`);
    const res = await o.app.call("POST", "/api/auth/verify-code", { body: { email: m.email, code } });
    expect(res.status).toBe(400);
  });

  it("restoring access lets them sign in again with their data intact", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    await m.api("POST", "/api/accounts", { kind: "bank", name: "Mine", openingBalancePaise: 100_00 });
    await o.api("POST", `/api/people/${m.id}/disable`);
    await o.api("POST", `/api/people/${m.id}/enable`);
    const again = client(o.app, await login(o.app, m.email));
    expect(((await again("GET", "/api/accounts")).json.items as Json[]).map((a) => a.name)).toEqual(["Mine"]);
  });

  it("the bot goes quiet for someone whose access was removed, and returns when restored", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    const chat = await linkTelegram(m.id);
    const say = (text: string, id: number) =>
      o.app.call("POST", "/telegram/webhook", {
        body: { update_id: id, message: { message_id: id, chat: { id: chat, type: "private" }, text } },
        headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
        csrf: false,
      });
    await o.api("POST", `/api/people/${m.id}/disable`);
    await say("/balance", 9_100_001);
    expect(o.app.telegram.messages.filter((x) => x.chatId === chat)).toHaveLength(0);
    await o.api("POST", `/api/people/${m.id}/enable`);
    await say("/balance", 9_100_002);
    expect(o.app.telegram.messages.filter((x) => x.chatId === chat).length).toBeGreaterThan(0);
  });

  it("is 404 for an unknown person", async () => {
    const o = await owner();
    expect((await o.api("POST", "/api/people/nobody/disable")).status).toBe(404);
    expect((await o.api("POST", "/api/people/nobody/enable")).status).toBe(404);
    expect((await o.api("DELETE", "/api/people/nobody")).status).toBe(404);
  });
});

describe("deleting a person's data", () => {
  it("is refused while they still have access", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    expect((await o.api("DELETE", `/api/people/${m.id}`)).status).toBe(409);
    expect(await db.select().from(users).where(eq(users.id, m.id))).toHaveLength(1);
  });

  it("removes everything they own and nothing of anyone else's", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    const bystander = await invitedMember(o);
    const bank = (await m.api("POST", "/api/accounts", { kind: "bank", name: "Mine", openingBalancePaise: 100_00 })).json;
    const cat = ((await m.api("GET", "/api/categories")).json.items as Json[])[0]!;
    await m.api("POST", "/api/transactions", { type: "expense", amountPaise: 10_00, txnDate: "2026-10-05", accountId: bank.id, categoryId: cat.id });
    await m.api("PUT", `/api/budgets/${cat.id}`, { limitPaise: 1_000_00 });
    await bystander.api("POST", "/api/accounts", { kind: "bank", name: "Theirs", openingBalancePaise: 5_00 });
    await linkTelegram(m.id);

    await o.api("POST", `/api/people/${m.id}/disable`);
    expect((await o.api("DELETE", `/api/people/${m.id}`)).status).toBe(204);

    expect(await db.select().from(users).where(eq(users.id, m.id))).toHaveLength(0);
    expect(await db.select().from(accounts).where(eq(accounts.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(categories).where(eq(categories.userId, m.id))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, m.id))).toHaveLength(0);
    expect(((await bystander.api("GET", "/api/accounts")).json.items as Json[]).map((a) => a.name)).toEqual(["Theirs"]);
    expect(((await bystander.api("GET", "/api/categories")).json.items as Json[]).length).toBeGreaterThan(20);
  });

  it("does not let the deleted person back in, until they are invited again", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    await o.api("POST", `/api/people/${m.id}/disable`);
    await o.api("DELETE", `/api/people/${m.id}`);
    const before = o.app.sentEmails.length;
    await o.app.call("POST", "/api/auth/request-code", { body: { email: m.email, channel: "email" } });
    expect(o.app.sentEmails.length).toBe(before);

    expect((await o.api("POST", "/api/people/invites", { email: m.email })).status).toBe(201);
    const fresh = client(o.app, await login(o.app, m.email));
    expect(((await fresh("GET", "/api/accounts")).json.items as Json[])).toHaveLength(0);
    expect((await db.select().from(invites).where(eq(invites.email, m.email)))[0]?.acceptedAt).not.toBeNull();
  });
});

describe("first-run setup flag", () => {
  it("a new member needs setup until they finish or skip it", async () => {
    const o = await owner();
    const m = await invitedMember(o);
    expect((await m.api("GET", "/api/me")).json.needsSetup).toBe(true);
    const done = await m.api("POST", "/api/me/onboarded");
    expect(done.status).toBe(200);
    expect(done.json.needsSetup).toBe(false);
    expect((await m.api("GET", "/api/me")).json.needsSetup).toBe(false);
  });

  it("is per person", async () => {
    const o = await owner();
    const a = await invitedMember(o);
    const b = await invitedMember(o);
    await a.api("POST", "/api/me/onboarded");
    expect((await b.api("GET", "/api/me")).json.needsSetup).toBe(true);
  });
});

describe("invitationMessages", () => {
  it("carries the link and escapes the inviter's name", () => {
    const m = invitationMessages({ inviterName: "<b>Kal</b> & Co", siteUrl: "https://alfred.example.dev", email: "a@b.co", now: new Date() });
    expect(m.subject).toBe("An invitation from <b>Kal</b> & Co");
    expect(m.text).toContain("https://alfred.example.dev");
    expect(m.html).toContain("&lt;b&gt;Kal&lt;/b&gt; &amp; Co");
    expect(m.html).not.toContain("<b>Kal</b>");
    expect(m.html).toContain('href="https://alfred.example.dev/#invite=a%40b.co"');
  });

  const base = { inviterName: "Kalind", siteUrl: "https://alfred.example.dev", email: "priya@example.com", now: new Date() };

  it("the button says Open ledger and the link names the invited address", () => {
    const m = invitationMessages(base);
    expect(m.html).toContain(">Open ledger</a>");
    expect(m.html).not.toContain("Open Alfred");
    expect(m.html).toContain('href="https://alfred.example.dev/#invite=priya%40example.com"');
    expect(m.text).toContain("    https://alfred.example.dev/#invite=priya%40example.com\n");
  });

  it("does not double a trailing slash on the site address", () => {
    expect(invitationMessages({ ...base, siteUrl: "https://alfred.example.dev/" }).text).toContain("dev/#invite=");
  });

  it("greets by name when there is one, and plainly when there is not", () => {
    expect(invitationMessages({ ...base, name: "Priya" }).text.startsWith("Good day, Priya.\n")).toBe(true);
    expect(invitationMessages({ ...base, name: "Priya" }).html).toContain(">Good day, Priya.</p>");
    for (const name of [undefined, null, "", "   "]) {
      expect(invitationMessages({ ...base, name }).text.startsWith("Good day.\n")).toBe(true);
    }
  });

  it("escapes the invitee's name", () => {
    const m = invitationMessages({ ...base, name: "<i>Pri</i>" });
    expect(m.html).toContain("Good day, &lt;i&gt;Pri&lt;/i&gt;.");
    expect(m.html).not.toContain("<i>Pri</i>");
  });

  it("speaks as Alfred, says the ledger is private to him, and does not single out the inviter", () => {
    const m = invitationMessages({ ...base, name: "Priya" });
    expect(m.text).toContain("Kalind has arranged for you to have a ledger of your own");
    expect(m.text).toContain("I am Alfred");
    expect(m.text).toContain("visible to no one but me");
    expect(m.text).not.toMatch(/Kalind (cannot|will not|can't)/);
    expect(m.text).toContain("At your service,\nAlfred");
    expect(m.text).not.toContain("!");
    expect(m.text).not.toContain("use me");
  });
});

describe("inviting with a name", () => {
  it("greets them by name in the email and starts their setup with that name", async () => {
    const o = await owner();
    const email = uniqueEmail();
    const res = await o.api("POST", "/api/people/invites", { email, name: "  Priya " });
    expect(res.status).toBe(201);
    expect(res.json.invite.name).toBe("Priya");
    expect(o.app.sentEmails.find((m) => m.to === email)?.text.startsWith("Good day, Priya.\n")).toBe(true);
    expect(((await o.api("GET", "/api/people")).json.invites as Json[]).find((i) => i.email === email)?.name).toBe("Priya");

    const member = client(o.app, await login(o.app, email));
    expect((await member("GET", "/api/me")).json.displayName).toBe("Priya");
  });

  it("without a name, the greeting is plain and their name comes from the email", async () => {
    const o = await owner();
    const email = uniqueEmail();
    await o.api("POST", "/api/people/invites", { email, name: "" });
    expect(o.app.sentEmails.find((m) => m.to === email)?.text.startsWith("Good day.\n")).toBe(true);
    const member = client(o.app, await login(o.app, email));
    expect((await member("GET", "/api/me")).json.needsSetup).toBe(true);
  });

  it("inviting again can change the name, and keeps it when none is given", async () => {
    const o = await owner();
    const email = uniqueEmail();
    await o.api("POST", "/api/people/invites", { email, name: "Pri" });
    await o.api("POST", "/api/people/invites", { email });
    expect(((await o.api("GET", "/api/people")).json.invites as Json[]).find((i) => i.email === email)?.name).toBe("Pri");
    await o.api("POST", "/api/people/invites", { email, name: "Priya" });
    expect(((await o.api("GET", "/api/people")).json.invites as Json[]).find((i) => i.email === email)?.name).toBe("Priya");
  });

  it("rejects a name over 40 characters", async () => {
    const o = await owner();
    expect((await o.api("POST", "/api/people/invites", { email: uniqueEmail(), name: "x".repeat(41) })).status).toBe(422);
  });
});
