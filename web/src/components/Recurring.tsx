import { useState } from "react";
import { occurrencesBetween, type RuleShape } from "../../../src/domain/recurring";
import { type RecurringRule, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useAccounts, useCategories, useHoldings, useRecurring, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { AmountInput, Button, Card, Empty, ErrorText, Field, Sheet, inputClass } from "./ui";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KINDS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "investment", label: "Investment" },
] as const;

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

function RuleSheet({ rule, onClose }: { rule: RecurringRule | null; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const { run, error, setError, busy } = useAction(onClose);
  const editing = rule !== null;

  const [title, setTitle] = useState(rule?.title ?? "");
  const [type, setType] = useState<RecurringRule["type"]>(rule?.type ?? "expense");
  const [amount, setAmount] = useState(rule ? paiseToInput(rule.amountPaise) : "");
  const [accountId, setAccountId] = useState(rule?.accountId ?? "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [frequency, setFrequency] = useState<RecurringRule["frequency"]>(rule?.frequency ?? "monthly");
  const [day, setDay] = useState(rule?.day ?? Number(today().slice(8, 10)));
  const [month, setMonth] = useState(rule?.month ?? Number(today().slice(5, 7)));
  const [startDate, setStartDate] = useState(rule?.startDate ?? today());
  const [endDate, setEndDate] = useState(rule?.endDate ?? "");
  const [mode, setMode] = useState<RecurringRule["mode"]>(rule?.mode ?? "auto");
  const [holdingId, setHoldingId] = useState(rule?.holdingId ?? "");
  const holdings = useHoldings("active").data?.holdings ?? [];
  const [remind, setRemind] = useState(rule?.remindDaysBefore ? String(rule.remindDaysBefore) : "");

  const usable = (accounts.data ?? []).filter((a) => !a.archived || a.id === rule?.accountId).filter((a) => type !== "investment" || a.kind === "bank");
  const chosenAccount = usable.find((a) => a.id === accountId)?.id ?? usable[0]?.id ?? "";
  const kindCategories = (categories.data ?? []).filter((c) => c.kind === type && (!c.archived || c.id === rule?.categoryId));
  const effectiveDay = frequency === "weekly" ? Math.min(7, Math.max(1, day)) : day;

  // What it will do, shown before anything is saved.
  const shape: RuleShape = { frequency, day: effectiveDay, month: frequency === "yearly" ? month : null, startDate: editing ? today() : startDate, endDate: endDate || null };
  const upcoming = occurrencesBetween(shape, today(), "2100-01-01").slice(0, 3);
  const missed = !editing && startDate < today() ? occurrencesBetween(shape, startDate, today()).length : 0;

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!title.trim()) return setError("Say what it is, such as Rent or Netflix.");
    if (!paise) return setError("Enter the amount, such as 22000.");
    if (!chosenAccount) return setError("Add an account first.");
    const common = {
      title: title.trim(),
      amountPaise: paise,
      accountId: chosenAccount,
      categoryId: type === "investment" ? null : categoryId || null,
      frequency,
      day: effectiveDay,
      month: frequency === "yearly" ? month : null,
      endDate: endDate || null,
      mode,
      remindDaysBefore: remind ? Number(remind) : null,
      holdingId: type === "investment" && holdingId ? holdingId : null,
    };
    void run(
      () => (rule ? api.patch(`/api/recurring/${rule.id}`, common) : api.post("/api/recurring", { ...common, type, startDate })),
      rule ? "Saved." : missed > 0 ? `Added, with ${Math.min(missed, 36)} earlier ${Math.min(missed, 36) === 1 ? "entry" : "entries"}.` : "Added.",
    );
  };

  return (
    <Sheet title={editing ? "Edit recurring entry" : "Add something that repeats"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="What is it?">
          <input className={inputClass} maxLength={80} autoComplete="off" placeholder="Rent" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {!editing && (
          <div role="radiogroup" aria-label="Kind" className="grid grid-cols-3 gap-1 rounded-xl bg-sunk p-1">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={type === k.value}
                onClick={() => {
                  setType(k.value);
                  setCategoryId("");
                }}
                className={`min-h-11 rounded-lg text-sm font-medium ${type === k.value ? "bg-card shadow-sm" : "text-soft"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
        <Field label="Amount (₹)">
          <AmountInput className={inputClass} autoComplete="off" placeholder="22000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={type === "income" ? "Paid into" : "Paid from"}>
          <select className={inputClass} value={chosenAccount} onChange={(e) => setAccountId(e.target.value)}>
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.kind === "card" ? " (card)" : ""}
              </option>
            ))}
          </select>
        </Field>
        {type === "investment" && holdings.length > 0 && (
          <Field label="Adds to" hint="Pick the investment this SIP buys, so each instalment counts toward what you have put in.">
            <select className={inputClass} value={holdingId} onChange={(e) => setHoldingId(e.target.value)}>
              <option value="">None</option>
              {holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {type !== "investment" && (
          <Field label="Category">
            <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeats">
            <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringRule["frequency"])}>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </select>
          </Field>
          {frequency === "weekly" ? (
            <Field label="On">
              <select className={inputClass} value={effectiveDay} onChange={(e) => setDay(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={frequency === "yearly" ? "Day" : "On the"}>
              <select className={inputClass} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d === 31 ? "31 (or the last day)" : d}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {frequency === "yearly" && (
          <Field label="Month">
            <select className={inputClass} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!editing && (
            <Field label="Starts on">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
          )}
          <Field label="Ends on (optional)">
            <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="How should it be added?" hint={mode === "draft" ? "Alfred adds a draft and asks you to confirm the amount. A draft does not count until you do." : "Alfred adds it by itself on the day, and it counts straight away."}>
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as RecurringRule["mode"])}>
            <option value="auto">Add it automatically (a fixed amount)</option>
            <option value="draft">Add a draft for me to confirm (the amount varies)</option>
          </select>
        </Field>
        <Field label="Remind me on Telegram">
          <select className={inputClass} value={remind} onChange={(e) => setRemind(e.target.value)}>
            <option value="">No reminder</option>
            {[1, 2, 3, 5, 7].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "day" : "days"} before
              </option>
            ))}
          </select>
        </Field>
        {upcoming.length > 0 && <p className="rounded-lg bg-sunk px-3 py-2 text-sm">Next: {upcoming.map((d) => shortDate(d)).join(", ")}.</p>}
        {missed > 0 && (
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
            That start date is in the past, so {Math.min(missed, 36)} earlier {Math.min(missed, 36) === 1 ? "entry is" : "entries are"} added now{missed > 36 ? " (the latest 36)" : ""}.
          </p>
        )}
        {editing && <p className="text-xs text-soft">Changes apply to the next entries. Ones already added stay as they are. Changing how it repeats starts the new pattern from today.</p>}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {rule && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${rule.title}? Entries it already added stay.`)) void run(() => api.del(`/api/recurring/${rule.id}`), "Deleted.");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

function Row({ rule, onEdit, onAct }: { rule: RecurringRule; onEdit: () => void; onAct: (what: "pause" | "resume" | "skip") => void }) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">
          {rule.title}
          {rule.mode === "draft" && <span className="ml-2 text-xs font-normal text-faint">asks you to confirm</span>}
          {rule.status === "paused" && <span className="ml-2 text-xs font-normal text-faint">paused</span>}
          {rule.status === "ended" && <span className="ml-2 text-xs font-normal text-faint">ended</span>}
        </span>
        <span className={`shrink-0 font-semibold tabular-nums ${rule.type === "income" ? "text-good" : ""}`}>
          {rule.type === "income" ? "+" : ""}
          {rupees(rule.amountPaise)}
        </span>
      </div>
      <p className="text-sm text-soft">
        {rule.repeat} · {rule.type === "income" ? "into" : "from"} {rule.accountName}
        {rule.nextDate && rule.status !== "ended" && <> · next {shortDate(rule.nextDate)}</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={onEdit}>
          Edit
        </Button>
        {rule.status === "active" && (
          <>
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("skip")}>
              Skip next
            </Button>
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("pause")}>
              Pause
            </Button>
          </>
        )}
        {rule.status === "paused" && (
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("resume")}>
            Resume
          </Button>
        )}
      </div>
    </li>
  );
}

