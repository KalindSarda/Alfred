import { useState } from "react";
import { type Debt, type Person, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useAccounts, useDebts, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

/** Runs one change, refreshes what depends on it, and reports back. */
function useAction(onDone?: () => void) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      toast.show(done);
      onDone?.();
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, setError, busy };
}

/** Which bank the money moved through, or neither. The empty value means cash or not tracked. */
function AccountPick({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank");
  return (
    <Field label={label} hint="Choose Cash if it did not go through a bank account; no balance will change.">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option value="">Cash or not tracked</option>
      </select>
    </Field>
  );
}

function AddSheet({ onClose, people }: { onClose: () => void; people: Person[] }) {
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank");
  const { run, error, setError, busy } = useAction(onClose);
  const [direction, setDirection] = useState<"lent" | "borrowed">("lent");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = accountId ?? banks[0]?.id ?? "";
  const known = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!name.trim()) return setError("Whom was it with?");
    if (!paise) return setError("Enter the amount, such as 5000.");
    void run(
      () => api.post("/api/debts", { name: name.trim(), direction, amountPaise: paise, date, dueDate: due || null, note: note.trim() || null, accountId: account || null }),
      direction === "lent" ? `Noted: you lent ${rupees(paise)} to ${name.trim()}.` : `Noted: you borrowed ${rupees(paise)} from ${name.trim()}.`,
    );
  };

  return (
    <Sheet title="Lent or borrowed" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1 text-sm font-medium">
          {(["lent", "borrowed"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => setDirection(d)}
              className={`min-h-11 rounded-lg ${direction === d ? "bg-card shadow-sm" : "text-soft"}`}
            >
              {d === "lent" ? "I lent" : "I borrowed"}
            </button>
          ))}
        </div>
        <Field label={direction === "lent" ? "Lent to" : "Borrowed from"}>
          <input className={inputClass} list="debt-people" maxLength={40} autoComplete="off" placeholder="Rahul" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="debt-people">
            {people.map((p) => (
              <option key={p.contactId} value={p.name} />
            ))}
          </datalist>
        </Field>
        {known?.trusted && direction === "lent" && <p className="-mt-2 text-xs text-soft">{known.name} is trusted, so Alfred will not follow up.</p>}
        <Field label="Amount (₹)">
          <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="5000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <AccountPick label={direction === "lent" ? "Paid from" : "Received in"} value={account} onChange={setAccountId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="On">
            <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Due (optional)">
            <input className={inputClass} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className={inputClass} maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-xs text-soft">
          {direction === "lent"
            ? "Not income or spending. Unless the person is trusted, Alfred asks you on the due date, or 30 days after, whether it was paid."
            : "Not income or spending. If you give a due date, Alfred reminds you the day before and on the day."}
        </p>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

type Mode = "repay" | "settle" | "edit" | null;

