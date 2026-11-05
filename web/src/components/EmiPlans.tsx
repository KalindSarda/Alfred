import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { instalmentSchedule, isValidStartMonth, startMonthLabel } from "../../../src/domain/emi";
import { calcSchedule, feeWithGst } from "../../../src/domain/emiCalc";
import { type CardAccount, type EmiPlan, type Transaction, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useAccounts, useCategories, useEmiPlans, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

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

function PlanSheet({ plan, onClose }: { plan: EmiPlan | null; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const cards = (accounts.data ?? []).filter((a): a is CardAccount => a.kind === "card" && !a.archived);
  const { run, error, setError, busy } = useAction(onClose);

  const [cardId, setCardId] = useState(plan?.cardAccountId ?? "");
  const [title, setTitle] = useState(plan?.title ?? "");
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? "");
  const [total, setTotal] = useState(plan ? paiseToInput(plan.totalPaise) : "");
  const [months, setMonths] = useState(plan ? String(plan.months) : "6");
  const [rate, setRate] = useState("");
  const [instalment, setInstalment] = useState("");
  const [fee, setFee] = useState("");
  const [gst, setGst] = useState("18");
  const [gstOnInterest, setGstOnInterest] = useState(false);
  const [feeDate, setFeeDate] = useState(today());
  const [startMonth, setStartMonth] = useState(plan?.startMonth ?? today().slice(0, 7));
  // Months the person typed over, by position. Anything else follows the calculation.
  const [edits, setEdits] = useState<Record<number, string>>(() =>
    plan?.uneven ? Object.fromEntries(plan.scheduleAmountsPaise.map((a, i) => [i, paiseToInput(a)])) : {},
  );
  const [replaces, setReplaces] = useState("");
  // A closed plan keeps its amounts until it is reopened; any other can be corrected.
  const frozen = plan?.status === "cancelled";
  const card = cards.find((c) => c.id === (cardId || cards[0]?.id));
  const chosenCard = card?.id ?? "";

  const purchases = useQuery({
    queryKey: ["emi-purchases", chosenCard],
    queryFn: async () => (await api.get<{ items: Transaction[] }>(`/api/transactions?accountId=${chosenCard}&type=expense&limit=30`)).items,
    enabled: !plan && chosenCard !== "",
  });

  const principal = rupeesToPaise(total);
  const monthsN = Number(months);
  const monthsOk = Number.isInteger(monthsN) && monthsN >= 1 && monthsN <= 60;
  const ratePct = rate.trim() === "" ? 0 : Number(rate);
  const rateOk = Number.isFinite(ratePct) && ratePct >= 0 && ratePct <= 100;
  const gstPct = gst.trim() === "" ? 0 : Number(gst);
  const instalmentPaise = instalment.trim() ? rupeesToPaise(instalment) : null;

  // What the bank's formula gives; every row can still be typed over.
  const calculated = useMemo(() => {
    if (!principal || !monthsOk || !rateOk) return [];
    if (instalmentPaise) return Array.from({ length: monthsN }, (_, i) => ({ n: i + 1, principalPaise: 0, interestPaise: 0, gstPaise: 0, instalmentPaise }));
    return calcSchedule({ principalPaise: principal, annualRatePct: ratePct, months: monthsN, gstPct, gstOnInterest });
  }, [principal, monthsOk, rateOk, instalmentPaise, monthsN, ratePct, gstPct, gstOnInterest]);

  const rowText = (i: number) => edits[i] ?? (calculated[i] ? paiseToInput(calculated[i]!.instalmentPaise) : "");
  const rowsParsed = calculated.map((_, i) => rupeesToPaise(rowText(i)));
  const rowsValid = calculated.length > 0 && rowsParsed.every((p) => p !== null && p > 0);
  const amounts = rowsValid ? (rowsParsed as number[]) : null;
  const typedOver = Object.keys(edits).length > 0;
  const sum = amounts ? amounts.reduce((s, a) => s + a, 0) : 0;
  const interest = calculated.reduce((s, r) => s + r.interestPaise, 0);
  const gstTotal = calculated.reduce((s, r) => s + r.gstPaise, 0);
  const feeBase = fee.trim() ? rupeesToPaise(fee) : 0;
  const feeTotal = feeBase ? feeWithGst(feeBase, Number.isFinite(gstPct) ? gstPct : 0) : 0;

  // The date each month is billed, from the card's statement day.
  const dates = useMemo(
    () => (card && isValidStartMonth(startMonth) && monthsOk ? instalmentSchedule({ totalPaise: monthsN, months: monthsN, instalmentPaise: 1, startMonth }, { statementDay: card.statementDay, dueDay: card.dueDay }).map((i) => i.date) : []),
    [card, startMonth, monthsN, monthsOk],
  );

  // A change to the figures behind the calculation starts the rows afresh.
  const restart = (fn: () => void) => {
    fn();
    setEdits({});
  };

  const save = () => {
    if (!title.trim()) return setError("Say what it is, such as the phone.");
    if (plan && frozen) {
      const body = { title: title.trim(), categoryId: categoryId || null };
      return void run(() => api.patch(`/api/emi-plans/${plan.id}`, body), "Saved.");
    }
    if (!chosenCard) return setError("Add a credit card first.");
    if (!isValidStartMonth(startMonth)) return setError("Choose the starting month.");
    if (!principal) return setError("Enter the amount that was converted, such as 122000.");
    if (!monthsOk) return setError("Months must be between 1 and 60.");
    if (!rateOk) return setError("The interest rate looks wrong. Leave it empty for none.");
    if (instalment.trim() && !instalmentPaise) return setError("The monthly instalment looks wrong.");
    if (!amounts) return setError("Every month needs an amount, such as 20500.");
    if (fee.trim() && !feeBase) return setError("The processing fee looks wrong. Leave it empty for none.");
    // Equal months with nothing typed over are saved as an even plan; anything else is saved month by month.
    const even = !typedOver && !instalmentPaise && ratePct === 0;
    const body = {
      title: title.trim(),
      categoryId: categoryId || null,
      months: monthsN,
      startMonth,
      ...(even ? { totalPaise: principal } : { instalmentsPaise: amounts }),
    };
    void run(
      () =>
        plan
          ? api.patch(`/api/emi-plans/${plan.id}`, body)
          : api.post("/api/emi-plans", {
              ...body,
              cardAccountId: chosenCard,
              ...(replaces ? { replacesTransactionId: replaces } : {}),
              ...(feeTotal ? { feePaise: feeTotal, feeDate } : {}),
            }),
      plan ? "Saved." : "EMI plan added.",
    );
  };

  return (
    <Sheet title={plan ? "Edit EMI plan" : "Add an EMI plan"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Card">
          <select className={inputClass} value={chosenCard} disabled={Boolean(plan)} onChange={(e) => setCardId(e.target.value)}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is it?">
          <input className={inputClass} maxLength={80} autoComplete="off" placeholder="Phone" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Category" hint="The instalments are filed under it, so your spending and budgets follow.">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Uncategorized</option>
            {(categories.data ?? [])
              .filter((c) => c.kind === "expense" && (!c.archived || c.id === plan?.categoryId))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>

        {!frozen && (
          <>
            <Field label="Amount converted to EMI (₹)" hint="The purchase amount the bank converted, before interest.">
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="122000" value={total} onChange={(e) => restart(() => setTotal(e.target.value))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Months">
                <input className={inputClass} type="number" min={1} max={60} value={months} onChange={(e) => restart(() => setMonths(e.target.value))} />
              </Field>
              <Field label="Interest, % a year">
                <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="16, or empty for none" value={rate} onChange={(e) => restart(() => setRate(e.target.value))} />
              </Field>
            </div>
            <Field label="Starting month" hint="The month of the first statement that carries an instalment.">
              <input className={inputClass} type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
            </Field>
            {!plan && (
              <div className="space-y-3 rounded-xl bg-sunk p-3">
                <p className="text-sm font-medium">One-off processing fee (optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fee (₹)">
                    <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="299" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </Field>
                  <Field label="GST, %">
                    <input className={inputClass} inputMode="decimal" autoComplete="off" value={gst} onChange={(e) => restart(() => setGst(e.target.value))} />
                  </Field>
                </div>
                {feeTotal > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    <p className="text-sm">
                      Added as one expense of <strong>{rupees(feeTotal)}</strong>.
                    </p>
                    <Field label="Billed on">
                      <input className={inputClass} type="date" value={feeDate} max={today()} onChange={(e) => setFeeDate(e.target.value)} />
                    </Field>
                  </div>
                )}
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input type="checkbox" className="mt-1 size-5 accent-brand" checked={gstOnInterest} onChange={(e) => restart(() => setGstOnInterest(e.target.checked))} />
                  <span>
                    The bank also adds GST to the interest
                    <span className="block text-xs text-soft">Leave off unless your statement shows it. HDFC's showed GST only on the fee.</span>
                  </span>
                </label>
              </div>
            )}
            <Field label="Monthly instalment (optional)" hint="If you already know it, type it and every month is filled with it.">
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="Leave empty to calculate" value={instalment} onChange={(e) => restart(() => setInstalment(e.target.value))} />
            </Field>

            {calculated.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">Each month</p>
                  {typedOver && (
                    <button type="button" className="min-h-11 text-sm text-brand" onClick={() => setEdits({})}>
                      Reset to calculated
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-line rounded-xl border border-line bg-card" aria-label="Instalments">
                  {calculated.map((r, i) => (
                    <li key={r.n} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className="min-w-0 text-sm">
                        <span className="block">
                          {r.n}. {dates[i] ? `${shortDate(dates[i]!)} ${dates[i]!.slice(0, 4)}` : ""}
                        </span>
                        {r.interestPaise > 0 && <span className="block text-xs text-soft">interest {rupees(r.interestPaise)}</span>}
                      </span>
                      <input
                        aria-label={`Instalment ${r.n}`}
                        className={`${inputClass} w-32 text-right tabular-nums`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={rowText(i)}
                        onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
                      />
                    </li>
                  ))}
                </ul>
                <p className="rounded-lg bg-sunk px-3 py-2 text-sm">
                  {amounts ? (
                    <>
                      Total payable <strong>{rupees(sum)}</strong>
                      {!typedOver && interest > 0 && <> · interest {rupees(interest)}</>}
                      {!typedOver && gstTotal > 0 && <> · GST {rupees(gstTotal)}</>}
                      {typedOver && principal && sum > principal && <> · {rupees(sum - principal)} more than converted</>}
                      {feeTotal > 0 && <> · plus the fee {rupees(feeTotal)}</>}.
                    </>
                  ) : (
                    "Fill in every month to see the total."
                  )}
                </p>
                <p className="text-xs text-soft">Worked out the way banks do it. Your bank's first and last months can differ a little: type over any month with what its schedule shows.</p>
              </div>
            )}
          </>
        )}

        {!plan && (
          <Field label="Is this purchase already in your entries?" hint="If so, pick it and it is removed, so the phone is not counted twice.">
            <select className={inputClass} value={replaces} onChange={(e) => setReplaces(e.target.value)}>
              <option value="">No</option>
              {(purchases.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {rupees(t.amountPaise)} · {t.merchant || "Expense"} · {shortDate(t.txnDate)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {frozen && <p className="text-xs text-soft">This plan is closed, so only the name and category can change. Reopen it to correct the amounts.</p>}
        {plan?.locked && !frozen && (
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
            Instalments have already been added. Saving new amounts, months or a starting month removes them and adds them again from these details. To correct just one month, close this and use Schedule on the plan instead.
          </p>
        )}
        {!frozen && (
          <p className="text-xs text-soft">
            Each month Alfred adds the instalment as an expense on the card, on its statement day. The full amount stays held against the limit
            {card ? ` (the ${startMonthLabel(startMonth)} start is the first statement that carries an instalment)` : ""}.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {plan && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const text = plan.locked
                  ? `Delete this plan and the ${plan.billedCount === 1 ? "instalment" : "instalments"} Alfred added for it? The card's balance falls back accordingly. This cannot be undone.`
                  : "Delete this plan? Nothing has been added yet.";
                if (window.confirm(text)) void run(() => api.del(`/api/emi-plans/${plan.id}${plan.locked ? "?instalments=remove" : ""}`), "Plan deleted.");
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

/** Every month of a plan with its amount, billed or still to come. Any month can be set to what the statement shows. */
function Schedule({ plan, statement }: { plan: EmiPlan; statement: { statementDay: number; dueDay: number } | null }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = statement
    ? instalmentSchedule({ totalPaise: plan.totalPaise, months: plan.months, instalmentPaise: plan.instalmentPaise, startMonth: plan.startMonth, amountsPaise: plan.scheduleAmountsPaise }, statement)
    : plan.scheduleAmountsPaise.map((amountPaise, i) => ({ n: i + 1, date: "", amountPaise }));

  const save = async (n: number) => {
    const paise = rupeesToPaise(value);
    if (!paise) return setError("Enter the amount, such as 20500.");
    setBusy(true);
    setError("");
    try {
      await api.patch(`/api/emi-plans/${plan.id}/instalments/${n}`, { amountPaise: paise });
      await refresh();
      toast.show(`Instalment ${n} is now ${rupees(paise)}.`);
      setEditing(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <ul className="divide-y divide-line rounded-xl border border-line bg-card" aria-label={`${plan.title} schedule`}>
        {rows.map((r) => (
          <li key={r.n} className="flex min-h-12 items-center justify-between gap-3 px-3 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="block">
                {r.n}. {r.date ? `${shortDate(r.date)} ${r.date.slice(0, 4)}` : ""}
              </span>
              <span className="block text-xs text-soft">{r.n <= plan.billedCount ? "billed" : "to come"}</span>
            </span>
            {editing === r.n ? (
              <span className="flex items-center gap-2">
                <input
                  aria-label={`Instalment ${r.n} amount`}
                  className={`${inputClass} w-28 text-right tabular-nums`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <Button className="min-h-11 py-1.5 text-sm" disabled={busy} onClick={() => void save(r.n)}>
                  Save
                </Button>
                <button type="button" className="min-h-11 px-1 text-soft" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="font-medium tabular-nums">{rupees(r.amountPaise)}</span>
                {plan.status !== "cancelled" && (
                  <button
                    type="button"
                    className="min-h-11 px-2 text-brand"
                    onClick={() => {
                      setEditing(r.n);
                      setValue(paiseToInput(r.amountPaise));
                      setError("");
                    }}
                  >
                    Edit
                  </button>
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

function Row({ plan, statement, onEdit, onClose, onReopen }: { plan: EmiPlan; statement: { statementDay: number; dueDay: number } | null; onEdit: () => void; onClose: () => void; onReopen: () => void }) {
  const [showing, setShowing] = useState(false);
  const pct = Math.min(100, Math.round((plan.billedCount / plan.months) * 100));
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">
          {plan.title}
          {plan.status === "cancelled" && <span className="ml-2 text-xs font-normal text-faint">closed</span>}
          {plan.status === "finished" && <span className="ml-2 text-xs font-normal text-faint">finished</span>}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{rupees(plan.totalPaise)}</span>
      </div>
      <div role="progressbar" aria-label={`${plan.title} instalments billed`} aria-valuemin={0} aria-valuemax={plan.months} aria-valuenow={plan.billedCount} className="h-2 overflow-hidden rounded-full bg-sunk">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-soft">
        {plan.billedCount} of {plan.months} billed on {plan.cardName}
        {plan.status === "active" && plan.nextDate && plan.nextAmountPaise !== null && (
          <>
            {" "}
            · {rupees(plan.toComePaise)} still to come · next {rupees(plan.nextAmountPaise)} on {shortDate(plan.nextDate)}
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" aria-expanded={showing} onClick={() => setShowing(!showing)}>
          {showing ? "Hide schedule" : "Schedule"}
        </Button>
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={onEdit}>
          Edit
        </Button>
        {plan.status === "active" && (
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={onClose}>
            Close plan
          </Button>
        )}
        {plan.status === "cancelled" && (
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={onReopen}>
            Reopen
          </Button>
        )}
      </div>
      {showing && <Schedule plan={plan} statement={statement} />}
    </li>
  );
}

/** Credit card EMI plans: the whole amount stays held on the card, and one instalment a month becomes an expense. */
export function EmiPlans() {
  const plans = useEmiPlans();
  const accounts = useAccounts();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ plan: EmiPlan | null } | null>(null);
  const [error, setError] = useState("");

  if (!(accounts.data ?? []).some((a) => a.kind === "card" && !a.archived)) return null;
  const items = plans.data ?? [];
  const statementOf = (cardId: string) => {
    const c = (accounts.data ?? []).find((a): a is CardAccount => a.kind === "card" && a.id === cardId);
    return c ? { statementDay: c.statementDay, dueDay: c.dueDay } : null;
  };
  const toCome = items.filter((p) => p.status === "active").reduce((sum, p) => sum + p.toComePaise, 0);

  const closePlan = async (p: EmiPlan) => {
    if (!window.confirm(`Close ${p.title}? No more instalments are added. Those already added stay. If you foreclosed with the bank, also log the charge and your payment as usual.`)) return;
    setError("");
    try {
      await api.post(`/api/emi-plans/${p.id}/cancel`);
      await refresh();
      toast.show(`${p.title} closed.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const reopenPlan = async (p: EmiPlan) => {
    setError("");
    try {
      await api.post(`/api/emi-plans/${p.id}/reopen`);
      await refresh();
      toast.show(`${p.title} reopened.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <Card id="emi" pad="p-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-sm font-medium text-soft">
          EMI plans{toCome > 0 && <span className="ml-2 font-semibold text-ink tabular-nums">{rupees(toCome)} to come</span>}
        </h2>
        <Button className="shrink-0" onClick={() => setSheet({ plan: null })}>Add an EMI plan</Button>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-soft">
          Converted a purchase to EMI? Add it here. The whole amount stays held on the card, and each month's instalment is added for you.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((p) => (
            <Row key={p.id} plan={p} statement={statementOf(p.cardAccountId)} onEdit={() => setSheet({ plan: p })} onClose={() => void closePlan(p)} onReopen={() => void reopenPlan(p)} />
          ))}
        </ul>
      )}
      {error && (
        <div className="px-4 pb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {sheet && <PlanSheet key={sheet.plan?.id ?? "new"} plan={sheet.plan} onClose={() => setSheet(null)} />}
    </Card>
  );
}
