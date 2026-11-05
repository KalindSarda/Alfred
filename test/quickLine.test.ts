import { describe, expect, it } from "vitest";
import type { EntryHints } from "../web/src/api";
import { defaultAccountId, describeQuickLine, memoryFor, parseQuickLine, quickFailure, topMerchants, type QuickCtx } from "../web/src/quickLine";

const ctx = (hints?: EntryHints): QuickCtx => ({
  today: "2026-10-27",
  accounts: [
    { id: "bank-hdfc", name: "HDFC Bank", kind: "bank" },
    { id: "bank-sbi", name: "SBI", kind: "bank" },
    { id: "card-one", name: "OneCard", kind: "card" },
  ],
  categories: [
    { id: "cat-food", name: "Food & Dining", kind: "expense" },
    { id: "cat-shop", name: "Shopping", kind: "expense" },
    { id: "cat-salary", name: "Salary", kind: "income" },
  ],
  hints,
});

const hints: EntryHints = {
  merchants: [
    { merchant: "Swiggy", categoryId: "cat-food", accountId: "card-one", count: 5 },
    { merchant: "Amazon", categoryId: "cat-shop", accountId: "bank-hdfc", count: 2 },
    { merchant: "Pay", categoryId: "cat-salary", accountId: "bank-sbi", count: 9 },
  ],
  lastUsedAccountIds: ["card-one", "bank-sbi", "bank-hdfc"],
};

const names = { accounts: new Map(ctx().accounts.map((a) => [a.id, a.name])), categories: new Map(ctx().categories.map((c) => [c.id, c.name])) };

describe("reading a line", () => {
  it("understands amount, merchant, account and date words", () => {
    const r = parseQuickLine("450 swiggy sbi yesterday", "expense", ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fill).toMatchObject({ type: "expense", amountPaise: 450_00, txnDate: "2026-10-26", accountId: "bank-sbi", accountNamed: true, merchant: "Swiggy" });
  });

  it("files a known merchant under its usual category and suggests its usual account", () => {
    const r = parseQuickLine("450 swiggy", "expense", ctx(hints));
    expect(r.ok && r.fill).toMatchObject({ categoryId: "cat-food", accountId: "card-one", accountNamed: false });
    expect(r.ok && r.fill.merchant).toBe("Swiggy");
  });

  it("an account named in the line beats the merchant's usual one", () => {
    const r = parseQuickLine("450 swiggy sbi", "expense", ctx(hints));
    expect(r.ok && r.fill).toMatchObject({ accountId: "bank-sbi", accountNamed: true });
  });

  it("reads income words as income", () => {
    const r = parseQuickLine("received 90000 salary sbi", "expense", ctx());
    expect(r.ok && r.fill.type).toBe("income");
    expect(r.ok && r.fill.amountPaise).toBe(90_000_00);
  });

  it("leaves out what it cannot find, so the form keeps what is there", () => {
    const r = parseQuickLine("450", "expense", ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fill).not.toHaveProperty("accountId");
    expect(r.fill).not.toHaveProperty("merchant");
    expect(r.fill).not.toHaveProperty("categoryId");
    expect(r.fill.accountNamed).toBe(false);
  });

  it("keeps a transfer or card bill chosen on the form", () => {
    const t = parseQuickLine("5000 hdfc sbi", "transfer", ctx());
    expect(t.ok && t.fill.type).toBe("transfer");
    const p = parseQuickLine("2000 onecard from hdfc", "bill_payment", ctx());
    expect(p.ok && p.fill.type).toBe("bill_payment");
  });

  it("explains a line it cannot use", () => {
    const none = parseQuickLine("swiggy sbi", "expense", ctx());
    expect(none).toEqual({ ok: false, reason: "no_amount" });
    expect(quickFailure("no_amount")).toBe("Start with the amount, such as 450 swiggy.");
    expect(quickFailure("empty")).toBe("");
    expect(parseQuickLine("   ", "expense", ctx())).toEqual({ ok: false, reason: "empty" });
  });
});

describe("saying what was understood", () => {
  it("builds one sentence, marking a suggested account as the usual one", () => {
    const named = parseQuickLine("450 swiggy sbi yesterday", "expense", ctx(hints));
    if (!named.ok) throw new Error("not parsed");
    expect(describeQuickLine(named.fill, names, "2026-10-27")).toBe("Expense · ₹450 · Swiggy · Food & Dining · from SBI · 2026-10-26");
    const usual = parseQuickLine("450 swiggy", "expense", ctx(hints));
    if (!usual.ok) throw new Error("not parsed");
    expect(describeQuickLine(usual.fill, names, "2026-10-27")).toBe("Expense · ₹450 · Swiggy · Food & Dining · from OneCard (usual) · today");
  });

  it("says into for income and has no account part when there is none", () => {
    const inc = parseQuickLine("received 5000 pay sbi", "expense", ctx(hints));
    if (!inc.ok) throw new Error("not parsed");
    expect(describeQuickLine(inc.fill, names, "2026-10-27")).toContain("into SBI");
    const bare = parseQuickLine("450", "expense", ctx());
    if (!bare.ok) throw new Error("not parsed");
    expect(describeQuickLine(bare.fill, names, "2026-10-27")).toBe("Expense · ₹450 · today");
  });
});

describe("defaults and memory", () => {
  it("starts on the most recently used account that the entry allows", () => {
    const banks = [{ id: "bank-hdfc" }, { id: "bank-sbi" }];
    expect(defaultAccountId(banks, hints.lastUsedAccountIds)).toBe("bank-sbi");
    expect(defaultAccountId([{ id: "bank-hdfc" }], hints.lastUsedAccountIds)).toBe("bank-hdfc");
    expect(defaultAccountId([{ id: "x" }, { id: "y" }], hints.lastUsedAccountIds)).toBe("x");
    expect(defaultAccountId([], hints.lastUsedAccountIds)).toBe("");
    expect(defaultAccountId(banks, [])).toBe("bank-hdfc");
  });

  it("remembers a merchant's category and account, ignoring case and spaces", () => {
    expect(memoryFor("  SWIGGY ", hints, "expense", ctx().categories)).toEqual({ categoryId: "cat-food", accountId: "card-one" });
    expect(memoryFor("unknown", hints, "expense", ctx().categories)).toBeNull();
    expect(memoryFor("", hints, "expense", ctx().categories)).toBeNull();
    expect(memoryFor("swiggy", undefined, "expense", ctx().categories)).toBeNull();
  });

  it("ignores a remembered category that does not fit the kind of entry", () => {
    expect(memoryFor("pay", hints, "expense", ctx().categories)).toEqual({ categoryId: null, accountId: "bank-sbi" });
    expect(memoryFor("pay", hints, "income", ctx().categories)).toEqual({ categoryId: "cat-salary", accountId: "bank-sbi" });
  });

  it("offers the most used merchants first, more recent winning a tie", () => {
    expect(topMerchants(hints, 2).map((m) => m.merchant)).toEqual(["Pay", "Swiggy"]);
    const tie: EntryHints = { merchants: [{ merchant: "A", categoryId: null, accountId: "x", count: 1 }, { merchant: "B", categoryId: null, accountId: "x", count: 1 }], lastUsedAccountIds: [] };
    expect(topMerchants(tie, 5).map((m) => m.merchant)).toEqual(["A", "B"]);
    expect(topMerchants(undefined, 3)).toEqual([]);
  });
});