/** Rent, subscriptions, salary, SIPs: added on their day, automatically or as a draft to confirm. */
export function Recurring() {
  const rules = useRecurring();
  const accounts = useAccounts();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ rule: RecurringRule | null } | null>(null);
  const [error, setError] = useState("");

  if (!(accounts.data ?? []).some((a) => !a.archived)) return null;
  const items = rules.data ?? [];

  const act = async (rule: RecurringRule, what: "pause" | "resume" | "skip") => {
    setError("");
    try {
      await api.post(`/api/recurring/${rule.id}/${what}`);
      await refresh();
      toast.show(what === "skip" ? `Skipped the next ${rule.title}.` : what === "pause" ? `${rule.title} paused.` : `${rule.title} resumed.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-soft">{items.length === 0 ? "Nothing repeats yet" : `${items.length} ${items.length === 1 ? "rule" : "rules"}`}</p>
        <Button onClick={() => setSheet({ rule: null })}>Add recurring</Button>
      </div>
      {items.length === 0 ? (
        <Empty title="No recurring entries yet">Rent, subscriptions, salary, SIPs: add them once and Alfred records them on their day, or asks you to confirm when the amount varies.</Empty>
      ) : (
        <Card pad="p-0">
          <ul className="divide-y divide-line">
            {items.map((r) => (
              <Row key={r.id} rule={r} onEdit={() => setSheet({ rule: r })} onAct={(what) => void act(r, what)} />
            ))}
          </ul>
        </Card>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {sheet && <RuleSheet key={sheet.rule?.id ?? "new"} rule={sheet.rule} onClose={() => setSheet(null)} />}
    </div>
  );
}
