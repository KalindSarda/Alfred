import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loginCodes, sessions } from "../src/db/schema";
import { CODE_TTL_SECONDS } from "../src/services/auth";
import { nameFromEmail } from "../src/services/settings";
import { cookieFrom, extractCode, linkTelegram, login, makeApp, registeredUser, uniqueEmail } from "./api-helpers";
import { db } from "./helpers";

const json = async (res: Response) => (await res.json()) as Record<string, any>;

describe("request-code", () => {
  it("emails a 6-digit code to a registered user with no Telegram link", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const res = await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ ok: true });
    expect(app.sentEmails).toHaveLength(1);
    expect(app.sentEmails[0]?.to).toBe(user.email);
    expect(extractCode(app.sentEmails[0]!.text)).toMatch(/^\d{6}$/);
    expect(app.sentTelegram).toHaveLength(0);
  });

  it("uses Telegram by default when a chat is linked, and email when asked", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const chatId = await linkTelegram(user.id);

    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    expect(app.sentTelegram).toEqual([{ chatId, text: expect.stringContaining("sign-in code") }]);
    expect(app.sentEmails).toHaveLength(0);

    await app.call("POST", "/api/auth/request-code", { body: { email: user.email, channel: "email" } });
    expect(app.sentEmails).toHaveLength(1);
  });

  it("gives an identical response for an unknown email and sends nothing", async () => {
    const app = makeApp();
    const known = await registeredUser();
    const a = await app.call("POST", "/api/auth/request-code", { body: { email: known.email } });
    const b = await app.call("POST", "/api/auth/request-code", { body: { email: uniqueEmail() } });
    expect(b.status).toBe(a.status);
    expect(await json(b)).toEqual(await json(a));
    expect(app.sentEmails).toHaveLength(1);
  });

  it("is case-insensitive on the email", async () => {
    const app = makeApp();
    const user = await registeredUser();
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email.toUpperCase() } });
    expect(app.sentEmails).toHaveLength(1);
  });

  it("stores only a hash of the code", async () => {
    const app = makeApp();
    const user = await registeredUser();
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    const code = extractCode(app.sentEmails[0]!.text);
    const rows = await db.select().from(loginCodes).where(eq(loginCodes.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("still answers 202 when delivery fails", async () => {
    const app = makeApp();
    const user = await registeredUser();
    await linkTelegram(user.id);
    app.failTelegram();
    const res = await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    expect(res.status).toBe(202);
  });

  it("rejects malformed bodies with the validation envelope", async () => {
    const app = makeApp();
    const bad = await app.call("POST", "/api/auth/request-code", { body: { email: "not-an-email" } });
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.code).toBe("validation_failed");
    const notJson = await app.call("POST", "/api/auth/request-code", { body: "{oops" });
    expect(notJson.status).toBe(422);
  });

  it("rate-limits per email (5 per hour) and sets Retry-After", async () => {
    const app = makeApp();
    const user = await registeredUser();
    for (let i = 0; i < 5; i++) {
      expect((await app.call("POST", "/api/auth/request-code", { body: { email: user.email } })).status).toBe(202);
    }
    const blocked = await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await json(blocked)).error.code).toBe("rate_limited");
    expect(app.sentEmails).toHaveLength(5);
  });

  it("rate-limits unknown emails too, so limits cannot be used to probe accounts", async () => {
    const app = makeApp();
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) await app.call("POST", "/api/auth/request-code", { body: { email } });
    expect((await app.call("POST", "/api/auth/request-code", { body: { email } })).status).toBe(429);
  });

  it("rate-limits per IP (20 per hour) across different emails", async () => {
    const app = makeApp();
    for (let i = 0; i < 20; i++) {
      await app.call("POST", "/api/auth/request-code", { body: { email: uniqueEmail() }, ip: "203.0.113.9" });
    }
    const blocked = await app.call("POST", "/api/auth/request-code", { body: { email: uniqueEmail() }, ip: "203.0.113.9" });
    expect(blocked.status).toBe(429);
  });

  it("the limit window resets after an hour", async () => {
    const app = makeApp();
    const user = await registeredUser();
    for (let i = 0; i < 6; i++) await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    app.advance(3600 * 1000 + 1000);
    expect((await app.call("POST", "/api/auth/request-code", { body: { email: user.email } })).status).toBe(202);
  });
});

