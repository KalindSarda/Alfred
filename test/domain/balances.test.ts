import { describe, expect, it } from "vitest";
import {
  type BankLedgerAccount,
  bankBalance,
  type CardLedgerAccount,
  cardOwed,
  cardSummary,
  type LedgerTxn,
  safeToSpend,
  utilizationPct,
} from "../../src/domain/balances";

const hdfcBank: BankLedgerAccount = { id: "hdfc", kind: "bank", openingBalancePaise: 10_000_00, countsTowardSafeToSpend: true };
const sbi: BankLedgerAccount = { id: "sbi", kind: "bank", openingBalancePaise: 5_000_00, countsTowardSafeToSpend: true };
const reserve: BankLedgerAccount = { id: "bob", kind: "bank", openingBalancePaise: 50_000_00, countsTowardSafeToSpend: false };
const millennia: CardLedgerAccount = {
  id: "millennia",
  kind: "card",
  openingOutstandingPaise: 0,
  creditLimitPaise: 2_00_000_00,
  statementDay: 23,
  dueDay: 12,
};

const txn = (partial: Partial<LedgerTxn> & Pick<LedgerTxn, "type" | "amountPaise" | "accountId" | "txnDate">): LedgerTxn => ({
  toAccountId: null,
  status: "confirmed",
  deletedAt: null,
  ...partial,
});

describe("bankBalance", () => {
  it("applies opening, income, expense and transfers", () => {
    const txns = [
      txn({ type: "income", amountPaise: 1_000_00, accountId: "hdfc", txnDate: "2026-10-01" }),
      txn({ type: "expense", amountPaise: 250_00, accountId: "hdfc", txnDate: "2026-10-02" }),
      txn({ type: "transfer", amountPaise: 2_000_00, accountId: "hdfc", toAccountId: "sbi", txnDate: "2026-10-03" }),
    ];
    expect(bankBalance(hdfcBank, txns)).toBe(10_000_00 + 1_000_00 - 250_00 - 2_000_00);
    expect(bankBalance(sbi, txns)).toBe(5_000_00 + 2_000_00);
  });

  it("ignores drafts and soft-deleted rows", () => {
    const txns = [
      txn({ type: "expense", amountPaise: 100_00, accountId: "hdfc", txnDate: "2026-10-02", status: "draft" }),
      txn({ type: "expense", amountPaise: 200_00, accountId: "hdfc", txnDate: "2026-10-02", deletedAt: "2026-10-03T00:00:00Z" }),
    ];
    expect(bankBalance(hdfcBank, txns)).toBe(10_000_00);
  });

  it("respects the asOf date", () => {
    const txns = [txn({ type: "expense", amountPaise: 100_00, accountId: "hdfc", txnDate: "2026-10-10" })];
    expect(bankBalance(hdfcBank, txns, "2026-10-09")).toBe(10_000_00);
    expect(bankBalance(hdfcBank, txns, "2026-10-10")).toBe(10_000_00 - 100_00);
  });
});

describe("cardOwed", () => {
  it("a purchase raises owed immediately", () => {
    const txns = [txn({ type: "expense", amountPaise: 4_500_00, accountId: "millennia", txnDate: "2026-10-26" })];
    expect(cardOwed(millennia, txns)).toBe(4_500_00);
  });

  it("includes the opening outstanding", () => {
    expect(cardOwed({ ...millennia, openingOutstandingPaise: 12_000_00 }, [])).toBe(12_000_00);
  });

  it("a bill payment lowers owed", () => {
    const txns = [
      txn({ type: "expense", amountPaise: 4_500_00, accountId: "millennia", txnDate: "2026-10-20" }),
      txn({ type: "bill_payment", amountPaise: 4_500_00, accountId: "hdfc", toAccountId: "millennia", txnDate: "2026-11-10" }),
    ];
    expect(cardOwed(millennia, txns)).toBe(0);
  });

  it("income on the card (cashback statement credit) lowers owed", () => {
    const txns = [
      txn({ type: "expense", amountPaise: 1_000_00, accountId: "millennia", txnDate: "2026-10-20" }),
      txn({ type: "income", amountPaise: 50_00, accountId: "millennia", txnDate: "2026-10-21" }),
    ];
    expect(cardOwed(millennia, txns)).toBe(950_00);
  });

  it("a bill payment moves the bank and the card balances in step", () => {
    const payment = [txn({ type: "bill_payment", amountPaise: 1_000_00, accountId: "hdfc", toAccountId: "millennia", txnDate: "2026-10-20" })];
    expect(bankBalance(hdfcBank, payment)).toBe(9_000_00);
    expect(cardOwed(millennia, payment)).toBe(-1_000_00);
  });
});

