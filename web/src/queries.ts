import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Account, ApiError, type Category, type Me, type Summary, type Transaction, api } from "./api";

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

export const useAccounts = (includeArchived = false) =>
  useQuery({
    queryKey: ["accounts", { includeArchived }],
    queryFn: async () =>
      (await api.get<{ items: Account[] }>(`/api/accounts?includeArchived=${includeArchived}`)).items,
  });

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

export interface TxnFilters {
  q: string;
  accountId: string;
  type: string;
}

export const useTransactions = (filters: TxnFilters) =>
  useInfiniteQuery({
    queryKey: ["transactions", filters],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      if (filters.q) params.set("q", filters.q);
      if (filters.accountId) params.set("accountId", filters.accountId);
      if (filters.type) params.set("type", filters.type);
      return api.get<{ items: Transaction[]; nextCursor: string | null }>(`/api/transactions?${params}`);
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
    ]);
}