describe("verify-code", () => {
  async function requested() {
    const app = makeApp();
    const user = await registeredUser();
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    return { app, user, code: extractCode(app.sentEmails[0]!.text) };
  }

  it("issues an HttpOnly, Secure, SameSite=Lax 30-day session cookie", async () => {
    const { app, user, code } = await requested();
    const res = await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } });
    expect(res.status).toBe(200);
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/^sid=/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toContain(`Max-Age=${30 * 86400}`);
    expect((await json(res)).user).toMatchObject({ id: user.id, email: user.email, telegramLinked: false });
  });

  it("stores only a hash of the session token", async () => {
    const { app, user, code } = await requested();
    const res = await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } });
    const token = cookieFrom(res).slice("sid=".length);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("a code works once", async () => {
    const { app, user, code } = await requested();
    expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } })).status).toBe(200);
    const again = await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } });
    expect(again.status).toBe(400);
    expect((await json(again)).error.code).toBe("invalid_code");
  });

  it("a code expires after 5 minutes", async () => {
    const { app, user, code } = await requested();
    app.advance((CODE_TTL_SECONDS + 1) * 1000);
    expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } })).status).toBe(400);
  });

  it("a code is still valid just before expiry", async () => {
    const { app, user, code } = await requested();
    app.advance((CODE_TTL_SECONDS - 1) * 1000);
    expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } })).status).toBe(200);
  });

  it("locks the code after 5 wrong attempts, even if the right code follows", async () => {
    const { app, user, code } = await requested();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code: wrong } })).status).toBe(400);
    }
    expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code } })).status).toBe(400);
  });

  it("a newly requested code replaces the previous one", async () => {
    const { app, user, code: first } = await requested();
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    const second = extractCode(app.sentEmails[1]!.text);
    if (second !== first) {
      expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code: first } })).status).toBe(400);
    }
    expect((await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code: second } })).status).toBe(200);
  });

  it("fails identically for an unknown email and a wrong code", async () => {
    const { app, user, code } = await requested();
    const wrong = code === "123456" ? "654321" : "123456";
    const unknown = await app.call("POST", "/api/auth/verify-code", { body: { email: uniqueEmail(), code: wrong } });
    const wrongCode = await app.call("POST", "/api/auth/verify-code", { body: { email: user.email, code: wrong } });
    expect(unknown.status).toBe(400);
    expect(await json(unknown)).toEqual(await json(wrongCode));
  });

  it("validates the code format", async () => {
    const app = makeApp();
    const res = await app.call("POST", "/api/auth/verify-code", { body: { email: uniqueEmail(), code: "12ab" } });
    expect(res.status).toBe(422);
  });

  it("rate-limits verification per IP (30 per 15 minutes)", async () => {
    const app = makeApp();
    for (let i = 0; i < 30; i++) {
      await app.call("POST", "/api/auth/verify-code", { body: { email: uniqueEmail(), code: "123456" }, ip: "198.51.100.7" });
    }
    const blocked = await app.call("POST", "/api/auth/verify-code", {
      body: { email: uniqueEmail(), code: "123456" },
      ip: "198.51.100.7",
    });
    expect(blocked.status).toBe(429);
  });
});

