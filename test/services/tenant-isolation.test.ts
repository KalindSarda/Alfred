import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/config/errors";
import { getAccount, listAccounts } from "../../src/db/accounts";
import { getCategory, listCategories } from "../../src/db/categories";
import { getTransactionRow, listTransactionRows, loadLedgerTxns, updateTransactionRow } from "../../src/db/transactions";
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

async function twoUsers() {
  const a = await createFixture();
  const b = await createFixture();
  const aTxn = await createTransaction(
    db,
    a.userId,
    {
      type: "expense",
      amountPaise: 1_234_00,
      txnDate: "2026-10-20",
      accountId: a.hdfc.id,
      categoryId: await a.category("expense", "Groceries"),
      status: "draft",
    },
    web,
  );
  return { a, b, aTxn };
}

describe("tenant isolation: services", () => {
  it("another user cannot read, change, delete, restore or confirm a transaction", async () => {
    const { b, aTxn } = await twoUsers();
    await expect(getTransaction(db, b.userId, aTxn.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateTransaction(db, b.userId, aTxn.id, { amountPaise: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(softDeleteTransaction(db, b.userId, aTxn.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreTransaction(db, b.userId, aTxn.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmTransaction(db, b.userId, aTxn.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the owner's data is untouched after the failed attempts", async () => {
    const { a, b, aTxn } = await twoUsers();
    await updateTransaction(db, b.userId, aTxn.id, { amountPaise: 1 }).catch(() => undefined);
    await softDeleteTransaction(db, b.userId, aTxn.id).catch(() => undefined);
    expect(await getTransaction(db, a.userId, aTxn.id)).toEqual(aTxn);
  });

  it("cannot create a transaction against another user's account or category", async () => {
    const { a, b } = await twoUsers();
    await expect(
      createTransaction(db, b.userId, { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: a.hdfc.id }, web),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTransaction(
        db,
        b.userId,
        { type: "transfer", amountPaise: 100, txnDate: "2026-10-26", accountId: b.hdfc.id, toAccountId: a.sbi.id },
        web,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createTransaction(
        db,
        b.userId,
        {
          type: "expense",
          amountPaise: 100,
          txnDate: "2026-10-26",
          accountId: b.hdfc.id,
          categoryId: await a.category("expense", "Groceries"),
        },
        web,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cannot move your own transaction onto another user's account", async () => {
    const { a, b } = await twoUsers();
    const mine = await createTransaction(
      db,
      b.userId,
      { type: "expense", amountPaise: 100, txnDate: "2026-10-26", accountId: b.hdfc.id },
      web,
    );
    await expect(updateTransaction(db, b.userId, mine.id, { accountId: a.hdfc.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists and figures only include the caller's data", async () => {
    const { a, b, aTxn } = await twoUsers();
    expect((await listTransactions(db, b.userId, {})).items).toHaveLength(0);
    expect((await listTransactions(db, a.userId, {})).items.map((t) => t.id)).toEqual([aTxn.id]);

    const bFigures = await listAccountsWithFigures(db, b.userId, TODAY);
    expect(bFigures.map((x) => x.id).sort()).toEqual([b.hdfc.id, b.sbi.id, b.reserve.id, b.millennia.id].sort());
    expect(await getSafeToSpend(db, b.userId, TODAY)).toBe(15_000_00);
  });

  it("a user's balances ignore every other user's transactions, even for a draft that is later confirmed", async () => {
    const { a, b, aTxn } = await twoUsers();
    await confirmTransaction(db, a.userId, aTxn.id);
    expect(await getSafeToSpend(db, a.userId, TODAY)).toBe(15_000_00 - 1_234_00);
    expect(await getSafeToSpend(db, b.userId, TODAY)).toBe(15_000_00);
  });
});

describe("tenant isolation: db helpers", () => {
  it("every helper scopes by user id", async () => {
    const { a, b, aTxn } = await twoUsers();

    expect(await getAccount(db, b.userId, a.hdfc.id)).toBeUndefined();
    expect(await getAccount(db, a.userId, a.hdfc.id)).toBeDefined();
    expect((await listAccounts(db, b.userId)).every((x) => x.userId === b.userId)).toBe(true);

    const aCategory = await a.category("expense", "Groceries");
    expect(await getCategory(db, b.userId, aCategory)).toBeUndefined();
    expect((await listCategories(db, b.userId)).every((x) => x.userId === b.userId)).toBe(true);

    expect(await getTransactionRow(db, b.userId, aTxn.id, { includeDeleted: true })).toBeUndefined();
    expect(await updateTransactionRow(db, b.userId, aTxn.id, { note: "hijacked" })).toBeUndefined();
    expect(await loadLedgerTxns(db, b.userId)).toHaveLength(0);
    const page = await listTransactionRows(db, b.userId, { limit: 50 });
    expect(page.rows).toHaveLength(0);
    expect((await getTransactionRow(db, a.userId, aTxn.id))?.note).toBeNull();
  });
});