describe("safeToSpend", () => {
  const accounts = [hdfcBank, sbi, reserve, millennia];

  it("is flagged balances minus total owed", () => {
    expect(safeToSpend(accounts, [])).toBe(10_000_00 + 5_000_00);
    const txns = [txn({ type: "expense", amountPaise: 3_000_00, accountId: "millennia", txnDate: "2026-10-26" })];
    expect(safeToSpend(accounts, txns)).toBe(15_000_00 - 3_000_00);
  });

  it("excludes accounts not flagged", () => {
    expect(safeToSpend(accounts, [])).toBe(15_000_00);
    expect(safeToSpend([hdfcBank, sbi, { ...reserve, countsTowardSafeToSpend: true }], [])).toBe(65_000_00);
  });

  it("paying the card bill leaves safe-to-spend unchanged, early or late", () => {
    const purchase = txn({ type: "expense", amountPaise: 4_500_00, accountId: "millennia", txnDate: "2026-10-20" });
    const before = safeToSpend(accounts, [purchase]);
    for (const payDate of ["2026-10-21", "2026-11-05", "2026-11-12", "2026-11-30"]) {
      const payment = txn({ type: "bill_payment", amountPaise: 4_500_00, accountId: "hdfc", toAccountId: "millennia", txnDate: payDate });
      expect(safeToSpend(accounts, [purchase, payment])).toBe(before);
    }
  });

  it("income raises it whenever it is logged", () => {
    const salary = (date: string) => txn({ type: "income", amountPaise: 1_00_000_00, accountId: "sbi", txnDate: date });
    expect(safeToSpend(accounts, [salary("2026-10-28")])).toBe(safeToSpend(accounts, [salary("2026-10-31")]));
    expect(safeToSpend(accounts, [salary("2026-10-30")])).toBe(15_000_00 + 1_00_000_00);
  });

  it("a transfer between flagged banks changes nothing; to an unflagged bank lowers it", () => {
    const toSbi = txn({ type: "transfer", amountPaise: 1_000_00, accountId: "hdfc", toAccountId: "sbi", txnDate: "2026-10-26" });
    const toReserve = txn({ type: "transfer", amountPaise: 1_000_00, accountId: "hdfc", toAccountId: "bob", txnDate: "2026-10-26" });
    expect(safeToSpend(accounts, [toSbi])).toBe(15_000_00);
    expect(safeToSpend(accounts, [toReserve])).toBe(14_000_00);
  });
});

describe("utilizationPct and cardSummary", () => {
  it("computes utilization against the limit, never negative", () => {
    const txns = [txn({ type: "expense", amountPaise: 50_000_00, accountId: "millennia", txnDate: "2026-10-26" })];
    expect(utilizationPct(millennia, txns)).toBe(25);
    const credit = [txn({ type: "income", amountPaise: 100_00, accountId: "millennia", txnDate: "2026-10-26" })];
    expect(utilizationPct(millennia, credit)).toBe(0);
  });

  it("splits billed and unbilled spend around the statement date", () => {
    const txns = [
      txn({ type: "expense", amountPaise: 10_000_00, accountId: "millennia", txnDate: "2026-10-10" }),
      txn({ type: "expense", amountPaise: 2_000_00, accountId: "millennia", txnDate: "2026-10-23" }),
      txn({ type: "expense", amountPaise: 500_00, accountId: "millennia", txnDate: "2026-10-24" }),
      txn({ type: "expense", amountPaise: 700_00, accountId: "millennia", txnDate: "2026-10-26" }),
    ];
    const s = cardSummary(millennia, txns, "2026-10-26");
    expect(s.owedPaise).toBe(13_200_00);
    expect(s.unbilledPaise).toBe(1_200_00);
    expect(s.statementOutstandingPaise).toBe(12_000_00);
    expect(s.nextDueDate).toBe("2026-11-12");
  });

  it("a payment after the statement reduces the statement outstanding, not unbilled", () => {
    const txns = [
      txn({ type: "expense", amountPaise: 12_000_00, accountId: "millennia", txnDate: "2026-10-10" }),
      txn({ type: "expense", amountPaise: 700_00, accountId: "millennia", txnDate: "2026-10-25" }),
      txn({ type: "bill_payment", amountPaise: 5_000_00, accountId: "hdfc", toAccountId: "millennia", txnDate: "2026-10-26" }),
    ];
    const s = cardSummary(millennia, txns, "2026-10-26");
    expect(s.statementOutstandingPaise).toBe(7_000_00);
    expect(s.unbilledPaise).toBe(700_00);
    expect(s.owedPaise).toBe(7_700_00);
  });

  it("overpaying never produces a negative statement outstanding", () => {
    const txns = [
      txn({ type: "expense", amountPaise: 1_000_00, accountId: "millennia", txnDate: "2026-10-10" }),
      txn({ type: "bill_payment", amountPaise: 3_000_00, accountId: "hdfc", toAccountId: "millennia", txnDate: "2026-10-26" }),
    ];
    expect(cardSummary(millennia, txns, "2026-10-26").statementOutstandingPaise).toBe(0);
  });
});
