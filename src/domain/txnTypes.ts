/**
 * Transaction types.
 * - expense / income change what you have (they appear in cash flow).
 * - transfer moves money between two bank accounts.
 * - bill_payment moves money from a bank account to a credit card.
 * Transfers and bill payments are "movements": they never count as income or expense.
 */
export const TXN_TYPES = ["expense", "income", "transfer", "bill_payment"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const MOVEMENT_TYPES = ["transfer", "bill_payment"] as const;
export const FLOW_TYPES = ["income", "expense"] as const;

export const isMovement = (type: TxnType): boolean => type === "transfer" || type === "bill_payment";
