import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { type Me, type Settings, api, describeError } from "../api";
import { AccountForm } from "../components/AccountForm";
import { Orb } from "../components/Alfred";
import { TelegramCard } from "../components/TelegramCard";
import { Button, ErrorText, Field, Sheet, inputClass } from "../components/ui";
import { rupees } from "../format";
import { useAccounts, useMe } from "../queries";
import { navigate } from "../router";

const STEPS = ["welcome", "month", "banks", "cards", "telegram", "done"] as const;
type Step = (typeof STEPS)[number];

function Shell({
  step,
  title,
  lead,
  children,
  footer,
  onBack,
  onSkipAll,
}: {
  step: number;
  title: string;
  lead: string;
  children: ReactNode;
  footer: ReactNode;
  onBack?: () => void;
  onSkipAll: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-6 pb-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Orb className="size-7" />
          <span className="font-display text-2xl">Alfred</span>
        </div>
        <button type="button" onClick={onSkipAll} className="min-h-11 px-2 text-sm text-soft hover:underline">
          Skip setup
        </button>
      </header>

      <div role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} className="h-1.5 overflow-hidden rounded-full bg-hover">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <section className="flex-1 space-y-4">
        <h1 className="text-3xl">{title}</h1>
        <p className="text-soft">{lead}</p>
        {children}
      </section>

      <footer className="flex items-center gap-3">
        {onBack && (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        )}
        <div className="flex flex-1 justify-end gap-3">{footer}</div>
      </footer>
    </main>
  );
}

export function Setup() {
  const client = useQueryClient();
  const me = useMe();
  const accounts = useAccounts();
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [startDay, setStartDay] = useState<number | null>(null);
  const [adding, setAdding] = useState<"bank" | "card" | null>(null);
  const step: Step = STEPS[stepIndex] ?? "welcome";

  const finish = useMutation({
    mutationFn: () => api.post<Me>("/api/me/onboarded"),
    onSuccess: (data) => {
      client.setQueryData(["me"], data);
      navigate("/");
    },
  });

  const saveSettings = useMutation({
    mutationFn: (patch: Partial<Pick<Settings, "displayName" | "periodStartDay">>) => api.patch<Settings>("/api/settings", patch),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["me"] });
      await client.invalidateQueries({ queryKey: ["settings"] });
      await client.invalidateQueries({ queryKey: ["summary"] });
      await client.invalidateQueries({ queryKey: ["cashflow"] });
      setStepIndex((i) => i + 1);
    },
  });

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = stepIndex > 0 ? () => setStepIndex((i) => i - 1) : undefined;
  const skipAll = () => finish.mutate();
  const shared = { step: stepIndex, onSkipAll: skipAll, ...(back && { onBack: back }) };
  const error = saveSettings.isError ? describeError(saveSettings.error) : finish.isError ? describeError(finish.error) : "";

  const banks = (accounts.data ?? []).filter((a) => a.kind === "bank");
  const cards = (accounts.data ?? []).filter((a) => a.kind === "card");

  if (step === "welcome") {
    const value = name ?? me.data?.displayName ?? "";
    return (
      <Shell {...shared} title="Good day. Alfred here." lead="Let me set things up with you. It takes a couple of minutes, and you can skip anything and come back later." footer={
        <Button disabled={saveSettings.isPending || !value.trim()} onClick={() => saveSettings.mutate({ displayName: value.trim() })}>
          Continue
        </Button>
      }>
        <Field label="What shall I call you?" hint="I use it in greetings. You can change it any time.">
          <input className={inputClass} maxLength={40} value={value} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
      </Shell>
    );
  }

  if (step === "month") {
    const value = startDay ?? 1;
    return (
      <Shell {...shared} title="When does your month start?" lead="Many people think of a month as payday to payday. I will measure your cash flow and budgets over that month." footer={
        <>
          <Button variant="secondary" onClick={next}>
            Skip
          </Button>
          <Button disabled={saveSettings.isPending} onClick={() => saveSettings.mutate({ periodStartDay: value })}>
            Continue
          </Button>
        </>
      }>
        <Field label="My month starts on day" hint="1 means calendar months. With 30, you see the 30th to the 29th. Short months use their last day.">
          <select className={inputClass} value={value} onChange={(e) => setStartDay(Number(e.target.value))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 (calendar month)" : d}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText>{error}</ErrorText>
      </Shell>
    );
  }

  if (step === "banks" || step === "cards") {
    const isBank = step === "banks";
    const list = isBank ? banks : cards;
    return (
      <>
        <Shell
          {...shared}
          title={isBank ? "Your bank accounts" : "Your credit cards"}
          lead={
            isBank
              ? "Add the accounts you want me to keep track of, with what each holds today. I add your entries on top of that."
              : "Add each card with its limit, statement day, due day and what it owes right now. I will remind you before payments fall due."
          }
          footer={
            <>
              {list.length === 0 && (
                <Button variant="secondary" onClick={next}>
                  Skip
                </Button>
              )}
              <Button onClick={next}>{list.length === 0 ? "Not now" : "Continue"}</Button>
            </>
          }
        >
          {list.length > 0 && (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
              {list.map((a) => (
                <li key={a.id} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="shrink-0 text-sm text-soft">{a.kind === "bank" ? rupees(a.balancePaise) : `owes ${rupees(a.outstandingPaise)}`}</span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" onClick={() => setAdding(isBank ? "bank" : "card")}>
            {list.length === 0 ? (isBank ? "Add a bank account" : "Add a credit card") : isBank ? "Add another account" : "Add another card"}
          </Button>
        </Shell>
        {adding && (
          <Sheet title={adding === "bank" ? "Add a bank account" : "Add a credit card"} onClose={() => setAdding(null)}>
            <AccountForm kind={adding} onDone={() => setAdding(null)} />
          </Sheet>
        )}
      </>
    );
  }

  if (step === "telegram") {
    return (
      <Shell {...shared} title="Talk to me on Telegram" lead="Link your chat and you can log an expense by typing it, ask how you are doing, and get reminders before card payments. This is optional." footer={
        <Button onClick={next}>{me.data?.telegramLinked ? "Continue" : "Skip for now"}</Button>
      }>
        <TelegramCard />
      </Shell>
    );
  }

  return (
    <Shell {...shared} title="All set." lead={
      banks.length + cards.length > 0
        ? "That is everything I need. Your numbers are ready on the home page. You can change any of this later under More."
        : "You have no accounts yet, so the home page will be quiet. Add them whenever you like under Accounts and cards. Setup can be reopened under More."
    } footer={
      <Button disabled={finish.isPending} onClick={() => finish.mutate()}>
        Take me to Alfred
      </Button>
    }>
      <ErrorText>{error}</ErrorText>
    </Shell>
  );
}
