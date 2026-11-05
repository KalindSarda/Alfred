import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { bpFromPct, emiClearsLoan, firstDueAfter, levelEmi, projectSchedule } from "../../../src/domain/loans";
import { type Loan, type LoanScheduleRow, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useAccounts, useLoans, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

const KINDS: { value: Loan["kind"]; label: string }[] = [
  { value: "home", label: "Home loan" },
  { value: "car", label: "Car or vehicle" },
  { value: "personal", label: "Personal loan" },
  { value: "education", label: "Education loan" },
  { value: "other", label: "Other" },
];
const kindLabel = (k: Loan["kind"]) => KINDS.find((x) => x.value === k)?.label ?? "Loan";

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

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

function LoanSheet({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank" && !a.archived);
  const { run, error, setError, busy } = useAction(onClose);
  const [name, setName] = useState(loan?.name ?? "");
  const [lender, setLender] = useState(loan?.lender ?? "");
  const [kind, setKind] = useState<Loan["kind"]>(loan?.kind ?? "home");
  const [accountId, setAccountId] = useState(loan?.accountId ?? "");
  const [owed, setOwed] = useState("");
  const [rate, setRate] = useState("");
  const [months, setMonths] = useState("");
  const [emi, setEmi] = useState(loan ? paiseToInput(loan.emiPaise) : "");
  const [dueDay, setDueDay] = useState(loan ? String(loan.dueDay) : "");
  const [asOf, setAsOf] = useState(today());
  const bank = accountId || banks[0]?.id || "";

  const principal = rupeesToPaise(owed);
  const ratePct = rate.trim() === "" ? NaN : Number(rate);
  const monthsN = Number(months);
  const day = Number(dueDay);
  const calcOk = !loan && principal !== null && Number.isFinite(ratePct) && ratePct >= 0 && Number.isInteger(monthsN) && monthsN >= 1 && monthsN <= 600;
  const calculated = useMemo(() => (calcOk ? levelEmi(principal as number, bpFromPct(ratePct), monthsN) : 0), [calcOk, principal, ratePct, monthsN]);
  const typedEmi = emi.trim() ? rupeesToPaise(emi) : null;
  const effectiveEmi = typedEmi ?? (calculated || null);
  const preview = useMemo(() => {
    if (loan || !principal || !effectiveEmi || !Number.isFinite(ratePct) || !(day >= 1 && day <= 31)) return null;
    const rows = projectSchedule(principal, bpFromPct(ratePct), effectiveEmi, firstDueAfter(asOf, day), day);
    return rows.length ? { months: rows.length, last: rows[rows.length - 1]!.date, interest: rows.reduce((s, r) => s + r.interestPaise, 0) } : null;
  }, [loan, principal, effectiveEmi, ratePct, day, asOf]);

  const save = () => {
    if (!name.trim()) return setError("Name it, such as Home loan.");
    if (!bank) return setError("Add a bank account first.");
    if (!(day >= 1 && day <= 31)) return setError("The due day is a day of the month, from 1 to 31.");
    if (loan) {
      if (typedEmi === null && emi.trim()) return setError("The EMI looks wrong.");
      return void run(
        () => api.patch(`/api/loans/${loan.id}`, { name: name.trim(), lender: lender.trim() || null, kind, accountId: bank, dueDay: day, ...(typedEmi ? { emiPaise: typedEmi } : {}) }),
        "Saved.",
      );
    }
    if (!principal) return setError("Enter what is still owed, such as 1000000.");
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) return setError("Enter the yearly interest rate, such as 8.5.");
    if (typedEmi === null && emi.trim()) return setError("The EMI looks wrong.");
    if (!typedEmi && !(Number.isInteger(monthsN) && monthsN >= 1 && monthsN <= 600)) return setError("Enter the months left, or the EMI.");
    if (effectiveEmi && !emiClearsLoan(principal, bpFromPct(ratePct), effectiveEmi)) return setError("That EMI is too small to ever clear the loan at this rate.");
    void run(
      () =>
        api.post("/api/loans", {
          name: name.trim(),
          lender: lender.trim() || null,
          kind,
          accountId: bank,
          principalPaise: principal,
          ratePct,
          dueDay: day,
          asOf,
          ...(typedEmi ? { emiPaise: typedEmi } : { months: monthsN }),
        }),
      "Loan added.",
    );
  };

  return (
    <Sheet title={loan ? "Edit loan" : "Add a bank loan"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="What is it?">
          <input className={inputClass} maxLength={40} autoComplete="off" placeholder="Home loan" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Loan["kind"])}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lender (optional)">
            <input className={inputClass} maxLength={60} autoComplete="off" placeholder="SBI" value={lender} onChange={(e) => setLender(e.target.value)} />
          </Field>
        </div>
        <Field label="Paid from" hint="The bank account the EMI is debited from.">
          <select className={inputClass} value={bank} onChange={(e) => setAccountId(e.target.value)}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        {!loan && (
          <>
            <Field label="Still owed now (₹)" hint="The outstanding principal in your loan statement, not the original loan amount.">
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="1000000" value={owed} onChange={(e) => setOwed(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Interest, % a year">
                <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="8.5" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
              <Field label="Months left">
                <input className={inputClass} type="number" min={1} max={600} value={months} onChange={(e) => setMonths(e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="EMI (₹)" hint={!loan && calculated > 0 ? `Worked out: ${rupees(calculated)}. Type your bank's figure to override.` : undefined}>
            <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder={calculated ? paiseToInput(calculated) : "Calculated"} value={emi} onChange={(e) => setEmi(e.target.value)} />
          </Field>
          <Field label="Due on the (day)">
            <input className={inputClass} type="number" min={1} max={31} placeholder="5" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </Field>
        </div>
        {!loan && (
          <Field label="Owed as of" hint="Earlier than today and Alfred adds the instalments that fell due since.">
            <input className={inputClass} type="date" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        )}
        {preview && (
          <p className="rounded-lg bg-sunk px-3 py-2 text-sm">
            About {preview.months} more instalments, the last around {shortDate(preview.last)} {preview.last.slice(0, 4)}, with {rupees(preview.interest)} of interest in total.
          </p>
        )}
        <p className="text-xs text-soft">Each month Alfred adds the interest as an expense and the principal as a loan payment, from the bank, and asks if it matches. What you owe counts against your net worth.</p>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {loan && loan.instalments.length === 0 && loan.repaidPaise === 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Remove this loan? Nothing has been recorded against it yet.")) void run(() => api.del(`/api/loans/${loan.id}`), "Removed.");
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

function PrepaySheet({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [effect, setEffect] = useState<"shorten" | "lower">("shorten");

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!paise) return setError("Enter the amount you are paying, such as 200000.");
    if (paise > loan.outstandingPaise) return setError(`That is more than the ${rupees(loan.outstandingPaise)} still owed. Foreclose the loan to pay it all.`);
    void run(() => api.post(`/api/loans/${loan.id}/prepay`, { amountPaise: paise, date, effect }), `${rupees(paise)} paid toward ${loan.name}.`);
  };

  return (
    <Sheet title={`Part-pay ${loan.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">It leaves your bank as a loan payment, all of it against the principal. It is not spending.</p>
        <Field label="Amount (₹)">
          <input className={inputClass} inputMode="decimal" autoComplete="off" autoFocus placeholder="200000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="On">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div role="radiogroup" aria-label="What changes" className="space-y-2">
          {(
            [
              ["shorten", "Shorten the loan", "The EMI stays the same and you finish sooner."],
              ["lower", "Lower the EMI", "The end date stays and each instalment is smaller."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex min-h-11 items-start gap-3 text-sm">
              <input type="radio" name="effect" className="mt-1 size-5 accent-brand" checked={effect === value} onChange={() => setEffect(value)} />
              <span>
                {label}
                <span className="block text-xs text-soft">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function RateSheet({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [rate, setRate] = useState(String(loan.ratePct));
  const [keep, setKeep] = useState<"emi" | "tenure">("tenure");

  const save = () => {
    const pct = Number(rate);
    if (!rate.trim() || !Number.isFinite(pct) || pct < 0 || pct > 100) return setError("Enter the new yearly rate, such as 9.25.");
    void run(() => api.post(`/api/loans/${loan.id}/rate`, { ratePct: pct, keep }), `${loan.name} is now at ${pct}%.`);
  };

  return (
    <Sheet title={`New rate for ${loan.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">Now at {loan.ratePct}%. The new rate applies to the instalments still to come.</p>
        <Field label="New rate, % a year">
          <input className={inputClass} inputMode="decimal" autoComplete="off" autoFocus value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <div role="radiogroup" aria-label="What stays" className="space-y-2">
          {(
            [
              ["tenure", "Keep the end date", "The EMI changes to fit."],
              ["emi", "Keep the EMI", "The loan runs shorter or longer."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex min-h-11 items-start gap-3 text-sm">
              <input type="radio" name="keep" className="mt-1 size-5 accent-brand" checked={keep === value} onChange={() => setKeep(value)} />
              <span>
                {label}
                <span className="block text-xs text-soft">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function ForecloseSheet({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [charges, setCharges] = useState("");
  const [date, setDate] = useState(today());

  const save = () => {
    const paise = charges.trim() ? rupeesToPaise(charges) : null;
    if (charges.trim() && !paise) return setError("The charges look wrong. Leave them empty if there are none.");
    void run(() => api.post(`/api/loans/${loan.id}/foreclose`, { date, ...(paise ? { chargesPaise: paise } : {}) }), `${loan.name} is paid off.`);
  };

  return (
    <Sheet title={`Pay off ${loan.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          {rupees(loan.outstandingPaise)} leaves your bank as a loan payment and the loan is closed. Add any foreclosure charges below; they are recorded as an expense.
        </p>
        <Field label="Foreclosure charges (₹, optional)">
          <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="0" value={charges} onChange={(e) => setCharges(e.target.value)} />
        </Field>
        <Field label="On">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Pay off and close
        </Button>
      </form>
    </Sheet>
  );
}

function Schedule({ loan }: { loan: Loan }) {
  const rows = useQuery({ queryKey: ["loan-schedule", loan.id, loan.outstandingPaise, loan.emiPaise, loan.ratePct], queryFn: async () => (await api.get<{ rows: LoanScheduleRow[] }>(`/api/loans/${loan.id}/schedule`)).rows });
  if (rows.isPending) return <p className="text-sm text-soft">Loading…</p>;
  if (rows.isError) return <ErrorText>{describeError(rows.error)}</ErrorText>;
  return (
    <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-card" aria-label={`${loan.name} schedule`}>
      {rows.data.map((r) => (
        <li key={r.n} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
          <span>
            {r.n}. {shortDate(r.date)} {r.date.slice(0, 4)}
            <span className="block text-xs text-soft">
              interest {rupees(r.interestPaise)} · principal {rupees(r.principalPaise)}
            </span>
          </span>
          <span className="text-right tabular-nums">
            <span className="block font-medium">{rupees(r.totalPaise)}</span>
            <span className="block text-xs text-soft">{rupees(r.balancePaise)} left</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Instalments({ loan }: { loan: Loan }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      toast.show(done);
      setEditing(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loan.instalments.length === 0) return <p className="text-sm text-soft">No instalments added yet.</p>;
  return (
    <div className="space-y-1">
      <ul className="divide-y divide-line rounded-xl border border-line bg-card" aria-label={`${loan.name} instalments`}>
        {loan.instalments.map((i) => (
          <li key={i.loanOn} className="flex min-h-12 items-center justify-between gap-3 px-3 py-1.5 text-sm">
            <span>
              {shortDate(i.loanOn)} {i.loanOn.slice(0, 4)}
              <span className="block text-xs text-soft">
                interest {rupees(i.interestPaise)} · principal {rupees(i.principalPaise)}
              </span>
            </span>
            {editing === i.loanOn ? (
              <span className="flex items-center gap-2">
                <input aria-label="Total taken by the bank" className={`${inputClass} w-28 text-right tabular-nums`} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
                <Button
                  className="min-h-11 py-1.5 text-sm"
                  disabled={busy}
                  onClick={() => {
                    const paise = rupeesToPaise(value);
                    if (!paise) return setError("Enter the amount the bank took, such as 32500.");
                    void act(() => api.patch(`/api/loans/${loan.id}/instalments/${i.loanOn}`, { totalPaise: paise }), "Instalment corrected.");
                  }}
                >
                  Save
                </Button>
                <button type="button" className="min-h-11 px-1 text-soft" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="font-medium tabular-nums">{rupees(i.totalPaise)}</span>
                {loan.status === "active" && (
                  <>
                    <button
                      type="button"
                      className="min-h-11 px-2 text-brand"
                      onClick={() => {
                        setEditing(i.loanOn);
                        setValue(paiseToInput(i.totalPaise));
                        setError("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="min-h-11 px-1 text-soft"
                      onClick={() => {
                        if (window.confirm("Remove this instalment? Use it when the bank did not take it. Both entries are removed.")) void act(() => api.del(`/api/loans/${loan.id}/instalments/${i.loanOn}`), "Instalment removed.");
                      }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

type SheetState = { kind: "edit"; loan: Loan | null } | { kind: "prepay" | "rate" | "foreclose"; loan: Loan } | null;

function Row({ loan, onAct }: { loan: Loan; onAct: (what: "edit" | "prepay" | "rate" | "foreclose") => void }) {
  const [show, setShow] = useState<"schedule" | "history" | null>(null);
  const active = loan.status === "active";
  const total = loan.repaidPaise + loan.outstandingPaise;
  const pct = total > 0 ? Math.min(100, Math.round((loan.repaidPaise / total) * 100)) : 100;

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">
          {loan.name}
          <span className="ml-2 text-xs font-normal text-faint">
            {kindLabel(loan.kind)}
            {loan.lender ? ` · ${loan.lender}` : ""}
            {!active && " · paid off"}
          </span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{active ? rupees(loan.outstandingPaise) : rupees(0)}</span>
      </div>
      <div role="progressbar" aria-label={`${loan.name} repaid`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-sunk">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-soft">
        {active ? (
          <>
            EMI {rupees(loan.emiPaise)} on the {ordinal(loan.dueDay)} from {loan.accountName} · {loan.ratePct}% a year
            {loan.nextDueDate && loan.nextInstalment && (
              <>
                {" · next "}
                {rupees(loan.nextInstalment.totalPaise)} on {shortDate(loan.nextDueDate)}
              </>
            )}
          </>
        ) : (
          <>Repaid {rupees(loan.repaidPaise)} · interest paid {rupees(loan.interestPaidPaise)}</>
        )}
      </p>
      {active && loan.payoffDate && (
        <p className="text-xs text-soft">
          About {loan.monthsLeft} {loan.monthsLeft === 1 ? "month" : "months"} left, to {shortDate(loan.payoffDate)} {loan.payoffDate.slice(0, 4)}, with {rupees(loan.interestToGoPaise)} of interest still to pay.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {active && (
          <>
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("prepay")}>
              Part-pay
            </Button>
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("rate")}>
              Change rate
            </Button>
          </>
        )}
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" aria-expanded={show === "schedule"} onClick={() => setShow(show === "schedule" ? null : "schedule")}>
          {show === "schedule" ? "Hide schedule" : "Schedule"}
        </Button>
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" aria-expanded={show === "history"} onClick={() => setShow(show === "history" ? null : "history")}>
          {show === "history" ? "Hide instalments" : "Instalments"}
        </Button>
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("edit")}>
          Edit
        </Button>
        {active && (
          <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("foreclose")}>
            Pay off
          </Button>
        )}
      </div>
      {show === "schedule" && (active ? <Schedule loan={loan} /> : <p className="text-sm text-soft">Nothing left to pay.</p>)}
      {show === "history" && <Instalments loan={loan} />}
    </li>
  );
}

/** Bank loans: what is still owed counts against net worth, and each EMI is split into interest (an expense) and principal. */
export function Loans() {
  const query = useLoans("all");
  const accounts = useAccounts();
  const [sheet, setSheet] = useState<SheetState>(null);

  if (!(accounts.data ?? []).some((a) => a.kind === "bank" && !a.archived)) return null;
  const data = query.data;
  const active = (data?.loans ?? []).filter((l) => l.status === "active");
  const closed = (data?.loans ?? []).filter((l) => l.status === "closed");
  const act = (loan: Loan) => (what: "edit" | "prepay" | "rate" | "foreclose") => setSheet(what === "edit" ? { kind: "edit", loan } : { kind: what, loan });

  return (
    <Card id="loans" pad="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-sm font-medium text-soft">
          Bank loans{data && data.totalOutstandingPaise > 0 && <span className="ml-2 font-semibold text-ink tabular-nums">{rupees(data.totalOutstandingPaise)} owed</span>}
        </h2>
        <Button className="shrink-0" onClick={() => setSheet({ kind: "edit", loan: null })}>
          Add a loan
        </Button>
      </div>

      {active.length === 0 ? (
        <p className="px-4 py-3 text-sm text-soft">
          Have a home, car or personal loan? Add it here. What you still owe counts against your net worth, and each EMI is added for you, with the interest kept apart from the principal.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {active.map((l) => (
            <Row key={l.id} loan={l} onAct={act(l)} />
          ))}
        </ul>
      )}
      {data && active.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-xs text-soft">{rupees(data.monthlyEmiPaise)} a month goes out in EMIs.</p>
      )}

      {closed.length > 0 && (
        <details className="border-t border-line">
          <summary className="min-h-11 cursor-pointer px-4 py-2 text-sm text-soft">Paid off ({closed.length})</summary>
          <ul className="divide-y divide-line">
            {closed.map((l) => (
              <Row key={l.id} loan={l} onAct={act(l)} />
            ))}
          </ul>
        </details>
      )}

      {sheet?.kind === "edit" && <LoanSheet key={sheet.loan?.id ?? "new"} loan={sheet.loan} onClose={() => setSheet(null)} />}
      {sheet?.kind === "prepay" && <PrepaySheet loan={sheet.loan} onClose={() => setSheet(null)} />}
      {sheet?.kind === "rate" && <RateSheet loan={sheet.loan} onClose={() => setSheet(null)} />}
      {sheet?.kind === "foreclose" && <ForecloseSheet loan={sheet.loan} onClose={() => setSheet(null)} />}
    </Card>
  );
}
