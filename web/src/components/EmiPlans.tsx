import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { defaultInstalmentPaise, instalmentSchedule, isValidStartMonth, scheduleIsConsistent, startMonthLabel } from "../../../src/domain/emi";
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
  const [instalment, setInstalment] = useState("");
  const [startMonth, setStartMonth] = useState(plan?.startMonth ?? today().slice(0, 7));
  // The bank's own schedule, when its instalments are not all alike (a smaller first one, a rounded last one).
  const [each, setEach] = useState(plan?.uneven ? plan.scheduleAmountsPaise.map(paiseToInput).join(" ") : "");
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

  // Every instalment typed in order, such as "20082 20500 20500 20500 20500 20498".
  const eachTokens = each.trim() ? each.trim().split(/[\s;]+/).map((t) => t.replace(/,/g, "")).filter(Boolean) : [];
  const eachParsed = eachTokens.map((t) => rupeesToPaise(t));
  const eachInvalid = eachTokens.length > 0 && eachParsed.some((p) => !p);
  const eachAmounts = eachTokens.length > 0 && !eachInvalid ? (eachParsed as number[]) : null;

  // What the plan will do, shown before anything is saved.
  const totalPaise = rupeesToPaise(total);
  const monthsN = Number(months);
  const instalmentPaise = instalment.trim() ? rupeesToPaise(instalment) : null;
  let preview = "";
  if (card && eachAmounts && isValidStartMonth(startMonth) && eachAmounts.length <= 60) {
    const sum = eachAmounts.reduce((s, a) => s + a, 0);
    const schedule = instalmentSchedule(
      { totalPaise: sum, months: eachAmounts.length, instalmentPaise: eachAmounts[Math.min(1, eachAmounts.length - 1)] as number, startMonth, amountsPaise: eachAmounts },
      { statementDay: card.statementDay, dueDay: card.dueDay },
    );
    const first = schedule[0]!;
    const last = schedule[schedule.length - 1]!;
    preview = `${eachAmounts.length} instalment${eachAmounts.length === 1 ? "" : "s"} totalling ${rupees(sum)}, from ${shortDate(first.date)} ${first.date.slice(0, 4)} to ${shortDate(last.date)} ${last.date.slice(0, 4)}.`;
  } else if (card && totalPaise && Number.isInteger(monthsN) && monthsN >= 1 && monthsN <= 60 && isValidStartMonth(startMonth) && (instalmentPaise === null || instalmentPaise > 0)) {
    const each = instalmentPaise ?? defaultInstalmentPaise(totalPaise, monthsN);
    const payable = instalmentPaise !== null ? instalmentPaise * monthsN : totalPaise;
    if (scheduleIsConsistent({ totalPaise: payable, months: monthsN, instalmentPaise: each })) {
      const schedule = instalmentSchedule({ totalPaise: payable, months: monthsN, instalmentPaise: each, startMonth }, { statementDay: card.statementDay, dueDay: card.dueDay });
      const last = schedule[schedule.length - 1];
      preview = `${monthsN} instalment${monthsN === 1 ? "" : "s"} of ${rupees(each)}, the first on ${shortDate(schedule[0]!.date)} ${startMonth.slice(0, 4)}${last && last.amountPaise !== each ? `, the last ${rupees(last.amountPaise)}` : ""}${instalmentPaise !== null ? `. In total ${rupees(payable)}.` : "."}`;
    }
  }

  const save = () => {
    if (!title.trim()) return setError("Say what it is, such as the phone.");
    if (plan && frozen) {
      const body = { title: title.trim(), categoryId: categoryId || null };
      return void run(() => api.patch(`/api/emi-plans/${plan.id}`, body), "Saved.");
    }
    if (!chosenCard) return setError("Add a credit card first.");
    if (!isValidStartMonth(startMonth)) return setError("Choose the starting month.");
    if (eachInvalid) return setError("Each instalment must be an amount, separated by spaces, such as 20082 20500 20500.");
    if (eachAmounts) {
      if (eachAmounts.length > 60) return setError("An EMI plan can have up to 60 instalments.");
      const typed = { title: title.trim(), categoryId: categoryId || null, months: eachAmounts.length, startMonth, instalmentsPaise: eachAmounts };
      return void run(
        () => (plan ? api.patch(`/api/emi-plans/${plan.id}`, typed) : api.post("/api/emi-plans", { ...typed, cardAccountId: chosenCard, ...(replaces ? { replacesTransactionId: replaces } : {}) })),
        plan ? "Saved." : "EMI plan added.",
      );
    }
    if (!totalPaise) return setError("Enter the amount that was converted, such as 122000.");
    if (!Number.isInteger(monthsN) || monthsN < 1 || monthsN > 60) return setError("Months must be between 1 and 60.");
    if (instalment.trim() && !instalmentPaise) return setError("The monthly instalment looks wrong.");
    const common = { title: title.trim(), categoryId: categoryId || null, totalPaise, months: monthsN, startMonth, ...(instalmentPaise ? { instalmentPaise } : {}) };
    void run(
      () => (plan ? api.patch(`/api/emi-plans/${plan.id}`, common) : api.post("/api/emi-plans", { ...common, cardAccountId: chosenCard, ...(replaces ? { replacesTransactionId: replaces } : {}) })),
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
        <Field label="Amount converted to EMI (₹)" hint={eachAmounts ? "Not needed: the total is the sum of the instalments below." : undefined}>
          <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="122000" disabled={frozen} value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Months">
            <input className={inputClass} type="number" min={1} max={60} disabled={frozen} value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <Field label="Starting month">
            <input className={inputClass} type="month" disabled={frozen} value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </Field>
        </div>
        <Field label="Monthly instalment (optional)" hint="Only if your bank's instalment includes interest. Then the total becomes instalment times months.">
          <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="Leave empty to split evenly" disabled={frozen} value={instalment} onChange={(e) => setInstalment(e.target.value)} />
        </Field>
        <Field
          label="Each instalment, if they differ (optional)"
          hint="Copy them in order from your bank's schedule, separated by spaces, for example 20082 20500 20500 20500 20500 20498. Banks often bill a smaller first instalment and a rounded last one. The months and total then follow from this list."
        >
          <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="Leave empty for equal instalments" disabled={frozen} value={each} onChange={(e) => setEach(e.target.value)} />
        </Field>
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
            Instalments have already been added. If you change the amounts, months or starting month, Alfred removes them and adds them again from the new details. Any you edited by hand are lost.
          </p>
        )}
        {!frozen && preview && <p className="rounded-lg bg-sunk px-3 py-2 text-sm">{preview}</p>}
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

function Row({ plan, onEdit, onClose, onReopen }: { plan: EmiPlan; onEdit: () => void; onClose: () => void; onReopen: () => void }) {
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
    <Card pad="p-0">
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
            <Row key={p.id} plan={p} onEdit={() => setSheet({ plan: p })} onClose={() => void closePlan(p)} onReopen={() => void reopenPlan(p)} />
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
