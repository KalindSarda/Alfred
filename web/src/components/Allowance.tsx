import { useState } from "react";
import { type Allowance, type Reserve, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, rupeesCompact, shortDate } from "../format";
import { useAllowance, useRefreshMoney } from "../queries";
import { Link } from "../router";
import { useToast } from "./toast";
import { AmountInput, Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

/** A thin track with what has been spent filled in, and a tick where an even spread would have put it. */
function PaceBar({ spent, expected }: { spent: number; expected: number }) {
  const top = Math.max(spent, expected, 1);
  const over = spent > expected;
  return (
    <span className="relative block h-2 rounded-full bg-sunk" aria-hidden="true">
      <span className={`block h-full rounded-full ${over ? "bg-warn-ink" : "bg-brand"}`} style={{ width: `${Math.min(100, (spent / top) * 100)}%` }} />
      <span className="absolute top-[-3px] h-3.5 w-0.5 bg-ink" style={{ left: `${Math.min(100, (expected / top) * 100)}%` }} />
    </span>
  );
}

/**
 * This week's allowance: what is left to spend after the money that goes out first, cut into weeks that roll over, with how the
 * period's pace stands and the run of days with no everyday spending.
 */
export function AllowanceCard() {
  const query = useAllowance();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const a = query.data;
  if (!a || !a.week) return null;
  const w = a.week;
  const pct = w.budgetPaise > 0 ? Math.min(100, Math.round((w.spentPaise / w.budgetPaise) * 100)) : w.spentPaise > 0 ? 100 : 0;

  const nothing = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post("/api/allowance/nothing-today", {});
      await refresh();
      toast.show("A quiet day, noted.");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3" id="allowance">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg">This week</h2>
        <span className="text-xs text-soft">
          {shortDate(w.from)} – {shortDate(w.to)} · week {w.index} of {w.of}
        </span>
      </div>

      {a.flexiblePaise <= 0 && (
        <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          Nothing is free to spend once what is due before {shortDate(a.until)}, this month&apos;s goal amounts and what moves first are taken off. The weekly allowance starts when there is something left.
        </p>
      )}
      {w.overPaise > 0 ? (
        <div>
          <p className="font-display text-3xl text-warn-ink tabular-nums">{rupees(w.overPaise)} over</p>
          <p className="mt-1 text-sm text-soft">
            The week allowed {rupees(w.budgetPaise)}.{w.nextWeekPaise !== null ? ` The weeks after now allow about ${rupees(w.nextWeekPaise)} each.` : ""}
          </p>
        </div>
      ) : (
        <div>
          <p className="font-display text-4xl tabular-nums">{rupees(w.leftPaise)}</p>
          <p className="mt-1 text-sm text-soft">
            left of {rupees(w.budgetPaise)}
            {w.daysLeft > 0 && w.leftPaise > 0 ? ` · about ${rupees(w.perDayPaise)} a day for the ${w.daysLeft} ${w.daysLeft === 1 ? "day" : "days"} left` : ""}
          </p>
        </div>
      )}
      <span className="block h-2 overflow-hidden rounded-full bg-sunk" role="img" aria-label={`${pct}% of this week's allowance spent`}>
        <span className={`block h-full rounded-full ${w.overPaise > 0 ? "bg-warn-ink" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </span>

      {a.pace && (
        <div className="space-y-1.5">
          <PaceBar spent={a.pace.spentPaise} expected={a.pace.expectedPaise} />
          <p className={`text-sm ${a.pace.aheadPaise >= 0 ? "text-good" : "text-warn-ink"}`}>
            {a.pace.aheadPaise >= 0 ? `${rupeesCompact(a.pace.aheadPaise)} under the pace for the period` : `${rupeesCompact(-a.pace.aheadPaise)} over the pace for the period`}
            <span className="text-soft"> · spent {rupeesCompact(a.pace.spentPaise)} so far, an even spread would be {rupeesCompact(a.pace.expectedPaise)}</span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunk px-3 py-2">
        <p className="text-sm">
          <span className="font-medium">
            {a.streak.current} no-spend {a.streak.current === 1 ? "day" : "days"} in a row
          </span>
          <span className="text-soft"> · best {a.streak.best}</span>
          {a.streak.todayCounts && <span className="text-good"> · today counts</span>}
        </p>
        {!a.nothingToday && !a.streak.todayCounts && (
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" disabled={busy} onClick={() => void nothing()}>
            Nothing today
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-soft">How this is worked out</summary>
        <ul className="space-y-1 text-soft">
          <li>Free to spend until {shortDate(a.until)}: {rupees(a.freeToSpendPaise)}</li>
          {a.goalsPaise > 0 && <li>Less this month&apos;s goal amounts: {rupees(a.goalsPaise)}</li>}
          {a.reservesPaise > 0 && <li>Less money to move first: {rupees(a.reservesPaise)}</li>}
          <li className="font-medium text-ink">Left to spend: {rupees(Math.max(0, a.flexiblePaise))}, in weeks from {shortDate(a.from)}. What you do not spend rolls into the later weeks.</li>
        </ul>
        <p className="mt-2 text-soft">
          <Link to="/plan" className="text-brand hover:underline">
            Set what moves first →
          </Link>
        </p>
      </details>
    </Card>
  );
}

/** Adds or changes one thing to move first. */
function ReserveSheet({ reserve, onClose }: { reserve: Reserve | null; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [name, setName] = useState(reserve?.name ?? "");
  const [amount, setAmount] = useState(reserve ? paiseToInput(reserve.amountPaise) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const paise = rupeesToPaise(amount);
    if (!name.trim()) return setError("Say what it is, such as Move to savings.");
    if (!paise) return setError("Enter the amount, such as 40000.");
    setBusy(true);
    setError("");
    try {
      if (reserve) await api.patch(`/api/allowance/reserves/${reserve.id}`, { name: name.trim(), amountPaise: paise });
      else await api.post("/api/allowance/reserves", { name: name.trim(), amountPaise: paise });
      await refresh();
      toast.show(reserve ? "Saved." : "Added.");
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title={reserve ? "Edit what moves first" : "Add what moves first"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-sm text-soft">Money you will move out each period before you spend: a transfer to your savings account, or money to invest. It is held back from what you can spend until you mark it moved.</p>
        <Field label="What is it?">
          <input className={inputClass} maxLength={60} autoComplete="off" autoFocus placeholder="Move to savings" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Amount (₹)">
          <AmountInput className={inputClass} autoComplete="off" placeholder="40000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {reserve && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Remove ${reserve.name}?`)) return;
                setBusy(true);
                try {
                  await api.del(`/api/allowance/reserves/${reserve.id}`);
                  await refresh();
                  toast.show("Removed.");
                  onClose();
                } catch (e) {
                  setError(describeError(e));
                  setBusy(false);
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

/** What moves out first each period, ahead of what is called spendable. Marked moved, it stops being held back until the next period. */
export function MoveFirstCard() {
  const query = useAllowance();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ reserve: Reserve | null } | null>(null);
  const [error, setError] = useState("");
  const a: Allowance | undefined = query.data;
  if (!a) return null;

  const toggle = async (r: Reserve) => {
    setError("");
    try {
      await api.post(`/api/allowance/reserves/${r.id}/moved`, { moved: !r.moved });
      await refresh();
      toast.show(r.moved ? `${r.name} is held back again.` : `${r.name} marked moved.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg">Move first</h2>
        <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => setSheet({ reserve: null })}>
          Add
        </Button>
      </div>
      {a.reserves.length === 0 ? (
        <p className="text-sm text-soft">Pay yourself first: list what you move out each period, such as a transfer to savings or money to invest, and the weekly allowance is worked out after it.</p>
      ) : (
        <ul className="divide-y divide-line">
          {a.reserves.map((r) => (
            <li key={r.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block text-xs text-soft">
                  {rupees(r.amountPaise)} · {r.moved ? "moved this period" : "held back until you move it"}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button variant={r.moved ? "ghost" : "secondary"} className="min-h-11 py-1.5 text-sm" onClick={() => void toggle(r)}>
                  {r.moved ? "Undo" : "Moved"}
                </Button>
                <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => setSheet({ reserve: r })}>
                  Edit
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
      {sheet && <ReserveSheet key={sheet.reserve?.id ?? "new"} reserve={sheet.reserve} onClose={() => setSheet(null)} />}
    </Card>
  );
}