function DebtBlock({ debt, person }: { debt: Debt; person: Person }) {
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank");
  const { run, error, setError, busy } = useAction();
  const [mode, setMode] = useState<Mode>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [due, setDue] = useState(debt.dueDate ?? "");
  const account = accountId ?? banks[0]?.id ?? "";
  const lent = debt.direction === "lent";
  const open = debt.status === "open";
  const close = () => setMode(null);

  const repay = async () => {
    const paise = rupeesToPaise(amount);
    if (!paise) return setError("Enter the amount, such as 2000.");
    if (paise > debt.outstandingPaise) return setError(`That is more than the ${rupees(debt.outstandingPaise)} still outstanding.`);
    if (await run(() => api.post(`/api/debts/${debt.id}/payments`, { amountPaise: paise, date, accountId: account || null }), "Repayment recorded.")) {
      setAmount("");
      close();
    }
  };
  const settle = async () => {
    if (await run(() => api.post(`/api/debts/${debt.id}/settle`, { date, accountId: account || null }), "Marked as paid.")) close();
  };
  const saveDue = async () => {
    if (await run(() => api.patch(`/api/debts/${debt.id}`, { dueDate: due || null }), "Saved.")) close();
  };

  const status = !open
    ? debt.forgiven
      ? lent
        ? "Written off"
        : "Forgiven"
      : "Paid in full"
    : null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{lent ? "Lent" : "Borrowed"} {rupees(debt.amountPaise)}</span>
        <span className="shrink-0 font-semibold tabular-nums">{open ? rupees(debt.outstandingPaise) : status}</span>
      </div>
      <p className="text-sm text-soft">
        {shortDate(debt.date)}
        {debt.accountName ? ` · ${debt.accountName}` : " · cash"}
        {debt.dueDate && (
          <>
            {" · "}
            {open && debt.overdue ? <span className="font-medium text-bad">was due {shortDate(debt.dueDate)}</span> : <>due {shortDate(debt.dueDate)}</>}
          </>
        )}
        {debt.paidPaise > 0 && open && <> · {rupees(debt.paidPaise)} {lent ? "received" : "repaid"}</>}
      </p>
      {debt.note && <p className="text-sm">{debt.note}</p>}
      {open && lent && !person.trusted && (
        <p className="text-xs text-soft">
          {debt.followUpStopped ? "Alfred will not follow up on this one." : debt.nextFollowUp ? `Alfred will ask about it on ${shortDate(debt.nextFollowUp)}.` : null}
        </p>
      )}
      {debt.payments.length > 0 && (
        <ul className="space-y-1 text-sm">
          {debt.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-soft">
              <span>
                {shortDate(p.date)} · {rupees(p.amountPaise)} {lent ? "received" : "repaid"}
                {p.accountName ? ` in ${p.accountName}` : ", cash"}
              </span>
              <button
                type="button"
                className="min-h-11 px-2 text-brand"
                onClick={() => {
                  if (window.confirm("Remove this repayment? The bank entry made with it is removed too.")) void run(() => api.del(`/api/debts/${debt.id}/payments/${p.id}`), "Repayment removed.");
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode === "repay" || mode === "settle" ? (
        <div className="space-y-3 rounded-xl bg-sunk p-3">
          {mode === "repay" && (
            <Field label={lent ? "Amount received (₹)" : "Amount repaid (₹)"}>
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder={paiseToInput(debt.outstandingPaise)} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          )}
          {mode === "settle" && <p className="text-sm">{rupees(debt.outstandingPaise)} is {lent ? "received" : "repaid"} in full.</p>}
          <AccountPick label={lent ? "Came into" : "Paid from"} value={account} onChange={setAccountId} />
          <Field label="On">
            <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => void (mode === "repay" ? repay() : settle())}>
              Save
            </Button>
            <Button variant="secondary" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : mode === "edit" ? (
        <div className="space-y-3 rounded-xl bg-sunk p-3">
          <Field label="Due date (optional)">
            <input className={inputClass} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => void saveDue()}>
              Save
            </Button>
            <Button variant="secondary" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        open && (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11 py-1.5 text-sm" onClick={() => setMode("settle")}>
              Paid in full
            </Button>
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => setMode("repay")}>
              Part payment
            </Button>
            <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => setMode("edit")}>
              Due date
            </Button>
            {lent && !person.trusted && (
              <Button
                variant="ghost"
                className="min-h-11 py-1.5 text-sm"
                disabled={busy}
                onClick={() => void run(() => api.patch(`/api/debts/${debt.id}`, { followUpStopped: !debt.followUpStopped }), debt.followUpStopped ? "Alfred will follow up again." : "Alfred will not follow up.")}
              >
                {debt.followUpStopped ? "Follow up again" : "Stop following up"}
              </Button>
            )}
            <Button
              variant="ghost"
              className="min-h-11 py-1.5 text-sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm(lent ? "Write this off? It stops counting as owed to you, and no bank balance changes." : "Mark as forgiven? It stops counting as owed by you, and no bank balance changes.")) void run(() => api.post(`/api/debts/${debt.id}/forgive`), lent ? "Written off." : "Marked as forgiven.");
              }}
            >
              {lent ? "Write off" : "Forgiven"}
            </Button>
          </div>
        )
      )}
      {debt.payments.length === 0 && (
        <button
          type="button"
          className="min-h-11 text-sm text-soft underline"
          onClick={() => {
            if (window.confirm("Remove this entry? Use it only for a mistake. The bank entry made with it is removed too.")) void run(() => api.del(`/api/debts/${debt.id}`), "Removed.");
          }}
        >
          Entered by mistake? Remove it
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </li>
  );
}

