import { describe, expect, it } from "vitest";
import { buttonNames, world } from "./harness";

const safe = async (w: Awaited<ReturnType<typeof world>>) => (await w.api("GET", "/api/dashboard/summary?period=cycle")).json.safeToSpendPaise as number;
const holdsOf = async (w: Awaited<ReturnType<typeof world>>, status = "active") => (await w.api("GET", `/api/holds?status=${status}`)).json.items as Record<string, any>[];

describe("/ipo", () => {
  it("says so when nothing is blocked, and shows how to add one", async () => {
    const w = await world();
    await w.say("/ipo");
    expect(w.tg.last.text).toContain("Nothing is blocked");
    expect(w.tg.last.text).toContain("/ipo 15000 hdfc tata tech");
  });

  it("blocks an amount in the named account and says what can still be spent", async () => {
    const w = await world();
    const before = await safe(w);
    await w.say("/ipo 15000 hdfc tata tech");
    const text = w.tg.last.text;
    expect(text).toContain("₹15,000 is blocked in HDFC Bank for Tata Tech");
    expect(text).toContain(`You can spend ₹${((before - 15_000_00) / 100).toLocaleString("en-IN")}`);
    expect(await safe(w)).toBe(before - 15_000_00);
    const [h] = await holdsOf(w);
    expect(h).toMatchObject({ title: "Tata Tech", amountPaise: 15_000_00, accountName: "HDFC Bank", status: "active" });
  });

  it("asks which account, offering banks only, when none was named", async () => {
    const w = await world();
    await w.say("/ipo 15000 tata tech");
    const m = w.tg.last;
    expect(buttonNames(m)).toEqual(expect.arrayContaining(["HDFC Bank", "SBI", "Cancel"]));
    expect(buttonNames(m)).not.toContain("HDFC Millennia");
    expect(buttonNames(m)).not.toContain("OneCard");
    await w.press(w.button(m, "SBI"), m.id);
    expect(m.text).toContain("blocked in SBI for Tata Tech");
    expect((await holdsOf(w))[0]).toMatchObject({ accountName: "SBI" });
  });

  it("a card's name is not taken as the account: money is only blocked in banks", async () => {
    const w = await world();
    await w.say("/ipo 15000 onecard tata tech");
    expect(buttonNames(w.tg.last)).toEqual(expect.arrayContaining(["HDFC Bank", "SBI"]));
    expect(buttonNames(w.tg.last)).not.toContain("OneCard");
    expect(await holdsOf(w)).toHaveLength(0);
  });

  it("an application without a name is simply called an IPO application", async () => {
    const w = await world();
    await w.say("/ipo 5000 hdfc");
    expect((await holdsOf(w))[0]).toMatchObject({ title: "IPO application" });
  });

  it("Undo removes a block made by mistake", async () => {
    const w = await world();
    const before = await safe(w);
    await w.say("/ipo 15000 hdfc tata tech");
    const m = w.tg.last;
    await w.press(w.button(m, "Undo"), m.id);
    expect(m.text).toContain("Removed");
    expect(await safe(w)).toBe(before);
    expect(await holdsOf(w, "all")).toHaveLength(0);
  });

  it("lists active blocks with Allotted and Not allotted buttons", async () => {
    const w = await world();
    await w.say("/ipo 15000 hdfc tata tech");
    await w.say("/ipo 8000 sbi acme ltd");
    await w.say("/ipo");
    const m = w.tg.last;
    expect(m.text).toContain("Blocked for applications: ₹23,000");
    expect(m.text).toContain("Tata Tech: ₹15,000 in HDFC Bank");
    // Undated ones are listed newest first.
    expect(buttonNames(m)).toEqual(["Allotted: Acme Ltd", "Not allotted: Acme Ltd", "Allotted: Tata Tech", "Not allotted: Tata Tech"]);
  });

  it("Allotted debits the account as an investment and refreshes the list", async () => {
    const w = await world();
    await w.say("/ipo 15000 hdfc tata tech");
    await w.say("/ipo 8000 sbi acme ltd");
    await w.say("/ipo");
    const m = w.tg.last;
    await w.press(w.button(m, "Allotted: Tata Tech"), m.id);
    expect(m.text).toContain("Tata Tech was allotted. ₹15,000 has been debited from HDFC Bank");
    expect(m.text).toContain("Blocked for applications: ₹8,000");
    expect(buttonNames(m)).not.toContain("Allotted: Tata Tech");
    const inv = (await w.transactions()).filter((t) => t.type === "investment");
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ amountPaise: 15_000_00, merchant: "Tata Tech", source: "telegram" });
  });

  it("Not allotted releases the block and debits nothing", async () => {
    const w = await world();
    const before = await safe(w);
    await w.say("/ipo 15000 hdfc tata tech");
    await w.say("/ipo");
    const m = w.tg.last;
    await w.press(w.button(m, "Not allotted: Tata Tech"), m.id);
    expect(m.text).toContain("was not allotted");
    expect(await safe(w)).toBe(before);
    expect((await w.transactions()).filter((t) => t.type === "investment")).toHaveLength(0);
  });

  it("a second tap on the same button says it is already settled and changes nothing", async () => {
    const w = await world();
    await w.say("/ipo 15000 hdfc tata tech");
    await w.say("/ipo");
    const m = w.tg.last;
    const data = w.button(m, "Allotted: Tata Tech");
    await w.press(data, m.id);
    await w.press(data, m.id);
    expect(m.text).toContain("already been settled");
    expect((await w.transactions()).filter((t) => t.type === "investment")).toHaveLength(1);
  });

  it("another person's block cannot be settled through a forged button", async () => {
    const w = await world();
    const other = await world();
    await other.say("/ipo 15000 hdfc tata tech");
    const [theirs] = await holdsOf(other);
    await w.say("/ipo");
    const m = w.tg.last;
    await w.press(`h:${theirs!.id}:n`, m.id);
    expect((await holdsOf(other))[0]).toMatchObject({ status: "active" });
  });

  it("/balance shows what is blocked, per account and in total", async () => {
    const w = await world();
    await w.say("/ipo 15000 hdfc tata tech");
    await w.say("/balance");
    const text = w.tg.last.text;
    expect(text).toContain("HDFC Bank: ₹1,00,000, ₹15,000 blocked");
    expect(text).toContain("Blocked for applications, not spendable: ₹15,000.");
  });
});
