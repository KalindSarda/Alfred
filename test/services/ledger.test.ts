import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../src/config/errors";
import { insertAccount } from "../../src/db/accounts";
import { accounts } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import {
  confirmTransaction,
  createTransaction,
  getSafeToSpend,
  getTransaction,
  listAccountsWithFigures,
  listTransactions,
  restoreTransaction,
  softDeleteTransaction,
  updateTransaction,
} from "../../src/services/ledger";
import { createFixture, db } from "../helpers";

const web = { source: "web" as const };
const TODAY = "2026-10-26";

describe("createTransaction", () => {
  it("creates an expense with category and records the source", async () => {
    const f = await createFixture();
    const created = await createTransaction(
      db,
      f.userId,
      {
        type: "expense",
        amountPaise: 450_00,
        txnDate: "2026-10-26",
        accountId: f.hdfc.id,
        categoryId: await f.category("expense", "Food & Dining"),
        merchant: "Swiggy",
      },
      { source: "telegram" },
    );
    expect(created).toMatchObject({
      type: "expense",
      amountPaise: 45000,
      status: "confirmed",
      source: "telegram",
      merchant: "Swiggy",
      toAccountId: null,
    });
    expect(await getTransaction(db, f.userId, created.id)).toEqual(created);
  });

  it("allows uncategorized expenses", async () => {
    const f = await createFixture();
    const created = await createTransaction(
      db,
      f.userId,
      { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: f.hdfc.id },
      web,
    );
    expect(created.categoryId).toBeNull();
  });

  it.each([
    ["zero amount", { amountPaise: 0 }],
    ["fractional paise", { amountPaise: 10.5 }],
    ["negative amount", { amountPaise: -5 }],
    ["malformed date", { txnDate: "26-10-2026" }],
    ["impossible date", { txnDate: "2026-02-30" }],
    ["unknown type", { type: "refund" }],
  ])("rejects %s", async (_label, override) => {
    const f = await createFixture();
    const input = { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: f.hdfc.id, ...override };
    await expect(createTransaction(db, f.userId, input as never, web)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects transfers without a destination, to the same account, or with a category", async () => {
    const f = await createFixture();
    const base = { type: "transfer", amountPaise: 100, txnDate: "2026-10-26", accountId: f.hdfc.id } as const;
    await expect(createTransaction(db, f.userId, base, web)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTransaction(db, f.userId, { ...base, toAccountId: f.hdfc.id }, web),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTransaction(
        db,
        f.userId,
        { ...base, toAccountId: f.sbi.id, categoryId: await f.category("expense", "Other") },
        web,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a destination on a non-transfer", async () => {
    const f = await createFixture();
    await expect(
      createTransaction(
        db,
        f.userId,
        { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: f.hdfc.id, toAccountId: f.sbi.id },
        web,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a category of the wrong kind", async () => {
    const f = await createFixture();
    await expect(
      createTransaction(
        db,
        f.userId,
        {
          type: "expense",
          amountPaise: 100,
          txnDate: "2026-10-26",
          accountId: f.hdfc.id,
          categoryId: await f.category("income", "Salary"),
        },
        web,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("404s for unknown accounts and categories", async () => {
    const f = await createFixture();
    await expect(
      createTransaction(db, f.userId, { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: "nope" }, web),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTransaction(
        db,
        f.userId,
        { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: f.hdfc.id, categoryId: "nope" },
        web,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects archived accounts", async () => {
    const f = await createFixture();
    await db.update(accounts).set({ archivedAt: "2026-10-01T00:00:00Z" }).where(eq(accounts.id, f.sbi.id));
    await expect(
      createTransaction(db, f.userId, { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: f.sbi.id }, web),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("income on a card is allowed (statement-credit cashback) and reduces owed", async () => {
    const f = await createFixture();
    const cashback = await f.category("income", "Cashback");
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 1_000_00, txnDate: "2026-10-20", accountId: f.millennia.id }, web);
    await createTransaction(
      db,
      f.userId,
      { type: "income", amountPaise: 50_00, txnDate: "2026-10-21", accountId: f.millennia.id, categoryId: cashback },
      web,
    );
    const figures = await listAccountsWithFigures(db, f.userId, TODAY);
    const card = figures.find((a) => a.id === f.millennia.id);
    expect(card?.kind === "card" && card.summary.owedPaise).toBe(950_00);
  });
});

describe("balances through the service", () => {
  it("a card bill payment: safe-to-spend unchanged, both balances move", async () => {
    const f = await createFixture();
    await createTransaction(db, f.userId, { type: "expense", amountPaise: 4_500_00, txnDate: "2026-10-20", accountId: f.millennia.id }, web);
    const before = await getSafeToSpend(db, f.userId, TODAY);
    expect(before).toBe(10_000_00 + 5_000_00 - 4_500_00);

    await createTransaction(
      db,
      f.userId,
      { type: "bill_payment", amountPaise: 4_500_00, txnDate: "2026-10-25", accountId: f.hdfc.id, toAccountId: f.millennia.id },
      web,
    );
    expect(await getSafeToSpend(db, f.userId, TODAY)).toBe(before);

    const figures = await listAccountsWithFigures(db, f.userId, TODAY);
    const hdfc = figures.find((a) => a.id === f.hdfc.id);
    const card = figures.find((a) => a.id === f.millennia.id);
    expect(hdfc?.kind === "bank" && hdfc.balancePaise).toBe(10_000_00 - 4_500_00);
    expect(card?.kind === "card" && card.summary.owedPaise).toBe(0);
  });

  it("drafts and deleted transactions do not count; restore and confirm bring them back", async () => {
    const f = await createFixture();
    const draft = await createTransaction(
      db,
      f.userId,
      { type: "expense", amountPaise: 1_000_00, txnDate: "2026-10-20", accountId: f.hdfc.id, status: "draft" },
      { source: "ai" },
    );
    expect(await getSafeToSpend(db, f.userId, TODAY)).toBe(15_000_00);

    await confirmTransaction(db, f.userId, draft.id);
    expect(await getSafeToSpend(db, f.userId, TODAY)).toBe(14_000_00);
    await expect(confirmTransaction(db, f.userId, draft.id)).rejects.toBeInstanceOf(ConflictError);

    await softDeleteTransaction(db, f.userId, draft.id);
    expect(await getSafeToSpend(db, f.userId, TODAY)).toBe(15_000_00);
    await expect(getTransaction(db, f.userId, draft.id)).rejects.toBeInstanceOf(NotFoundError);

    await restoreTransaction(db, f.userId, draft.id);
    expect(await getSafeToSpend(db, f.userId, TODAY)).toBe(14_000_00);
  });

  it("future-dated transactions are not in available-now", async () => {
    const f = await createFixture();
    await createTransaction(db, f.userId, { type: "income", amountPaise: 1_00_000_00, txnDate: "2026-10-30", accountId: f.sbi.id }, web);
    expect(await getSafeToSpend(db, f.userId, TODAY)).toBe(15_000_00);
    expect(await getSafeToSpend(db, f.userId, "2026-10-30")).toBe(15_000_00 + 1_00_000_00);
  });
});

describe("updateTransaction", () => {
  it("changes fields and revalidates the merged result", async () => {
    const f = await createFixture();
    const t = await createTransaction(db, f.userId, { type: "expense", amountPaise: 100_00, txnDate: "2026-10-20", accountId: f.hdfc.id }, web);

    const updated = await updateTransaction(db, f.userId, t.id, { amountPaise: 250_00, merchant: "Zomato" });
    expect(updated).toMatchObject({ amountPaise: 250_00, merchant: "Zomato", accountId: f.hdfc.id });
    expect(updated.updatedAt >= t.updatedAt).toBe(true);

    await expect(updateTransaction(db, f.userId, t.id, { type: "transfer" })).rejects.toBeInstanceOf(ValidationError);
    const asTransfer = await updateTransaction(db, f.userId, t.id, { type: "transfer", toAccountId: f.sbi.id });
    expect(asTransfer).toMatchObject({ type: "transfer", toAccountId: f.sbi.id, categoryId: null });

    const backToExpense = await updateTransaction(db, f.userId, t.id, { type: "expense" });
    expect(backToExpense.toAccountId).toBeNull();
  });

  it("clears the category when a categorized expense becomes a transfer", async () => {
    const f = await createFixture();
    const t = await createTransaction(
      db,
      f.userId,
      {
        type: "expense",
        amountPaise: 100_00,
        txnDate: "2026-10-20",
        accountId: f.hdfc.id,
        categoryId: await f.category("expense", "Groceries"),
      },
      web,
    );
    const moved = await updateTransaction(db, f.userId, t.id, { type: "transfer", toAccountId: f.sbi.id });
    expect(moved.categoryId).toBeNull();
  });

  it("rejects a category of the wrong kind after a type change", async () => {
    const f = await createFixture();
    const t = await createTransaction(
      db,
      f.userId,
      {
        type: "expense",
        amountPaise: 100_00,
        txnDate: "2026-10-20",
        accountId: f.hdfc.id,
        categoryId: await f.category("expense", "Groceries"),
      },
      web,
    );
    await expect(updateTransaction(db, f.userId, t.id, { type: "income" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("404s for unknown ids", async () => {
    const f = await createFixture();
    await expect(updateTransaction(db, f.userId, "nope", { amountPaise: 5 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listTransactions", () => {
  async function seed() {
    const f = await createFixture();
    const groceries = await f.category("expense", "Groceries");
    const dates = ["2026-10-01", "2026-10-02", "2026-10-02", "2026-10-03", "2026-10-04"];
    const created = [];
    for (const [i, txnDate] of dates.entries()) {
      created.push(
        await createTransaction(
          db,
          f.userId,
          {
            type: "expense",
            amountPaise: (i + 1) * 100,
            txnDate,
            accountId: i % 2 === 0 ? f.hdfc.id : f.sbi.id,
            categoryId: i === 0 ? groceries : null,
            merchant: i === 1 ? "100% Organic_Store" : "Shop",
            note: i === 2 ? "birthday gift" : null,
          },
          web,
        ),
      );
    }
    return { f, created, groceries };
  }

  it("pages with an opaque cursor, newest first, without gaps or repeats", async () => {
    const { f, created } = await seed();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await listTransactions(db, f.userId, { limit: 2, cursor });
      seen.push(...result.items.map((t) => t.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const expected = [...created].sort((a, b) => (a.txnDate === b.txnDate ? (a.id < b.id ? 1 : -1) : a.txnDate < b.txnDate ? 1 : -1));
    expect(seen).toEqual(expected.map((t) => t.id));
  });

  it("returns a null cursor when the page is the last", async () => {
    const { f } = await seed();
    const result = await listTransactions(db, f.userId, { limit: 50 });
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by date range, account, category and text", async () => {
    const { f, groceries } = await seed();
    expect((await listTransactions(db, f.userId, { from: "2026-10-02", to: "2026-10-03" })).items).toHaveLength(3);
    expect((await listTransactions(db, f.userId, { accountId: f.sbi.id })).items).toHaveLength(2);
    expect((await listTransactions(db, f.userId, { categoryId: groceries })).items).toHaveLength(1);
    expect((await listTransactions(db, f.userId, { categoryId: "none" })).items).toHaveLength(4);
    expect((await listTransactions(db, f.userId, { q: "BIRTHDAY" })).items).toHaveLength(1);
  });

  it("treats % and _ in search text literally", async () => {
    const { f } = await seed();
    expect((await listTransactions(db, f.userId, { q: "100%" })).items).toHaveLength(1);
    expect((await listTransactions(db, f.userId, { q: "%" })).items).toHaveLength(1);
    expect((await listTransactions(db, f.userId, { q: "Organic_S" })).items).toHaveLength(1);
    expect((await listTransactions(db, f.userId, { q: "Organic?S" })).items).toHaveLength(0);
  });

  it("filtering by account includes movements into it", async () => {
    const f = await createFixture();
    await createTransaction(
      db,
      f.userId,
      { type: "bill_payment", amountPaise: 100, txnDate: "2026-10-05", accountId: f.hdfc.id, toAccountId: f.millennia.id },
      web,
    );
    expect((await listTransactions(db, f.userId, { accountId: f.millennia.id })).items).toHaveLength(1);
    expect((await listTransactions(db, f.userId, { categoryId: "none" })).items).toHaveLength(0);
  });

  it("rejects a malformed cursor and bad limits", async () => {
    const f = await createFixture();
    await expect(listTransactions(db, f.userId, { cursor: "not-base64-json" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listTransactions(db, f.userId, { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(listTransactions(db, f.userId, { limit: 201 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("account constraints", () => {
  it("the database refuses a card without limit and cycle days", async () => {
    const f = await createFixture();
    await expect(
      db.insert(accounts).values({ id: "bad", userId: f.userId, kind: "card", name: "Broken", createdAt: "x" }),
    ).rejects.toThrow();
    await expect(
      insertAccount(db, f.userId, { kind: "bank", name: "HDFC Bank", openingBalancePaise: 0 }),
    ).rejects.toThrow();
  });
});
