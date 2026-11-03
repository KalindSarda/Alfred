/**
 * Transaction types.
 * - expense / income change what you have (they appear in cash flow).
 * - transfer moves money between two bank accounts.
 * - bill_payment moves money from a bank account to a credit card.
 * - investment is money leaving a bank account for shares, IPOs or funds. It is not spending, so it never counts as income or expense.
 * Transfers and bill payments are "movements": they never count as income or expense.
 */
export const TXN_TYPES = ["expense", "income", "transfer", "bill_payment", "investment"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const MOVEMENT_TYPES = ["transfer", "bill_payment"] as const;
export const FLOW_TYPES = ["income", "expense"] as const;

export const isMovement = (type: TxnType): boolean => type === "transfer" || type === "bill_payment";

/** Movements and investments are not income or expense, so they carry no category. */
export const hasNoCategory = (type: TxnType): boolean => isMovement(type) || type === "investment";
