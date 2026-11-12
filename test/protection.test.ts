import { describe, expect, it } from "vitest";
import { runInsuranceReminders } from "../src/services/insuranceJob";
import { world } from "./bot/harness";
import { db } from "./helpers";

type W = Awaited<ReturnType<typeof world>>;
type Json = Record<string, any>;

// The test clock is 2026-10-27.
const view = async (w: W) => (await w.api("GET", "/api/protection")).json as Json;
const policy = (w: W, body: object = {}) => w.api("POST", "/api/insurance", { kind: "health", insurer: "Acme Health", coverPaise: 10_00_000_00, premiumPaise: 25_000_00, frequency: "yearly", renewalDate: "2026-11-20", ...body });
const gapKeys = (v: Json) => v.gaps.map((g: Json) => g.key);
const remind = (w: W, date: string) => runInsuranceReminders({ db, telegram: w.tg, now: () => Date.parse(`${date}T05:00:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));

describe("the protection check", () => {
  it("starts with open questions and no cover", async () => {
    const w = await world();
    const v = await view(w);
    expect(v.profile).toEqual({ dependants: "unknown", employerHealth: "unknown" });
    expect(gapKeys(v)).toEqual(["health_missing", "questions"]);
  });

  it("changes the gaps with the answers: work cover ends with the job, and dependants bring term cover", async () => {
    const w = await world();
    const res = await w.api("PUT", "/api/protection/profile", { dependants: "yes", employerHealth: "yes" });
    expect(res.status).toBe(200);
    const v = res.json as Json;
    expect(gapKeys(v)).toEqual(["health_missing", "term_missing"]);
    expect(v.gaps[0].detail).toContain("Cover through work");
    // A partial update keeps the other answer.
    await w.api("PUT", "/api/protection/profile", { dependants: "no" });
    expect((await view(w)).profile).toEqual({ dependants: "no", employerHealth: "yes" });
    expect((await w.api("PUT", "/api/protection/profile", { dependants: "maybe" })).status).toBe(422);
  });

  it("closes the health gap with a personal policy, but not with cover through work or a lapsed policy", async () => {
    const w = await world();
    await w.api("PUT", "/api/protection/profile", { dependants: "no", employerHealth: "yes" });
    await policy(w, { source: "employer", premiumPaise: 9_999_00 });
    expect(gapKeys(await view(w))).toEqual(["health_missing"]);

    const mine1 = (await policy(w)).json as Json;
    expect(mine1).toMatchObject({ kind: "health", source: "personal", nextDueDate: "2026-11-20", daysToDue: 24, status: "active" });
    const v = await view(w);
    expect(gapKeys(v)).toEqual([]);
    // Cover through work has no premium of yours.
    expect(v.yearlyPremiumPaise).toBe(25_000_00);
    expect(v.policies.find((p: Json) => p.source === "employer").premiumPaise).toBe(0);

    await w.api("PATCH", `/api/insurance/${mine1.id}`, { status: "lapsed" });
    expect(gapKeys(await view(w))).toEqual(["health_missing"]);
  });

  it("totals the premiums a year across frequencies", async () => {
    const w = await world();
    await policy(w, { premiumPaise: 2_000_00, frequency: "monthly" });
    await policy(w, { kind: "term", insurer: "Beta Life", premiumPaise: 6_000_00, frequency: "half_yearly" });
    expect((await view(w)).yearlyPremiumPaise).toBe(24_000_00 + 12_000_00);
  });

  it("validates policies and keeps one person's apart from another's", async () => {
    const w = await world();
    const other = await world();
    expect((await policy(w, { renewalDate: "2026-02-30" })).status).toBe(422);
    expect((await policy(w, { coverPaise: -1 })).status).toBe(422);
    expect((await policy(w, { insurer: "" })).status).toBe(422);
    const p = (await policy(w)).json as Json;
    expect((await other.api("PATCH", `/api/insurance/${p.id}`, { coverPaise: 1 })).status).toBe(404);
    expect((await other.api("DELETE", `/api/insurance/${p.id}`)).status).toBe(404);
    expect((await view(other)).policies).toEqual([]);
    expect((await w.api("DELETE", `/api/insurance/${p.id}`)).status).toBe(204);
    expect((await view(w)).policies).toEqual([]);
  });

  it("lists a premium among the commitments before the next salary, and takes it off free-to-spend", async () => {
    const w = await world();
    const before = (await w.api("GET", "/api/commitments")).json as Json;
    await policy(w, { renewalDate: "2026-10-30", premiumPaise: 25_000_00 });
    const after = (await w.api("GET", "/api/commitments")).json as Json;
    expect(after.items.find((i: Json) => i.source === "insurance")).toMatchObject({ title: "Acme Health premium", amountPaise: 25_000_00, date: "2026-10-30", counted: false });
    expect(after.freeToSpendPaise).toBe(before.freeToSpendPaise - 25_000_00);
  });
});

describe("renewal reminders", () => {
  it("reminds a week ahead and on the day, once each, for personal policies only", async () => {
    const w = await world();
    await policy(w, { renewalDate: "2026-11-02" });
    await policy(w, { kind: "term", insurer: "Work Group", source: "employer", renewalDate: "2026-11-02" });
    await remind(w, "2026-10-25");
    expect(mine(w)).toHaveLength(0);

    await remind(w, "2026-10-27");
    await remind(w, "2026-10-27");
    expect(mine(w)).toHaveLength(1);
    expect(mine(w)[0]?.text).toContain("health policy with Acme Health is due in 6 days");
    expect(mine(w)[0]?.text).toContain("₹25,000");

    await remind(w, "2026-11-02");
    await remind(w, "2026-11-02");
    expect(mine(w)).toHaveLength(2);
    expect(mine(w)[1]?.text).toContain("due today");
  });

  it("skips lapsed policies and follows a yearly policy to its next renewal", async () => {
    const w = await world();
    const p = (await policy(w, { renewalDate: "2025-11-01" })).json as Json;
    await remind(w, "2026-10-27");
    expect(mine(w)).toHaveLength(1);
    await w.api("PATCH", `/api/insurance/${p.id}`, { status: "lapsed" });
    await remind(w, "2026-10-31");
    expect(mine(w)).toHaveLength(1);
  });
});
