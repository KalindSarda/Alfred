import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { withReadCache } from "../src/db/readCache";
import { checkinLog, telegramLinks } from "../src/db/schema";
import { todayIst } from "../src/domain/dates";
import { CRON_GROUPS, MORNING_REVIEW_CRON } from "../src/services/cronPlan";
import { getCommitments } from "../src/services/commitments";
import { getEmergencyFund } from "../src/services/emergency";
import { getFire } from "../src/services/fire";
import { getHealth } from "../src/services/health";
import { getLadder } from "../src/services/ladder";
import { listAccountsWithFigures, getSafeToSpend } from "../src/services/ledger";
import { MAX_SYMBOLS } from "../src/services/prices/refresh";
import { buildSalaryPlan } from "../src/services/salary";
import { USER_CAP } from "../src/services/userCap";
import { db } from "./helpers";
import { realisticUser, runScheduledCounted } from "./queryCount";

/**
 * The Workers Free budget, as a permanent test (HOW-WE-WORK: every scheduled job needs one): each cron invocation may make at
 * most 50 D1 queries and 50 outside fetches. Queries are counted the way Cloudflare's D1 limits page counts them: a whole
 * `batch()` is one query. The aim is 40 or fewer, to leave room for a person with more data than the sample life.
 *
 * Add a job to `src/services/cronPlan.ts` and this test covers it with no change here. If it fails after you add a job or a
 * read, lower a cap in `src/services/userCap.ts`, move the job to a lighter run, or batch its reads.
 */
const LIMIT = 50;
const AIM = 40;
const CRONS = Object.keys(CRON_GROUPS);

async function users(n: number, today = "2026-11-26") {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await realisticUser(today));
  return ids;
}

