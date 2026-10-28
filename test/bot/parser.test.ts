import { describe, expect, it } from "vitest";
import {
  type BotAccount,
  type BotCategory,
  inferType,
  type MerchantMemory,
  parseAmountToken,
  parseEntry,
  type ParseContext,
  type ParsedEntry,
} from "../../src/bot/parser";

const TODAY = "2026-10-27";

// Ids equal names so expectations read naturally.
const accounts: BotAccount[] = [
  { id: "HDFC Bank", name: "HDFC Bank", kind: "bank" },
  { id: "ICICI Bank", name: "ICICI Bank", kind: "bank" },
  { id: "SBI", name: "SBI", kind: "bank" },
  { id: "Bank of Baroda", name: "Bank of Baroda", kind: "bank" },
  { id: "HDFC Millennia", name: "HDFC Millennia", kind: "card" },
  { id: "Amazon Pay ICICI", name: "Amazon Pay ICICI", kind: "card" },
  { id: "OneCard", name: "OneCard", kind: "card" },
];

const expense = ["Food & Dining", "Groceries", "Transport", "Fuel", "Shopping", "Bills & Utilities", "Rent", "Health", "Entertainment", "Subscriptions", "Other"];
const income = ["Salary", "Cashback", "Interest", "Refunds", "Other income"];
const categories: BotCategory[] = [
  ...expense.map((name) => ({ id: name, name, kind: "expense" as const })),
  ...income.map((name) => ({ id: `in:${name}`, name, kind: "income" as const })),
];

const ctx = (merchants: [string, MerchantMemory][] = []): ParseContext => ({
  today: TODAY,
  accounts,
  categories,
  merchants: new Map(merchants),
});

function entry(text: string, type: Parameters<typeof parseEntry>[1] = "expense", c = ctx()): ParsedEntry {
  const result = parseEntry(text, type, c);
  if (!result.ok) throw new Error(`Expected "${text}" to parse, got ${result.reason}`);
  return result.entry;
}

describe("parseAmountToken", () => {
  it.each([
    ["450", 45000],
    ["1,200", 120000],
    ["450.5", 45050],
    ["450.50", 45050],
    ["₹99", 9900],
    ["Rs99", 9900],
    ["rs.99", 9900],
    ["450/-", 45000],
    ["2k", 200000],
    ["2K", 200000],
    ["1.5k", 150000],
    ["1.5L", 15000000],
    ["2lakh", 20000000],
    ["1,20,000", 12000000],
  ])("%s -> %i paise", (token, paise) => {
    expect(parseAmountToken(token)).toBe(paise);
  });

  it.each(["", "abc", "0", "0.00", "1.234", "-5", "k", "12ab", "5kk", "99999999999999999"])("rejects %s", (token) => {
    expect(parseAmountToken(token)).toBeNull();
  });
});

describe("amounts in sentences", () => {
  it("finds the amount anywhere", () => {
    expect(entry("450 food swiggy").amountPaise).toBe(45000);
    expect(entry("swiggy 450").amountPaise).toBe(45000);
    expect(entry("spent ₹1,200 on groceries").amountPaise).toBe(120000);
    expect(entry("paid rs 99 for netflix").amountPaise).toBe(9900);
  });

  it("fails clearly instead of guessing", () => {
    expect(parseEntry("swiggy", "expense", ctx())).toEqual({ ok: false, reason: "no_amount" });
    expect(parseEntry("   ", "expense", ctx())).toEqual({ ok: false, reason: "empty" });
    expect(parseEntry("", "expense", ctx())).toEqual({ ok: false, reason: "empty" });
    expect(parseEntry("0 coffee", "expense", ctx())).toEqual({ ok: false, reason: "no_amount" });
  });
});