describe("sessions", () => {
  it("GET /api/me works with the cookie and reflects Telegram linking", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const res = await app.call("GET", "/api/me", { cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      id: user.id,
      email: user.email,
      displayName: nameFromEmail(user.email),
      telegramLinked: false,
      settings: { nudgeLeadDays: 3, nudgeTimeIst: "10:00" },
    });
    await linkTelegram(user.id);
    expect((await json(await app.call("GET", "/api/me", { cookie }))).telegramLinked).toBe(true);
  });

  it("rejects a missing, tampered or unknown cookie", async () => {
    const app = makeApp();
    expect((await app.call("GET", "/api/me")).status).toBe(401);
    expect((await app.call("GET", "/api/me", { cookie: "sid=garbage" })).status).toBe(401);
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    expect((await app.call("GET", "/api/me", { cookie: `${cookie}x` })).status).toBe(401);
  });

  it("expires after 30 days", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    app.advance(29 * 86_400_000);
    expect((await app.call("GET", "/api/me", { cookie })).status).toBe(200);
    app.advance(2 * 86_400_000);
    expect((await app.call("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("logout ends only the current session", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const phone = await login(app, user.email);
    const laptop = await login(app, user.email);
    const res = await app.call("POST", "/api/auth/logout", { cookie: phone });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sid=;|Max-Age=0|Expires=/);
    expect((await app.call("GET", "/api/me", { cookie: phone })).status).toBe(401);
    expect((await app.call("GET", "/api/me", { cookie: laptop })).status).toBe(200);
  });

  it("log out everywhere ends every session of that user but not other users'", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const other = await registeredUser();
    const phone = await login(app, user.email);
    const laptop = await login(app, user.email);
    const othersCookie = await login(app, other.email);
    expect((await app.call("POST", "/api/auth/logout-all", { cookie: phone })).status).toBe(200);
    expect((await app.call("GET", "/api/me", { cookie: phone })).status).toBe(401);
    expect((await app.call("GET", "/api/me", { cookie: laptop })).status).toBe(401);
    expect((await app.call("GET", "/api/me", { cookie: othersCookie })).status).toBe(200);
  });
});

describe("access control", () => {
  it("every /api route except health and the two public auth routes needs a session", async () => {
    const app = makeApp();
    const protectedRoutes: [string, string][] = [
      ["GET", "/api/me"],
      ["POST", "/api/auth/logout"],
      ["POST", "/api/auth/logout-all"],
      ["GET", "/api/anything-else"],
      ["DELETE", "/api/transactions/x"],
    ];
    for (const [method, path] of protectedRoutes) {
      const res = await app.call(method, path, method === "GET" ? {} : { body: {} });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect((await json(res)).error.code).toBe("unauthenticated");
    }
    expect((await app.call("GET", "/api/health")).status).toBe(200);
  });

  it("there is no public signup route", async () => {
    const app = makeApp();
    for (const path of ["/api/auth/register", "/api/auth/signup", "/api/users"]) {
      expect((await app.call("POST", path, { body: { email: uniqueEmail() } })).status).toBe(401);
    }
  });
});

describe("CSRF guard", () => {
  it("rejects state-changing requests without the custom header", async () => {
    const app = makeApp();
    const res = await app.call("POST", "/api/auth/request-code", { body: { email: uniqueEmail() }, csrf: false });
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("csrf_failed");
  });

  it("rejects non-JSON content types such as form posts", async () => {
    const app = makeApp();
    const res = await app.call("POST", "/api/auth/request-code", {
      body: "email=a@b.co",
      contentType: "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(403);
    const plain = await app.call("POST", "/api/auth/request-code", { body: "{}", contentType: "text/plain" });
    expect(plain.status).toBe(403);
  });

  it("does not require the header for GET", async () => {
    const app = makeApp();
    expect((await app.call("GET", "/api/health", { csrf: false })).status).toBe(200);
  });

  it("applies to authenticated mutations as well", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const cookie = await login(app, user.email);
    const res = await app.call("POST", "/api/auth/logout-all", { cookie, csrf: false });
    expect(res.status).toBe(403);
    expect((await app.call("GET", "/api/me", { cookie })).status).toBe(200);
  });
});