/** Runs every cron expression for a day, in the order they fire, and returns what each cost. */
async function day(iso: string) {
  const out: Record<string, { queries: number; strict: number; fetches: number }> = {};
  for (const cron of CRONS) {
    const [minute, hour] = cron.split(" ");
    const r = await runScheduledCounted(cron, iso, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
    out[cron] = { queries: r.queries, strict: r.strict, fetches: r.fetches.length };
  }
  return out;
}

const worst = (r: Awaited<ReturnType<typeof day>>) => Math.max(...Object.values(r).map((v) => v.queries));

function expectUnder(label: string, r: Awaited<ReturnType<typeof day>>, limit: number) {
  for (const [cron, v] of Object.entries(r)) {
    expect(v.queries, `${label}: "${cron}" made ${v.queries} D1 queries`).toBeLessThan(limit);
    expect(v.fetches, `${label}: "${cron}" made ${v.fetches} outside fetches`).toBeLessThan(LIMIT);
  }
}

describe("cron query budget (Workers Free: 50 D1 queries, 50 fetches per invocation)", () => {
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it.each([
    ["an ordinary Friday", "2026-11-27"],
    ["a Saturday (weekly price refresh)", "2026-11-28"],
    ["a Sunday (weekly balance check)", "2026-11-29"],
  ])("one realistic user, %s: every run under 40", async (label, iso) => {
    await users(1);
    expectUnder(`${label}, first run`, await day(iso), AIM + 1);
    expectUnder(`${label}, repeat`, await day(iso), AIM + 1);
  });

  it("one user on the 1st of the month (salary plan, monthly review and the nudge all due): every run under 40", async () => {
    await users(1);
    const first = await day("2026-12-01");
    console.log(`BUDGET 1 user, 1st: ${Object.entries(first).map(([c, v]) => `${c}=${v.queries}q (${v.strict} statements)`).join("  ")}`);
    expectUnder("1st", first, AIM + 1);
  });

  it("two users on the 1st of the month, and the days after: every run 40 or fewer", async () => {
    await users(2);
    for (const iso of ["2026-12-01", "2026-12-02", "2026-12-03"]) {
      const r = await day(iso);
      console.log(`BUDGET 2 users ${iso}: ${Object.entries(r).map(([c, v]) => `${c}=${v.queries}q/${v.fetches}f`).join("  ")}`);
      expectUnder(`2 users ${iso}`, r, AIM + 1);
    }
  });

  it("many users: the per-run cap keeps every run under 50 however many are invited", async () => {
    await users(8);
    let high = 0;
    for (const iso of ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]) {
      const r = await day(iso);
      console.log(`BUDGET 8 users ${iso}: ${Object.entries(r).map(([c, v]) => `${c}=${v.queries}q/${v.fetches}f`).join("  ")}`);
      expectUnder(`8 users ${iso}`, r, LIMIT);
      high = Math.max(high, worst(r));
    }
    // Heavier than the aim because eight people on one morning is more than the caps are tuned for; still well inside the limit.
    expect(high).toBeLessThanOrEqual(LIMIT - 5);
  });

  it("a person left out by the cap on the 1st still gets the monthly review on a later morning, once", async () => {
    const ids = await users(2);
    const reviewsOf = async () => (await db.select({ userId: checkinLog.userId, day: checkinLog.day }).from(checkinLog).where(and(eq(checkinLog.kind, "review"), inArray(checkinLog.userId, ids)))).sort((a, b) => a.userId.localeCompare(b.userId));

    await runScheduledCounted(MORNING_REVIEW_CRON, "2026-12-01", "04:40:00");
    expect(await reviewsOf(), "the cap is one review a run, so one person waits").toHaveLength(1);
    const pending = await db.select().from(checkinLog).where(and(eq(checkinLog.kind, "review_pending"), inArray(checkinLog.userId, ids)));
    expect(pending, "the person left out is marked, not dropped").toHaveLength(1);

    await runScheduledCounted(MORNING_REVIEW_CRON, "2026-12-02", "04:40:00");
    const both = await reviewsOf();
    expect(both, "the next morning's run catches up").toHaveLength(2);
    // Claimed against the month-start day, so it is still one review a month each.
    expect(both.map((r) => r.day)).toEqual(["2026-12-01", "2026-12-01"]);

    await runScheduledCounted(MORNING_REVIEW_CRON, "2026-12-03", "04:40:00");
    expect(await reviewsOf(), "nothing is sent twice").toHaveLength(2);
  });

  it("the Saturday price refresh and the messages around it stay under 50 outside fetches", () => {
    // The refresh runs first in its run: up to MAX_SYMBOLS Yahoo symbols, one AMFI file, one IBJA page, and its own message to the
    // person (one person a run). The jobs after it send at most one Telegram message per person, up to their caps.
    const priceRun = USER_CAP.price * (MAX_SYMBOLS + 1 + 1 + 1);
    const messagesAfter = USER_CAP.holdingNudges + USER_CAP.review + USER_CAP.push;
    expect(priceRun + messagesAfter).toBeLessThan(LIMIT);
  });
});

describe("the read cache changes how many queries run, never what they return", () => {
  beforeEach(async () => {
    await db.delete(telegramLinks);
  });

  it("gives the same salary plan, health, emergency fund, FIRE, ladder, commitments and balances with and without it", async () => {
    const [userId] = await users(1);
    const today = todayIst(new Date("2026-12-01T05:00:00Z"));
    const salary = { id: "s", amountPaise: 1_00_000_00, date: today };

    const read = async () => ({
      plan: await buildSalaryPlan(db, userId as string, today, salary),
      health: await getHealth(db, userId as string, today, "last"),
      emergency: await getEmergencyFund(db, userId as string, today),
      fire: await getFire(db, userId as string, today),
      ladder: await getLadder(db, userId as string, today),
      commitments: await getCommitments(db, userId as string, today),
      figures: await listAccountsWithFigures(db, userId as string, today),
      safe: await getSafeToSpend(db, userId as string, today),
    });

    const plain = await read();
    const cached = await withReadCache(db, read);
    expect(cached).toEqual(plain);
    // And a second look inside one scope returns the same again (a cached answer is not changed by whoever used it).
    const twice = await withReadCache(db, async () => ({ a: await read(), b: await read() }));
    expect(twice.a).toEqual(plain);
    expect(twice.b).toEqual(plain);
  });
});