describe("dates", () => {
  it("defaults to today", () => {
    expect(entry("450 swiggy").txnDate).toBe(TODAY);
  });

  it.each([
    ["450 swiggy yesterday", "2026-10-26"],
    ["450 swiggy yday", "2026-10-26"],
    ["450 swiggy today", TODAY],
    ["450 swiggy 24 oct", "2026-10-24"],
    ["450 swiggy 24th oct", "2026-10-24"],
    ["450 swiggy oct 24", "2026-10-24"],
    ["450 swiggy 5/10", "2026-10-05"],
    ["450 swiggy 5-10", "2026-10-05"],
    ["450 swiggy 5/10/2025", "2025-10-05"],
    ["450 swiggy 5/10/25", "2025-10-05"],
    ["24 october 450 swiggy", "2026-10-24"],
  ])("%s -> %s", (text, date) => {
    expect(entry(text).txnDate).toBe(date);
  });

  it("a day that has not happened this year means last year", () => {
    expect(entry("450 swiggy 28 oct").txnDate).toBe("2025-10-28");
    expect(entry("450 swiggy 1 dec").txnDate).toBe("2025-12-01");
  });

  it("does not mistake the date for the amount", () => {
    const e = entry("24 oct 450 swiggy");
    expect(e.amountPaise).toBe(45000);
    expect(e.txnDate).toBe("2026-10-24");
  });

  it("rejects a date that does not exist", () => {
    expect(parseEntry("450 swiggy 31/02", "expense", ctx())).toEqual({ ok: false, reason: "bad_date" });
    expect(parseEntry("450 swiggy 31 feb", "expense", ctx())).toEqual({ ok: false, reason: "bad_date" });
  });

  it("handles 29 February only when the year allows it", () => {
    expect(parseEntry("450 x 29/02/2028", "expense", ctx())).toMatchObject({ ok: true });
    expect(parseEntry("450 x 29/02/2027", "expense", ctx())).toEqual({ ok: false, reason: "bad_date" });
    // no year given, and this year (2026) has no 29 February
    expect(parseEntry("450 x 29 feb", "expense", ctx())).toEqual({ ok: false, reason: "bad_date" });
  });
});

describe("categories", () => {
  it("matches a category name word", () => {
    expect(entry("450 food swiggy").categoryId).toBe("Food & Dining");
    expect(entry("1200 groceries").categoryId).toBe("Groceries");
    expect(entry("300 fuel").categoryId).toBe("Fuel");
    expect(entry("3000 bills").categoryId).toBe("Bills & Utilities");
  });

  it("matches everyday words and keeps the word as the merchant", () => {
    const e = entry("spent 450 on dinner");
    expect(e.categoryId).toBe("Food & Dining");
    expect(e.merchant).toBe("Dinner");
    expect(entry("200 petrol").categoryId).toBe("Fuel");
    expect(entry("120 cab").categoryId).toBe("Transport");
    expect(entry("2500 electricity").categoryId).toBe("Bills & Utilities");
  });

  it("suggests a category for well-known merchants", () => {
    expect(entry("450 swiggy").categoryId).toBe("Food & Dining");
    expect(entry("2999 amazon").categoryId).toBe("Shopping");
    expect(entry("649 netflix").categoryId).toBe("Subscriptions");
  });

  it("an explicit category wins over a merchant hint", () => {
    expect(entry("450 groceries swiggy").categoryId).toBe("Groceries");
  });

  it("leaves a category empty when nothing matches", () => {
    const e = entry("450 randomshop");
    expect(e.categoryId).toBeNull();
    expect(e.merchant).toBe("Randomshop");
  });

  it("uses what you did last time with a merchant", () => {
    const e = entry("350 corner store", "expense", ctx([["corner store", { categoryId: "Groceries", accountId: "SBI" }]]));
    expect(e.categoryId).toBe("Groceries");
    expect(e.suggestedAccountId).toBe("SBI");
  });

  it("income uses income categories only", () => {
    expect(entry("90000 salary", "income").categoryId).toBe("in:Salary");
    expect(entry("500 cashback", "income").categoryId).toBe("in:Cashback");
    // "other" exists on both sides; an income entry must never get an expense category
    expect(entry("100 other", "income").categoryId).toBe("in:Other income");
    expect(entry("100 other", "expense").categoryId).toBe("Other");
  });
});

describe("merchants", () => {
  it("title-cases what is left over", () => {
    expect(entry("450 swiggy").merchant).toBe("Swiggy");
    expect(entry("450 cafe coffee day").merchant).toBe("Cafe Coffee Day");
  });

  it("is empty when there is only a category", () => {
    expect(entry("450 groceries").merchant).toBeNull();
  });

  it("is capped at 80 characters", () => {
    expect(entry(`450 ${"word ".repeat(40)}`).merchant!.length).toBeLessThanOrEqual(80);
  });
});

