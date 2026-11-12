import { useState } from "react";
import { type Goal, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useGoals, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { AmountInput, Button, Card, Empty, ErrorText, Field, Sheet, inputClass } from "./ui";

/** Runs one change, refreshes what depends on it, and reports back. */
function useAction(onClose: () => void) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      toast.show(done);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };
  return { run, error, setError, busy };
}

function GoalSheet({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? paiseToInput(goal.targetPaise) : "");
  const [date, setDate] = useState(goal?.targetDate ?? "");

  const save = () => {
    const paise = rupeesToPaise(target);
    if (!name.trim()) return setError("Name the goal, such as New laptop.");
    if (!paise) return setError("Enter the amount you are aiming for, such as 60000.");
    const body = { name: name.trim(), targetPaise: paise, targetDate: date || null };
    void run(() => (goal ? api.patch(`/api/goals/${goal.id}`, body) : api.post("/api/goals", body)), goal ? "Saved." : "Goal added.");
  };

  return (
    <Sheet title={goal ? "Edit goal" : "Add a goal"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="What are you saving for?">
          <input className={inputClass} maxLength={40} autoComplete="off" placeholder="New laptop" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Target (₹)">
          <AmountInput className={inputClass} autoComplete="off" placeholder="60000" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="By when (optional)" hint="With a date, Alfred shows what to put aside each month.">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {goal && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const unused = goal.contributions.length === 0;
                const ask = unused ? "Remove this goal?" : "Archive this goal? The money put toward it is released and counts as spendable again.";
                if (window.confirm(ask)) void run(() => (unused ? api.del(`/api/goals/${goal.id}`) : api.post(`/api/goals/${goal.id}/archive`)), unused ? "Removed." : "Archived.");
              }}
            >
              {goal.contributions.length === 0 ? "Remove" : "Archive"}
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function MoneySheet({ goal, taking, onClose }: { goal: Goal; taking: boolean; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!paise) return setError("Enter the amount, such as 5000.");
    if (taking && paise > goal.savedPaise) return setError(`Only ${rupees(goal.savedPaise)} has been put toward this goal.`);
    void run(
      () => api.post(`/api/goals/${goal.id}/contributions`, { amountPaise: taking ? -paise : paise, date, note: note.trim() || null }),
      taking ? `${rupees(paise)} taken out of ${goal.name}.` : `${rupees(paise)} put toward ${goal.name}.`,
    );
  };

  return (
    <Sheet title={taking ? `Take money out of ${goal.name}` : `Put money toward ${goal.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          {taking
            ? "It becomes spendable again. Nothing moves in your bank."
            : "The money stays in your bank. It is only taken off what you can spend, until the goal is done."}
        </p>
        <Field label="Amount (₹)">
          <AmountInput className={inputClass} autoComplete="off" placeholder="5000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="On">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function GoalRow({ goal, onAct }: { goal: Goal; onAct: (what: "add" | "take" | "edit") => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const active = goal.status === "active";

  const act = async (work: () => Promise<unknown>, done: string) => {
    setError("");
    try {
      await work();
      await refresh();
      toast.show(done);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{goal.name}</span>
        <span className="shrink-0 font-semibold tabular-nums">
          {rupees(goal.savedPaise)} <span className="font-normal text-soft">of {rupees(goal.targetPaise)}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={goal.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${goal.name} progress`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${goal.progressPct}%` }} />
      </div>
      <p className="text-sm text-soft">
        {!active ? (
          goal.status === "achieved" ? "Achieved" : "Archived"
        ) : goal.remainingPaise === 0 ? (
          <span className="font-medium text-good">Reached. Mark it achieved once you have spent it.</span>
        ) : (
          <>
            {rupees(goal.remainingPaise)} to go
            {goal.targetDate && (
              <>
                {" · by "}
                {goal.needsAttention ? <span className="font-medium text-bad">{shortDate(goal.targetDate)}</span> : shortDate(goal.targetDate)}
                {goal.monthlyNeededPaise !== null && <> · {rupees(goal.monthlyNeededPaise)} a month</>}
              </>
            )}
          </>
        )}
      </p>
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 py-1.5 text-sm" onClick={() => onAct("add")}>
            Add money
          </Button>
          {goal.savedPaise > 0 && (
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("take")}>
              Take out
            </Button>
          )}
          <Button
            variant="secondary"
            className="min-h-11 py-1.5 text-sm"
            onClick={() => {
              if (window.confirm(goal.savedPaise > 0 ? `Mark ${goal.name} as achieved? The ${rupees(goal.savedPaise)} put toward it counts as spendable again, since you will have spent it.` : `Mark ${goal.name} as achieved?`)) {
                void act(() => api.post(`/api/goals/${goal.id}/achieve`), "Goal achieved.");
              }
            }}
          >
            Achieved
          </Button>
          <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("edit")}>
            Edit
          </Button>
        </div>
      )}
      {goal.contributions.length > 0 && (
        <div>
          <button type="button" className="min-h-9 text-sm text-soft underline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide history" : `History (${goal.contributions.length})`}
          </button>
          {open && (
            <ul className="mt-1 space-y-1 text-sm text-soft">
              {goal.contributions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span>
                    {shortDate(c.date)} · {c.amountPaise > 0 ? "put toward" : "taken out"} {rupees(Math.abs(c.amountPaise))}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                  {active && (
                    <button
                      type="button"
                      className="min-h-11 px-2 text-brand"
                      onClick={() => {
                        if (window.confirm("Remove this entry?")) void act(() => api.del(`/api/goals/${goal.id}/contributions/${c.id}`), "Entry removed.");
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </li>
  );
}

/** Savings goals: money put toward them is set aside, still in the bank but not counted as spendable. */
export function Goals() {
  const query = useGoals("all");
  const [sheet, setSheet] = useState<{ kind: "edit"; goal: Goal | null } | { kind: "add" | "take"; goal: Goal } | null>(null);

  if (query.isPending) return <p className="py-8 text-center text-sm text-soft">Loading…</p>;
  if (query.isError) return <Empty title="Could not load your goals">Check your connection and reload.</Empty>;

  const { goals, setAsidePaise } = query.data;
  const active = goals.filter((g) => g.status === "active");
  const closed = goals.filter((g) => g.status !== "active");
  const act = (goal: Goal) => (what: "add" | "take" | "edit") => setSheet(what === "edit" ? { kind: "edit", goal } : { kind: what, goal });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-soft">{active.length === 0 ? "Nothing set aside yet" : `${rupees(setAsidePaise)} put toward ${active.length} ${active.length === 1 ? "goal" : "goals"}`}</p>
        <Button onClick={() => setSheet({ kind: "edit", goal: null })}>Add goal</Button>
      </div>

      {active.length === 0 ? (
        <Empty title="No savings goals yet">Name something you are saving for, and put money toward it. It stays in your bank, but is held back from what you can spend.</Empty>
      ) : (
        <Card pad="p-0">
          <ul className="divide-y divide-line">
            {active.map((g) => (
              <GoalRow key={g.id} goal={g} onAct={act(g)} />
            ))}
          </ul>
        </Card>
      )}

      {closed.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-soft">Finished and archived ({closed.length})</summary>
          <Card pad="p-0">
            <ul className="divide-y divide-line">
              {closed.map((g) => (
                <GoalRow key={g.id} goal={g} onAct={act(g)} />
              ))}
            </ul>
          </Card>
        </details>
      )}

      {sheet?.kind === "edit" && <GoalSheet goal={sheet.goal} onClose={() => setSheet(null)} />}
      {(sheet?.kind === "add" || sheet?.kind === "take") && <MoneySheet goal={sheet.goal} taking={sheet.kind === "take"} onClose={() => setSheet(null)} />}
    </div>
  );
}
