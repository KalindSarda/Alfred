import { describe, expect, it } from "vitest";
import { runEmiCheckIns } from "../../src/services/emiJob";
import { db } from "../helpers";
import { buttonNames, world } from "./harness";

type W = Awaited<ReturnType<typeof world>>;

// The test clock is 2026-10-27. The Millennia statement is on the 23rd. A plan starting in November adds nothing yet.
const plan = (w: W, extra: object = {}) =>
  w.api("POST", "/api/emi-plans", { cardAccountId: w.millennia.id, title: "Phone", months: 6, instalmentsPaise: [20_082_00, 20_500_00, 20_500_00, 20_500_00, 20_500_00, 20_498_00], startMonth: "2026-11", ...extra });
const run = (w: W, iso: string) => runEmiCheckIns({ db, telegram: w.tg, now: () => Date.parse(`${iso}T05:00:00Z`) });
const mine = (w: W) => w.tg.messages.filter((m) => m.chatId === String(w.chat));
const entry = async (w: W, n: number) => ((await w.api("GET", `/api/transactions?accountId=${w.millennia.id}&limit=100`)).json.items as Record<string, any>[]).find((t) => t.note === `EMI ${n} of 6`);

describe("asking whether an instalment agrees with the statement", () => {
  it("asks once, when the instalment is added, with two answers", async () => {
    const w = await world();
    await plan(w);
    expect(mine(w)).toHaveLength(0);
    const first = await run(w, "2026-11-23");
    expect(first.added).toBeGreaterThanOrEqual(1);
    const [m] = mine(w);
    expect(m!.text).toBe("Phone, instalment 1 of 6: ₹20,082 has been added to HDFC Millennia. Does your statement agree?");
    expect(buttonNames(m!)).toEqual(["Yes, it agrees", "Different amount"]);
    await run(w, "2026-11-23");
    expect(mine(w)).toHaveLength(1);
  });

  it("does not ask about months added at once when a plan is created", async () => {
    const w = await world();
    await plan(w, { startMonth: "2026-08" });
    expect((await entry(w, 1))!.amountPaise).toBe(20_082_00);
    await run(w, "2026-10-27");
    expect(mine(w)).toHaveLength(0);
  });

  it("Yes just thanks", async () => {
    const w = await world();
    await plan(w);
    await run(w, "2026-11-23");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Yes, it agrees"), m.id);
    expect(m.text).toBe("Splendid. It matches your statement.");
  });

  it("Different amount waits for the figure, then corrects the entry and the schedule", async () => {
    const w = await world();
    await plan(w);
    await run(w, "2026-11-23");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Different amount"), m.id);
    expect(m.text).toBe("What does the statement show for Phone, instalment 1? Just send the amount, such as 20100.");
    await w.say("20,100.50");
    expect(w.tg.last.text).toBe("Corrected. Phone, instalment 1, is now ₹20,100.50. ₹1,22,598.50 is still to come.");
    expect((await entry(w, 1))!.amountPaise).toBe(20_100_50);
    const p = ((await w.api("GET", "/api/emi-plans")).json.items as Record<string, any>[])[0]!;
    expect(p.scheduleAmountsPaise[0]).toBe(20_100_50);
  });

  it("a message that is not an amount carries on as a normal entry, and the wait is dropped", async () => {
    const w = await world();
    await plan(w);
    await run(w, "2026-11-23");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Different amount"), m.id);
    await w.say("450 food swiggy hdfc");
    expect(w.tg.last.text).toContain("450");
    await w.say("20100");
    expect((await entry(w, 1))!.amountPaise).toBe(20_082_00);
  });

  it("forged or stale buttons change nothing", async () => {
    const w = await world();
    const other = await world();
    await plan(other);
    await run(other, "2026-11-23");
    const theirs = (await entry(other, 1))!.id as string;
    await plan(w);
    await run(w, "2026-11-23");
    const m = mine(w)[0]!;
    await w.press(`e:${theirs}:d`, m.id);
    expect(m.text).toBe("I cannot find that instalment any more, so there is nothing to correct.");
    await w.say("999");
    expect((await entry(other, 1))!.amountPaise).toBe(20_082_00);
  });

  it("says the plan is closed rather than changing it", async () => {
    const w = await world();
    const p = (await plan(w)).json;
    await run(w, "2026-11-23");
    const m = mine(w)[0]!;
    await w.press(w.button(m, "Different amount"), m.id);
    await w.api("POST", `/api/emi-plans/${p.id}/cancel`);
    await w.say("20100");
    expect(w.tg.last.text).toBe("That plan is closed, so I cannot change it. Reopen it in the app first.");
  });
});