describe("accounts on expenses and income", () => {
  it("finds a unique account by any word of its name", () => {
    expect(entry("450 food using millennia").from).toEqual({ status: "found", id: "HDFC Millennia" });
    expect(entry("450 food from sbi").from).toEqual({ status: "found", id: "SBI" });
    expect(entry("450 food baroda").from).toEqual({ status: "found", id: "Bank of Baroda" });
  });

  it("matches the start of a word", () => {
    expect(entry("450 coffee mill").from).toEqual({ status: "found", id: "HDFC Millennia" });
    expect(entry("450 coffee onec").from).toEqual({ status: "found", id: "OneCard" });
  });

  it("is ambiguous when a word fits more than one account", () => {
    const e = entry("450 coffee hdfc");
    expect(e.from).toEqual({ status: "ambiguous", ids: ["HDFC Bank", "HDFC Millennia"] });
    const icici = entry("450 coffee icici");
    expect(icici.from).toEqual({ status: "ambiguous", ids: ["ICICI Bank", "Amazon Pay ICICI"] });
  });

  it("narrows an ambiguous word with a second one", () => {
    expect(entry("450 coffee hdfc millennia").from).toEqual({ status: "found", id: "HDFC Millennia" });
    expect(entry("450 coffee hdfc bank").from).toEqual({ status: "found", id: "HDFC Bank" });
  });

  it("is missing when no account is named", () => {
    expect(entry("450 swiggy").from).toEqual({ status: "missing" });
    expect(entry("450").from).toEqual({ status: "missing" });
  });

  it("does not take a merchant for an account unless a marker points at it", () => {
    // "amazon" would prefix-match the card "Amazon Pay ICICI", but here it is the shop
    const shop = entry("450 amazon");
    expect(shop.from).toEqual({ status: "missing" });
    expect(shop.merchant).toBe("Amazon");
    // with a marker it is the card
    const card = entry("450 flipkart using amazon pay icici");
    expect(card.from).toEqual({ status: "found", id: "Amazon Pay ICICI" });
    expect(card.merchant).toBe("Flipkart");
  });

  it("income can land on any account", () => {
    expect(entry("90000 salary sbi", "income").from).toEqual({ status: "found", id: "SBI" });
  });
});

describe("bill payments", () => {
  it("finds a card and the bank it is paid from", () => {
    const e = entry("4500 millennia from hdfc", "bill_payment");
    expect(e.from).toEqual({ status: "found", id: "HDFC Bank" });
    expect(e.to).toEqual({ status: "found", id: "HDFC Millennia" });
    expect(e.categoryId).toBeNull();
    expect(e.merchant).toBeNull();
  });

  it("a single word that names a bank and a card resolves each by kind", () => {
    const e = entry("4500 hdfc", "bill_payment");
    expect(e.from).toEqual({ status: "found", id: "HDFC Bank" });
    expect(e.to).toEqual({ status: "found", id: "HDFC Millennia" });
  });

  it("works in either order", () => {
    const e = entry("4500 from sbi onecard", "bill_payment");
    expect(e.to).toEqual({ status: "found", id: "OneCard" });
    expect(e.from).toEqual({ status: "found", id: "SBI" });
  });

  it("asks for what is missing", () => {
    const e = entry("4500", "bill_payment");
    expect(e.from).toEqual({ status: "missing" });
    expect(e.to).toEqual({ status: "missing" });
    const onlyCard = entry("4500 onecard", "bill_payment");
    expect(onlyCard.to).toEqual({ status: "found", id: "OneCard" });
    expect(onlyCard.from).toEqual({ status: "missing" });
  });

  it("never treats a bank as the card", () => {
    const e = entry("4500 sbi", "bill_payment");
    expect(e.to).toEqual({ status: "missing" });
  });
});

describe("transfers", () => {
  it("handles several phrasings between two banks", () => {
    for (const text of ["5000 hdfc sbi", "5000 hdfc to sbi", "5000 from hdfc to sbi"]) {
      const e = entry(text, "transfer");
      expect(e.from, text).toEqual({ status: "found", id: "HDFC Bank" });
      expect(e.to, text).toEqual({ status: "found", id: "SBI" });
    }
  });

  it("never uses a credit card", () => {
    const e = entry("5000 hdfc to millennia", "transfer");
    expect(e.to).toEqual({ status: "missing" });
  });

  it("asks when it cannot tell", () => {
    const e = entry("5000", "transfer");
    expect(e.from).toEqual({ status: "missing" });
    expect(e.to).toEqual({ status: "missing" });
  });
});

describe("inferType", () => {
  it("reads income from the words used, otherwise assumes an expense", () => {
    expect(inferType("received 90000 salary")).toBe("income");
    expect(inferType("450 swiggy")).toBe("expense");
    expect(inferType("refund 300 amazon")).toBe("income");
    expect(inferType("cashback 50")).toBe("income");
    expect(inferType("spent 300 on fuel")).toBe("expense");
  });
});

describe("the examples from the Alfred brief", () => {
  it("'Spent ₹450 on dinner'", () => {
    const e = entry("Spent ₹450 on dinner");
    expect(e).toMatchObject({ type: "expense", amountPaise: 45000, categoryId: "Food & Dining", merchant: "Dinner" });
  });

  it("is case-insensitive and tolerates punctuation", () => {
    const e = entry("SPENT 450 ON DINNER!");
    expect(e).toMatchObject({ amountPaise: 45000, categoryId: "Food & Dining" });
    expect(entry("450, swiggy.").merchant).toBe("Swiggy");
  });
});
