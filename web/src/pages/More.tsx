import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Settings, api, describeError } from "../api";
import { useToast } from "../components/toast";
import { Button, Card, ErrorText, Field, inputClass, Spinner } from "../components/ui";
import { useMe, useRefreshMoney } from "../queries";

export function More() {
  const client = useQueryClient();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const me = useMe();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });

  const saveLead = useMutation({
    mutationFn: (nudgeLeadDays: number) => api.patch<Settings>("/api/settings", { nudgeLeadDays }),
    onSuccess: (data) => {
      client.setQueryData(["settings"], data);
      toast.show("Saved");
    },
  });

  const loadDemo = useMutation({
    mutationFn: () => api.post<{ created: number }>("/api/demo-data"),
    onSuccess: async (r) => {
      await refresh();
      toast.show(`Loaded ${r.created} demo transactions`);
    },
  });

  const clearDemo = useMutation({
    mutationFn: () => api.del<{ deleted: number }>("/api/demo-data"),
    onSuccess: async (r) => {
      await refresh();
      toast.show(`Removed demo data (${r.deleted} transactions)`);
    },
  });

  const signOut = useMutation({
    mutationFn: (everywhere: boolean) => api.post(everywhere ? "/api/auth/logout-all" : "/api/auth/logout"),
    onSuccess: () => {
      client.clear();
      client.setQueryData(["me"], null);
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">More</h1>

      <Card>
        <h2 className="font-medium">Account</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{me.data?.email}</p>
        <p className="mt-1 text-sm text-slate-500">
          Telegram: {me.data?.telegramLinked ? "linked" : "not linked yet (the bot arrives in an upcoming update)"}
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Card due-date reminders</h2>
        {settings.isPending ? (
          <Spinner />
        ) : (
          <Field label="Remind me this many days before a card is due" hint="Reminders go to Telegram once the bot is connected.">
            <select
              className={inputClass}
              value={settings.data?.nudgeLeadDays ?? 3}
              onChange={(e) => saveLead.mutate(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  {d} day{d === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorText>{saveLead.isError ? describeError(saveLead.error) : ""}</ErrorText>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Demo data</h2>
        <p className="text-sm text-slate-500">
          Try the app with sample accounts and transactions. Clearing removes only the demo items, never your own entries.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" disabled={loadDemo.isPending} onClick={() => loadDemo.mutate()}>
            Load demo data
          </Button>
          <Button
            variant="secondary"
            disabled={clearDemo.isPending}
            onClick={() => {
              if (window.confirm("Remove all demo accounts and transactions?")) clearDemo.mutate();
            }}
          >
            Clear demo data
          </Button>
        </div>
        <ErrorText>{loadDemo.isError ? describeError(loadDemo.error) : clearDemo.isError ? describeError(clearDemo.error) : ""}</ErrorText>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Sign out</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={signOut.isPending} onClick={() => signOut.mutate(false)}>
            Sign out
          </Button>
          <Button variant="secondary" disabled={signOut.isPending} onClick={() => signOut.mutate(true)}>
            Sign out everywhere
          </Button>
        </div>
      </Card>
    </div>
  );
}
