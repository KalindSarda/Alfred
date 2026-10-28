import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Settings, api, describeError } from "../api";
import { useToast } from "../components/toast";
import { Button, Card, ErrorText, Field, inputClass, Spinner } from "../components/ui";
import { TelegramCard } from "../components/TelegramCard";
import { useMe, useRefreshMoney } from "../queries";
import { useState } from "react";

export function More() {
  const client = useQueryClient();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const me = useMe();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const saveName = useMutation({
    mutationFn: (displayName: string | null) => api.patch<Settings>("/api/settings", { displayName }),
    onSuccess: async (data) => {
      client.setQueryData(["settings"], data);
      await client.invalidateQueries({ queryKey: ["me"] });
      setNameDraft(null);
      toast.show("Saved");
    },
  });

  const saveStartDay = useMutation({
    mutationFn: (periodStartDay: number) => api.patch<Settings>("/api/settings", { periodStartDay }),
    onSuccess: async (data) => {
      client.setQueryData(["settings"], data);
      // Everything on Home is measured over this month, so it all needs recalculating.
      await refresh();
      toast.show("Saved");
    },
  });

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
      <h1 className="text-3xl">More</h1>

      <Card className="space-y-3">
        <h2 className="font-medium">Account</h2>
        <p className="text-sm text-soft">{me.data?.email}</p>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = (nameDraft ?? me.data?.displayName ?? "").trim();
            saveName.mutate(value === "" ? null : value);
          }}
        >
          <Field label="What Alfred calls you" hint="He uses it in greetings. Clear it to use the name from your email.">
            <input
              className={inputClass}
              maxLength={40}
              value={nameDraft ?? me.data?.displayName ?? ""}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={nameDraft === null || saveName.isPending}>
            Save name
          </Button>
          <ErrorText>{saveName.isError ? describeError(saveName.error) : ""}</ErrorText>
        </form>
      </Card>

      <TelegramCard />

      <Card className="space-y-3">
        <h2 className="font-medium">Your month</h2>
        {settings.isPending ? (
          <Spinner />
        ) : (
          <Field
            label="My month starts on day"
            hint="Cash flow on Home shows this month only. Set it to your salary day: with 30, you see the 30th to the 29th. Short months use their last day."
          >
            <select
              className={inputClass}
              value={settings.data?.periodStartDay ?? 1}
              onChange={(e) => saveStartDay.mutate(Number(e.target.value))}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? "1 (calendar month)" : d}
                </option>
              ))}
            </select>
          </Field>
        )}
        <ErrorText>{saveStartDay.isError ? describeError(saveStartDay.error) : ""}</ErrorText>
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
        <p className="text-sm text-soft">
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
