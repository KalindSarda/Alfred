import { useState } from "react";
import { type Hold, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useAccounts, useHolds, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

/** Runs one change, refreshes what depends on it, and reports back. Shared by the three sheets below. */
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

function HoldSheet({ hold, onClose }: { hold: Hold | null; onClose: () => void }) {
  const accounts = useAccounts();
  const banks = (accounts.data ?? []).filter((a) => a.kind === "bank");
  const { run, error, setError, busy } = useAction(onClose);
  const [title, setTitle] = useState(hold?.title ?? "");
  const [accountId, setAccountId] = useState(hold?.accountId ?? "");
  const [amount, setAmount] = useState(hold ? paiseToInput(hold.amountPaise) : "");
  const [applied, setApplied] = useState(hold?.appliedDate ?? today());
  const [expected, setExpected] = useState(hold?.expectedDate ?? "");
  const chosen = accountId || banks[0]?.id || "";

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!title.trim()) return setError("Say what it is for, such as the IPO's name.");
    if (!chosen) return setError("Add a bank account first.");
    if (!paise) return setError("Enter the blocked amount, such as 15000.");
    const body = { title: title.trim(), accountId: chosen, amountPaise: paise, appliedDate: applied, expectedDate: expected || null };
    void run(() => (hold ? api.patch(`/api/holds/${hold.id}`, body) : api.post("/api/holds", body)), hold ? "Saved." : "Blocked amount recorded.");
  };

  return (
    <Sheet title={hold ? "Edit blocked amount" : "Block an amount"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="What is it for?">
          <input className={inputClass} maxLength={80} autoComplete="off" placeholder="Tata Technologies IPO" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Blocked in" hint="The bank account the UPI mandate sits on.">
          <select className={inputClass} value={chosen} onChange={(e) => setAccountId(e.target.value)}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount blocked (₹)">
          <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="15000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Applied on">
            <input className={inputClass} type="date" value={applied} onChange={(e) => setApplied(e.target.value)} />
          </Field>
          <Field label="Outcome due (optional)">
            <input className={inputClass} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-soft">With an outcome date, Alfred asks you on that day whether it was allotted.</p>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {hold && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Remove this entry? Use it only for a mistake; for a result, tap Allotted or Not allotted.")) void run(() => api.del(`/api/holds/${hold.id}`), "Removed.");
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

function AllotSheet({ hold, onClose }: { hold: Hold; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [amount, setAmount] = useState(paiseToInput(hold.amountPaise));
  const [date, setDate] = useState(today());
  const paise = rupeesToPaise(amount);
  const released = paise !== null && paise > 0 && paise <= hold.amountPaise ? hold.amountPaise - paise : 0;

  const save = () => {
    if (!paise) return setError("Enter the amount that was debited.");
    if (paise > hold.amountPaise) return setError(`That is more than the ${rupees(hold.amountPaise)} that was blocked.`);
    void run(() => api.post(`/api/holds/${hold.id}/allot`, { amountPaise: paise, date }), "Allotment recorded.");
  };

  return (
    <Sheet title={`${hold.title}: allotted`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          {rupees(hold.amountPaise)} was blocked in {hold.accountName}. Enter what was actually debited. It is recorded as an investment, not as spending.
        </p>
        <Field label="Amount debited (₹)">
          <input className={inputClass} inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Debited on">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {released > 0 && <p className="rounded-lg bg-sunk px-3 py-2 text-sm">{rupees(released)} of the block is released.</p>}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Record allotment
        </Button>
      </form>
    </Sheet>
  );
}

/** Money blocked for IPO applications (UPI mandates) and the like: record it, then say how it went. */
export function BlockedFunds() {
  const holds = useHolds();
  const accounts = useAccounts();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const [sheet, setSheet] = useState<{ kind: "edit"; hold: Hold | null } | { kind: "allot"; hold: Hold } | null>(null);
  const [error, setError] = useState("");

  if (!(accounts.data ?? []).some((a) => a.kind === "bank" && !a.archived)) return null;
  const items = holds.data ?? [];
  const total = items.reduce((sum, h) => sum + h.amountPaise, 0);

  const release = async (h: Hold) => {
    setError("");
    try {
      await api.post(`/api/holds/${h.id}/release`);
      await refresh();
      toast.show(`Released ${rupees(h.amountPaise)} in ${h.accountName}. Nothing was debited.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <Card pad="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-sm font-medium text-soft">
          Blocked for applications{total > 0 && <span className="ml-2 font-semibold text-ink tabular-nums">{rupees(total)}</span>}
        </h2>
        <Button className="shrink-0" onClick={() => setSheet({ kind: "edit", hold: null })}>Block an amount</Button>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-soft">
          Applied for an IPO with a UPI mandate? Record the blocked amount here, so what you can spend stays right until the result.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((h) => (
            <li key={h.id} className="space-y-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{h.title}</span>
                <span className="shrink-0 font-semibold tabular-nums">{rupees(h.amountPaise)}</span>
              </div>
              <p className="text-sm text-soft">
                in {h.accountName}
                {h.expectedDate && (
                  <>
                    {" "}
                    · outcome {h.overdue ? <span className="font-medium text-bad">was due {shortDate(h.expectedDate)}</span> : <>due {shortDate(h.expectedDate)}</>}
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11 py-1.5 text-sm" onClick={() => setSheet({ kind: "allot", hold: h })}>
                  Allotted
                </Button>
                <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => void release(h)}>
                  Not allotted
                </Button>
                <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => setSheet({ kind: "edit", hold: h })}>
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="px-4 pb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {sheet?.kind === "edit" && <HoldSheet hold={sheet.hold} onClose={() => setSheet(null)} />}
      {sheet?.kind === "allot" && <AllotSheet hold={sheet.hold} onClose={() => setSheet(null)} />}
    </Card>
  );
}
