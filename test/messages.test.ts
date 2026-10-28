import { describe, expect, it } from "vitest";
import { escapeHtml, loginCodeMessages } from "../src/alfred/messages";
import { extractCode, linkTelegram, makeApp, registeredUser } from "./api-helpers";

const EVENING = new Date("2026-10-27T14:00:00Z"); // 19:30 IST, the 27th
const input = { name: "Kalind", code: "482913", now: EVENING, ttlMinutes: 5 };

describe("loginCodeMessages", () => {
  it("greets by name and gives the code once, in Alfred's voice", () => {
    const m = loginCodeMessages(input);
    expect(m.subject).toBe("Your Alfred sign-in code");
    expect(m.text).toContain("Good evening, Kalind.");
    expect(m.text).toContain("expires in five minutes");
    expect(m.text.match(/482913/g)).toHaveLength(1);
    expect(m.text.trim().endsWith("Alfred")).toBe(true);
  });

  it("keeps the code out of the subject so it does not show on lock screens or in notifications", () => {
    expect(loginCodeMessages(input).subject).not.toContain("482913");
  });

  it("the plain-text body keeps the code as one unbroken run of digits so autofill can find it", () => {
    expect(extractCode(loginCodeMessages(input).text)).toBe("482913");
  });

  it("the telegram version is short and carries the same facts", () => {
    const m = loginCodeMessages(input);
    expect(m.telegram).toBe("Good evening, Kalind. Your sign-in code is 482913. It works once and expires in five minutes. If that was not you, simply ignore this.");
    expect(m.telegram.length).toBeLessThan(m.text.length);
  });

  it("the HTML version carries the same greeting, code and expiry as the text", () => {
    const m = loginCodeMessages(input);
    expect(m.html).toContain("Good evening, Kalind.");
    expect(m.html).toContain("482913");
    expect(m.html).toContain("five minutes");
    expect(m.html).toContain("Alfred");
  });

  it("says sir only on the fixed days, like the rest of Alfred's greetings", () => {
    const on21st = loginCodeMessages({ ...input, now: new Date("2026-10-21T14:00:00Z") });
    expect(on21st.text).toContain("Good evening, sir.");
    expect(on21st.telegram).toContain("Good evening, sir.");
  });

  it("words other lifetimes sensibly", () => {
    expect(loginCodeMessages({ ...input, ttlMinutes: 10 }).text).toContain("ten minutes");
    expect(loginCodeMessages({ ...input, ttlMinutes: 7 }).text).toContain("7 minutes");
  });

  it("escapes anything user-controlled in the HTML, so a name can never inject markup", () => {
    const m = loginCodeMessages({ ...input, name: `<script>alert("x")</script> & Co`, now: new Date("2026-10-21T04:00:00Z") });
    expect(m.html).not.toContain("<script>");
    // the greeting uses "sir" on the 21st, so check a day when the name is shown
    const named = loginCodeMessages({ ...input, name: `<img src=x onerror="y"> & Co` });
    expect(named.html).not.toContain("<img");
    expect(named.html).toContain("&lt;img");
    expect(named.html).toContain("&amp; Co");
  });

  it("loads nothing from the network: no images, scripts, stylesheets or tracking links", () => {
    const { html } = loginCodeMessages(input);
    expect(html).not.toMatch(/<img|<script|<link|<iframe|src=|href=|url\(http/i);
  });

  it("escapeHtml handles all five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("sign-in messages as sent by the app", () => {
  it("emails the styled message with a plain-text alternative", async () => {
    const app = makeApp();
    const user = await registeredUser();
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    const sent = app.sentEmails[0]!;
    expect(sent.subject).toBe("Your Alfred sign-in code");
    expect(sent.text).toMatch(/Good (morning|afternoon|evening), \S+\./);
    expect(sent.html).toContain("<!doctype html>");
    expect(extractCode(sent.html!.replace(/<[^>]+>/g, " "))).toBe(extractCode(sent.text));
  });

  it("uses the saved display name", async () => {
    const app = makeApp();
    const user = await registeredUser();
    const { db } = await import("./helpers");
    const { appSettings } = await import("../src/db/schema");
    await db.insert(appSettings).values({ userId: user.id, displayName: "Kalind" });
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    expect(app.sentEmails[0]!.text).toMatch(/Kalind\.|sir\./);
  });

  it("sends the short version to Telegram", async () => {
    const app = makeApp();
    const user = await registeredUser();
    await linkTelegram(user.id);
    await app.call("POST", "/api/auth/request-code", { body: { email: user.email } });
    expect(app.sentEmails).toHaveLength(0);
    expect(app.sentTelegram[0]!.text).toContain("Your sign-in code is");
    expect(app.sentTelegram[0]!.text).not.toContain("\n");
  });
});
