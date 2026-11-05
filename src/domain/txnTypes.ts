/**
 * Transaction types.
 * - expense / income change what you have (they appear in cash flow).
 * - transfer moves money between two bank accounts.
 * - bill_payment moves money from a bank account to a credit card.
 * - investment is money leaving a bank account for shares, IPOs or funds. It is not spending, so it never counts as income or expense.
 * - investment_sale is the money that comes back into a bank account when a holding is sold. It is not income. Made only by the
 *   investments feature.
 * - loan_payment is the principal part of a loan instalment leaving a bank account. It is not spending; the interest part is an
 *   expense. Made only by the loans feature.
 * - debt_out and debt_in are money lent or repaid out of a bank account, and money borrowed or repaid into one. They are
 *   made only by the lent and borrowed feature, and are never income or expense.
 * Transfers and bill payments are "movements": they never count as income or expense.
 */
export const TXN_TYPES = ["expense", "income", "transfer", "bill_payment", "investment", "investment_sale", "loan_payment", "debt_out", "debt_in"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const MOVEMENT_TYPES = ["transfer", "bill_payment"] as const;
export const FLOW_TYPES = ["income", "expense"] as const;

export const isMovement = (type: TxnType): boolean => type === "transfer" || type === "bill_payment";

export const DEBT_TYPES = ["debt_out", "debt_in"] as const;
export const isDebtType = (type: TxnType): boolean => type === "debt_out" || type === "debt_in";

/** Movements, investments and loans are not income or expense, so they carry no category. */
export const hasNoCategory = (type: TxnType): boolean => isMovement(type) || type === "investment" || type === "investment_sale" || type === "loan_payment" || isDebtType(type);