function PersonSheet({ personId, onClose }: { personId: string; onClose: () => void }) {
  const all = useDebts("all");
  const { run, error, busy } = useAction();
  const person = all.data?.people.find((p) => p.contactId === personId);
  if (!person) return null;
  const open = person.debts.filter((d) => d.status === "open");
  const settled = person.debts.filter((d) => d.status === "settled");

  return (
    <Sheet title={person.name} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          {person.owedToYouPaise > 0 && <>{person.name} owes you <strong>{rupees(person.owedToYouPaise)}</strong>. </>}
          {person.youOwePaise > 0 && <>You owe {person.name} <strong>{rupees(person.youOwePaise)}</strong>. </>}
          {person.owedToYouPaise === 0 && person.youOwePaise === 0 && <>All settled with {person.name}.</>}
        </p>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-5"
            checked={person.trusted}
            disabled={busy}
            onChange={(e) => void run(() => api.patch(`/api/contacts/${person.contactId}`, { trusted: e.target.checked }), e.target.checked ? `${person.name} is trusted. No follow-ups.` : "Alfred will follow up again.")}
          />
          <span>
            Trusted
            <span className="block text-xs text-soft">Money lent to a trusted person is only recorded; Alfred never follows up.</span>
          </span>
        </label>
        {open.length > 0 && (
          <ul className="divide-y divide-line">
            {open.map((d) => (
              <DebtBlock key={d.id} debt={d} person={person} />
            ))}
          </ul>
        )}
        {settled.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-soft">Settled ({settled.length})</summary>
            <ul className="divide-y divide-line">
              {settled.map((d) => (
                <DebtBlock key={d.id} debt={d} person={person} />
              ))}
            </ul>
          </details>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Sheet>
  );
}

/** Money lent to people and borrowed from them: who owes what, repayments, and who needs no follow-up. */
export function LentBorrowed() {
  const accounts = useAccounts();
  const debts = useDebts("open");
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  if (!(accounts.data ?? []).some((a) => a.kind === "bank" && !a.archived)) return null;
  const data = debts.data;
  const people = data?.people ?? [];

  return (
    <Card pad="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-sm font-medium text-soft">Lent and borrowed</h2>
        <button type="button" onClick={() => setAdding(true)} className="min-h-11 px-2 text-sm font-medium text-brand">
          Add
        </button>
      </div>

      {data && (data.owedToYouPaise > 0 || data.youOwePaise > 0) && (
        <p className="border-b border-line px-4 py-2 text-sm text-soft">
          {data.owedToYouPaise > 0 && <>Owed to you <strong className="text-ink tabular-nums">{rupees(data.owedToYouPaise)}</strong></>}
          {data.owedToYouPaise > 0 && data.youOwePaise > 0 && " · "}
          {data.youOwePaise > 0 && <>You owe <strong className="text-ink tabular-nums">{rupees(data.youOwePaise)}</strong></>}
        </p>
      )}

      {people.length === 0 ? (
        <p className="px-4 py-3 text-sm text-soft">Lent someone money, or borrowed some? Record it here and Alfred keeps track, and follows up on what is owed to you.</p>
      ) : (
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.contactId}>
              <button type="button" onClick={() => setViewing(p.contactId)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-hover">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {p.name}
                    {p.trusted && <span className="ml-2 rounded bg-sunk px-1.5 py-0.5 text-xs font-normal text-soft">trusted</span>}
                  </span>
                  <span className="block truncate text-sm text-soft">
                    {p.debts.some((d) => d.status === "open" && d.overdue) ? <span className="text-bad">overdue</span> : p.owedToYouPaise > 0 ? "owes you" : "you owe"}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{rupees(p.owedToYouPaise + p.youOwePaise)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && <AddSheet people={people} onClose={() => setAdding(false)} />}
      {viewing && <PersonSheet personId={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}
