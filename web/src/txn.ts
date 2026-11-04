import type { Account, Category, Transaction } from "./api";

/** Title and subtitle for a transaction row, shared by the list and the Home preview. */
export function describeTxn(
  txn: Transaction,
  accounts: ReadonlyMap<string, Account>,
  categories: ReadonlyMap<string, Category>,
): { title: string; sub: string } {
  const account = accounts.get(txn.accountId)?.name ?? "Account";
  const to = txn.toAccountId ? (accounts.get(txn.toAccountId)?.name ?? "Account") : null;
  const category = txn.categoryId ? categories.get(txn.categoryId)?.name : undefined;
  if (txn.type === "transfer") return { title: `${account} → ${to}`, sub: txn.note ?? "Transfer" };
  if (txn.type === "bill_payment") {
    return { title: `Paid ${to}`, sub: ["Bill payment", `from ${account}`, txn.note].filter(Boolean).join(" · ") };
  }
  if (txn.type === "investment") {
    return { title: txn.merchant || "Investment", sub: ["Investment", account, txn.note].filter(Boolean).join(" · ") };
  }
  if (isDebt(txn.type)) {
    return { title: txn.merchant || "Lent and borrowed", sub: ["Lent and borrowed", account, txn.note].filter(Boolean).join(" · ") };
  }
  return {
    title: txn.merchant || category || "Uncategorized",
    sub: [category && txn.merchant ? category : null, account].filter(Boolean).join(" · "),
  };
}

/** Lent and borrowed entries are managed from Accounts, under Commitments, not edited like other entries. */
export const isDebt = (type: Transaction["type"]): boolean => type === "debt_out" || type === "debt_in";

const isMovement = (type: Transaction["type"]) => type === "transfer" || type === "bill_payment";

/** Income or expense with no category: needs one before it shows properly in cash flow. */
export const needsCategory = (txn: Transaction): boolean => !isMovement(txn.type) && txn.type !== "investment" && !isDebt(txn.type) && txn.categoryId === null;

export const amountTone = (type: Transaction["type"]): string =>
  type === "income" ? "text-good" : isMovement(type) || type === "investment" || isDebt(type) ? "text-soft" : "";

export const amountSign = (type: Transaction["type"]): string =>
  type === "income" || type === "debt_in" ? "+" : type === "expense" || type === "investment" || type === "debt_out" ? "−" : "";
