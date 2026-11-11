/** Pure data, no imports, so the bootstrap script can load it directly with Node. */

/** Name of the system income category used for cashback received. It can be archived but not renamed. */
export const CASHBACK_CATEGORY = "Cashback";

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Groceries",
  "Food & Dining",
  "Transport",
  "Fuel",
  "Shopping",
  "Bills & Utilities",
  "Rent",
  "Home & Maintenance",
  "Health",
  "Insurance",
  "Entertainment",
  "Subscriptions",
  "Travel",
  "Education",
  "Personal Care",
  "Gifts & Donations",
  "Fees & Charges",
  "Other",
] as const;

/** The spending that cannot stop, which the runway is measured against. Editable per person. */
export const DEFAULT_ESSENTIAL_CATEGORIES: readonly string[] = ["Groceries", "Transport", "Fuel", "Bills & Utilities", "Rent", "Health", "Insurance", "Education"];

export const DEFAULT_INCOME_CATEGORIES = ["Salary", CASHBACK_CATEGORY, "Interest", "Refunds", "Other income"] as const;
