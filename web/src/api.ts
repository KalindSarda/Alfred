export interface FieldDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: FieldDetail[],
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    // fetch sends same-origin cookies by default, which is all the session needs.
    headers: { "X-Requested-With": "fin", "Content-Type": "application/json", ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: FieldDetail[] } } | null)?.error;
    const retry = Number(res.headers.get("Retry-After"));
    throw new ApiError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? res.statusText,
      err?.details,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>("POST", path, body ?? {}, headers),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

/** Turns an API failure into text a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details?.length) return error.details.map((d) => d.message).join(". ");
    if (error.status === 429 && error.retryAfter) {
      const minutes = Math.ceil(error.retryAfter / 60);
      return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return error.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

// ---- Response types (mirror 05-api-schema.md) ----

export interface Me {
  id: string;
  email: string;
  /** What Alfred calls the user. */
  displayName: string;
  telegramLinked: boolean;
  isOwner: boolean;
  /** True until the first-run setup guide has been finished or skipped. */
  needsSetup: boolean;
  settings: { nudgeLeadDays: number; nudgeTimeIst: string };
}

export interface BankAccount {
  id: string;
  kind: "bank";
  name: string;
  last4: string | null;
  openingBalancePaise: number;
  countsTowardSafeToSpend: boolean;
  balancePaise: number;
  archived: boolean;
  entryCount: number;
}

export interface CardAccount {
  id: string;
  kind: "card";
  name: string;
  last4: string | null;
  creditLimitPaise: number;
  statementDay: number;
  dueDay: number;
  openingOutstandingPaise: number;
  archived: boolean;
  entryCount: number;
  outstandingPaise: number;
  unbilledPaise: number;
  statementOutstandingPaise: number;
  utilizationPct: number;
  nextStatementDate: string;
  nextDueDate: string;
}

export type Account = BankAccount | CardAccount;

export interface BalanceOverview {
  totalInBanksPaise: number;
  countedPaise: number;
  setAsidePaise: number;
  cardsOwedPaise: number;
  netWorthPaise: number;
  safeToSpendPaise: number;
}

export interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
  archived: boolean;
  isSystem: boolean;
  entryCount: number;
}

export type TxnType = "expense" | "income" | "transfer" | "bill_payment";

export interface Transaction {
  id: string;
  type: TxnType;
  amountPaise: number;
  txnDate: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  merchant: string | null;
  note: string | null;
  status: "draft" | "confirmed";
  source: "web" | "telegram" | "seed" | "ai";
}

export interface Summary {
  period: { key: string; from: string; to: string };
  safeToSpendPaise: number;
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  previousExpensePaise: number;
  uncategorizedCount: number;
  draftCount: number;
}

export interface CashflowRow {
  key: string;
  categoryId: string | null;
  name: string;
  amountPaise: number;
  pctOfIncome: number;
}

export interface Cashflow {
  period: { key: string; from: string; to: string };
  groupBy: "category" | "merchant";
  incomePaise: number;
  expensePaise: number;
  surplusPaise: number;
  income: CashflowRow[];
  expenses: CashflowRow[];
}

export interface BudgetItem {
  categoryId: string;
  categoryName: string;
  limitPaise: number;
  spentPaise: number;
  remainingPaise: number;
  pct: number;
  status: "ok" | "near" | "over";
}

export interface Budgets {
  period: { from: string; to: string };
  totalLimitPaise: number;
  totalSpentPaise: number;
  items: BudgetItem[];
}

export interface BriefingLine {
  key: string;
  text: string;
  to?: string;
}

export interface Briefing {
  greeting: string;
  subline: string;
  lines: BriefingLine[];
  source: "template" | "ai";
  generatedAt: string;
  footer: string;
}

export interface Settings {
  nudgeLeadDays: number;
  nudgeTimeIst: string;
  sessionDays: number;
  displayName: string | null;
  periodStartDay: number;
}
