import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Account, ApiError, type BalanceOverview, type Briefing, type Cashflow, type Category, type Me, type Summary, type Transaction, api } from "./api";
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
      client.invalidateQueries({ queryKey: ["review"] }),
    ]);
}
