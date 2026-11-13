/** Pure data, no imports, so the bootstrap script can load it directly with Node. */

/** Name of the system income category used for cashback received. It can be archived but not renamed. */
export const CASHBACK_CATEGORY = "Cashback";

/** Name of the system income category for money other people paid back (a ticket you booked for them, a share of a bill). It is left out of income and taken off spending. It can be archived but not renamed. */
export const REPAID_CATEGORY = "Repaid by others";

/** Income categories that are money coming back, not earnings: left out of income and taken off spending, in the month of the spending they pay back. */
export const NETTED_INCOME_CATEGORIES: readonly string[] = ["Refunds", REPAID_CATEGORY];

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

export const DEFAULT_INCOME_CATEGORIES = ["Salary", CASHBACK_CATEGORY, "Interest", "Dividends", "Refunds", REPAID_CATEGORY, "Gifts received", "Other income"] as const;
