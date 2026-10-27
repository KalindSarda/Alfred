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
  return {
    title: txn.merchant || category || "Uncategorized",
    sub: [category && txn.merchant ? category : null, account].filter(Boolean).join(" · "),
  };
}

export const amountTone = (type: Transaction["type"]): string =>
  type === "income" ? "text-good" : type === "transfer" ? "text-soft" : "";

export const amountSign = (type: Transaction["type"]): string =>
  type === "income" ? "+" : type === "expense" ? "−" : "";
