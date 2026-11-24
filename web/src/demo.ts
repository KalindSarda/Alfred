import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, describeError } from "./api";
import { useToast } from "./components/toast";
import { useRefreshMoney } from "./queries";
import { navigate } from "./router";
import { endTour, startTour } from "./tourState";

/** Whether the sample data is loaded, so the banner, the tour and Settings can say so. */
export const useDemoStatus = () => useQuery({ queryKey: ["demo"], queryFn: () => api.get<{ loaded: boolean }>("/api/demo-data"), staleTime: 30_000 });

/** Loads the sample and starts the tour. The caller decides where to go next. */
export function useLoadDemo() {
  const client = useQueryClient();
  const refresh = useRefreshMoney();
  const mutation = useMutation({
    mutationFn: () => api.post<{ created: number }>("/api/demo-data"),
    onSuccess: async () => {
      await refresh();
      await client.invalidateQueries({ queryKey: ["demo"] });
      startTour(0);
    },
  });
  return { load: () => mutation.mutateAsync(), pending: mutation.isPending, error: mutation.isError ? describeError(mutation.error) : "" };
}

/** Clears the sample after asking, then opens the setup guide so the person can add their own accounts. */
export function useClearDemo() {
  const client = useQueryClient();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => api.del<{ deleted: number }>("/api/demo-data"),
    onSuccess: async () => {
      endTour();
      await refresh();
      await client.invalidateQueries({ queryKey: ["demo"] });
      toast.show("Sample data cleared. Let's set up yours.");
      navigate("/setup");
    },
  });
  const clear = () => {
    const ok = window.confirm("Clear the sample data and start fresh?\n\nThis removes the Demo accounts, entries, goals, loans and investments. Anything of yours stays.");
    if (ok) mutation.mutate();
  };
  return { clear, pending: mutation.isPending, error: mutation.isError ? describeError(mutation.error) : "" };
}
