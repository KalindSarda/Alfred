import { type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Account, ApiError, type BalanceOverview, type Briefing, type Budgets, type Cashflow, type Category, type DebtsOverview, type EmiPlan, type GoalsOverview, type NetWorthPoint, type Hold, type Me, type RecurringRule, type Summary, type Transaction, api } from "./api";
import { type TxnFilters, toApiParams } from "./filters";

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api.get<Me>("/api/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

const accountsQuery = (includeArchived: boolean) => ({
  queryKey: ["accounts", { includeArchived }],
  queryFn: () => api.get<{ items: Account[]; overview: BalanceOverview }>(`/api/accounts?includeArchived=${includeArchived}`),
});

export const useAccounts = (includeArchived = false) =>
  useQuery({ ...accountsQuery(includeArchived), select: (r) => r.items });

/** Totals across active accounts: banks, cards owed, net worth. Shares the accounts request. */
export const useBalanceOverview = () => useQuery({ ...accountsQuery(false), select: (r) => r.overview });

export const useCategories = () =>
  useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<{ items: Category[] }>("/api/categories")).items,
    staleTime: 5 * 60_000,
  });

export const useSummary = (period: string) =>
  useQuery({
    queryKey: ["summary", period],
    queryFn: () => api.get<Summary>(`/api/dashboard/summary?period=${period}`),
  });

export const useCashflow = (period: string, groupBy: "category" | "merchant" = "category") =>
  useQuery({
    queryKey: ["cashflow", period, groupBy],
    queryFn: () => api.get<Cashflow>(`/api/dashboard/cashflow?period=${period}&groupBy=${groupBy}`),
  });

export const useBriefing = () =>
  useQuery({ queryKey: ["briefing"], queryFn: () => api.get<Briefing>("/api/alfred/briefing"), staleTime: 60_000 });

export const useBudgets = () => useQuery({ queryKey: ["budgets"], queryFn: () => api.get<Budgets>("/api/budgets") });

/** Recurring rules, running ones first. */
export const useRecurring = () =>
  useQuery({ queryKey: ["recurring"], queryFn: async () => (await api.get<{ items: RecurringRule[] }>("/api/recurring")).items });

/** Card EMI plans, running ones first. */
export const useEmiPlans = () =>
  useQuery({ queryKey: ["emi"], queryFn: async () => (await api.get<{ items: EmiPlan[] }>("/api/emi-plans")).items });

/** Money blocked for IPO applications and the like; active ones only. */
export const useHolds = () =>
  useQuery({ queryKey: ["holds"], queryFn: async () => (await api.get<{ items: Hold[] }>("/api/holds")).items });

/** Money lent and borrowed, grouped by person; settled loans only when asked for. */
export const useDebts = (status: "open" | "all" = "open") =>
  useQuery({ queryKey: ["debts", status], queryFn: () => api.get<DebtsOverview>(`/api/debts?status=${status}`) });

/** Savings goals; the active ones, or every one when asked. */
export const useGoals = (status: "active" | "all" = "active") =>
  useQuery({ queryKey: ["goals", status], queryFn: () => api.get<GoalsOverview>(`/api/goals?status=${status}`) });

/** Net worth at each month end, oldest first. */
export const useNetWorthTrend = (months = 12) =>
  useQuery({ queryKey: ["networth", months], queryFn: async () => (await api.get<{ points: NetWorthPoint[] }>(`/api/dashboard/networth?months=${months}`)).points });

export interface ReviewCounts {
  uncategorizedCount: number;
  draftCount: number;
}

/** Entries needing attention; drives the badge on the Transactions navigation item. */
export const useReviewCounts = (enabled = true) =>
  useQuery({
    queryKey: ["review"],
    queryFn: () => api.get<ReviewCounts>("/api/dashboard/review"),
    enabled,
    staleTime: 15_000,
  });

export interface TransactionPage {
  items: Transaction[];
  nextCursor: string | null;
  totals: { count: number; incomePaise: number; expensePaise: number };
}

export const useTransactions = (filters: TxnFilters) =>
  useInfiniteQuery({
    queryKey: ["transactions", filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = toApiParams(filters);
      params.set("limit", "30");
      if (pageParam) params.set("cursor", pageParam);
      return api.get<TransactionPage>(`/api/transactions?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** After any change to money data, everything derived from it is stale. */
export function useRefreshMoney() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["transactions"] }),
      client.invalidateQueries({ queryKey: ["accounts"] }),
      client.invalidateQueries({ queryKey: ["summary"] }),
      client.invalidateQueries({ queryKey: ["cashflow"] }),
      client.invalidateQueries({ queryKey: ["briefing"] }),
      client.invalidateQueries({ queryKey: ["budgets"] }),
      client.invalidateQueries({ queryKey: ["holds"] }),
      client.invalidateQueries({ queryKey: ["emi"] }),
      client.invalidateQueries({ queryKey: ["recurring"] }),
      client.invalidateQueries({ queryKey: ["debts"] }),
      client.invalidateQueries({ queryKey: ["goals"] }),
      client.invalidateQueries({ queryKey: ["networth"] }),
      client.invalidateQueries({ queryKey: ["review"] }),
    ]);
}

/**
 * Ends the local session after the server has ended it (sign out, account deleted). The "me" answer becomes
 * null first so the app re-renders to the login screen at once; clearing the whole cache instead would detach
 * the query the app is watching, and the screen would stay put until a refresh.
 */
export function endSession(client: QueryClient): void {
  client.setQueryData(["me"], null);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
}
