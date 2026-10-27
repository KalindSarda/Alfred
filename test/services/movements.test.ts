import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/config/errors";
import { createTransaction, listTransactions, updateTransaction } from "../../src/services/ledger";
import { getSummary } from "../../src/services/dashboard";
import { createFixture, db } from "../helpers";

const web = { source: "web" as const };
const base = { amountPaise: 100_00, txnDate: "2026-10-26" };

describe("transfers and bill payments", () => {
  it("a transfer moves money between two bank accounts", async () => {
    const f = await createFixture();
    const t = await createTransaction(db, f.userId, { ...base, type: "transfer", accountId: f.hdfc.id, toAccountId: f.sbi.id }, web);
    expect(t).toMatchObject({ type: "transfer", toAccountId: f.sbi.id, categoryId: null });
  });

  it("a transfer cannot involve a credit card on either side", async () => {
    const f = await createFixture();
    const toCard = createTransaction(db, f.userId, { ...base, type: "transfer", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    await expect(toCard).rejects.toMatchObject({ details: [{ path: "toAccountId" }] });
    const fromCard = createTransaction(db, f.userId, { ...base, type: "transfer", accountId: f.millennia.id, toAccountId: f.hdfc.id }, web);
    await expect(fromCard).rejects.toMatchObject({ details: [{ path: "accountId" }] });
  });

  it("a bill payment goes from a bank account to a credit card", async () => {
    const f = await createFixture();
    const t = await createTransaction(db, f.userId, { ...base, type: "bill_payment", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    expect(t).toMatchObject({ type: "bill_payment", accountId: f.hdfc.id, toAccountId: f.millennia.id, categoryId: null });
  });

  it("rejects a bill payment to a bank, from a card, to nowhere, or with a category", async () => {
    const f = await createFixture();
    const bad = [
      { type: "bill_payment", accountId: f.hdfc.id, toAccountId: f.sbi.id },
      { type: "bill_payment", accountId: f.millennia.id, toAccountId: f.hdfc.id },
      { type: "bill_payment", accountId: f.hdfc.id },
      { type: "bill_payment", accountId: f.hdfc.id, toAccountId: f.millennia.id, categoryId: await f.category("expense", "Other") },
    ] as const;
    for (const input of bad) {
      await expect(createTransaction(db, f.userId, { ...base, ...input }, web)).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("an expense can be edited into a bill payment only with a card destination", async () => {
    const f = await createFixture();
    const t = await createTransaction(db, f.userId, { ...base, type: "expense", accountId: f.hdfc.id }, web);
    await expect(updateTransaction(db, f.userId, t.id, { type: "bill_payment", toAccountId: f.sbi.id })).rejects.toBeInstanceOf(ValidationError);
    const ok = await updateTransaction(db, f.userId, t.id, { type: "bill_payment", toAccountId: f.millennia.id });
    expect(ok.type).toBe("bill_payment");
    const back = await updateTransaction(db, f.userId, t.id, { type: "expense" });
    expect(back).toMatchObject({ type: "expense", toAccountId: null });
  });

  it("bill payments are excluded from cash flow totals and from review counts", async () => {
    const f = await createFixture();
    await createTransaction(db, f.userId, { ...base, type: "bill_payment", accountId: f.hdfc.id, toAccountId: f.millennia.id }, web);
    const summary = await getSummary(db, f.userId, "30d", "2026-10-27");
    expect(summary).toMatchObject({ incomePaise: 0, expensePaise: 0, uncategorizedCount: 0, draftCount: 0 });
    const none = await listTransactions(db, f.userId, { categoryId: "none" });
    expect(none.items).toHaveLength(0);
  });
});
