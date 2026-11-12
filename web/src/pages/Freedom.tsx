import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type EmergencyFund, type FireView, type LadderStep, type MoneyHealth, type Settings, type TransferView, api, describeError } from "../api";
import { useToast } from "../components/toast";
import { Amount, AmountInput, Button, Card, Empty, ErrorText, Field, Sheet, Spinner, inputClass } from "../components/ui";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupeesCompact as rupees, shortDate } from "../format";
import { useEmergencyFund, useFire, useLadder, useMoneyHealth, useTransferSuggestion } from "../queries";
import { Link } from "../router";

const BAND: Record<string, { label: string; tone: string }> = {
  strong: { label: "Strong", tone: "text-good" },
  fair: { label: "Fair", tone: "text-warn-ink" },
  low: { label: "Low", tone: "text-bad" },
  comfortable: { label: "Comfortable", tone: "text-good" },
  stretched: { label: "Stretched", tone: "text-warn-ink" },
  heavy: { label: "Heavy", tone: "text-bad" },
};

function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-sm text-soft">
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      <span className={`font-medium tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

/** Needs, wants and what was saved, as shares of income. */
function SplitBar({ h }: { h: MoneyHealth }) {
  if (h.incomePaise <= 0) return null;
  const needs = Math.min(100, h.needsPct ?? 0);
  const wants = Math.min(100 - needs, h.wantsPct ?? 0);
  const saved = Math.max(0, 100 - needs - wants);
  const seg = (pct: number, cls: string, label: string) => (pct > 0 ? <span className={`block h-full ${cls}`} style={{ width: `${pct}%` }} title={`${label} ${pct}%`} /> : null);
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-sunk" role="img" aria-label={`Needs ${h.needsPct}%, wants ${h.wantsPct}%, saved ${h.savingsRatePct}% of income`}>
        {seg(needs, "bg-brass", "Needs")}
        {seg(wants, "bg-faint", "Wants")}
        {seg(saved, "bg-good", "Saved")}
      </div>
      <p className="mt-1 flex justify-between text-xs text-soft">
        <span>Needs {h.needsPct}%</span>
        <span>Wants {h.wantsPct}%</span>
        <span>Saved {h.savingsRatePct}%</span>
      </p>
      <p className="mt-1 text-xs text-faint">A common rule of thumb is 50% needs, 30% wants and 20% saved.</p>
    </div>
  );
}

/** The months to cover, an optional target of your own, and how fast to close a gap. */
function FundSettings({ fund, onClose }: { fund: EmergencyFund; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [months, setMonths] = useState(String(fund.months));
  const [target, setTarget] = useState(fund.targetBasis === "manual" && fund.living ? paiseToInput(fund.living.targetPaise) : "");
  const [basis, setBasis] = useState<"essentials" | "lifestyle">(fund.basis);
  const [medical, setMedical] = useState(fund.medical ? paiseToInput(fund.medical.targetPaise) : "");
  const [horizon, setHorizon] = useState(String(fund.horizonMonths));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>("/api/settings", patch),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["emergency-fund"] });
      await client.invalidateQueries({ queryKey: ["settings"] });
      toast.show("Saved");
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = Number(months);
    const h = Number(horizon);
    if (!Number.isInteger(m) || m < 1 || m > 24) return setError("Months to cover: a whole number from 1 to 24.");
    if (!Number.isInteger(h) || h < 1 || h > 60) return setError("Months to build it in: a whole number from 1 to 60.");
    const typed = target.trim() ? rupeesToPaise(target) : null;
    if (target.trim() && !typed) return setError("The target looks wrong. Use a number such as 300000, or leave it empty.");
    const med = medical.trim() ? rupeesToPaise(medical) : null;
    if (medical.trim() && !med) return setError("The medical amount looks wrong. Use a number such as 400000, or leave it empty.");
    setError("");
    save.mutate({ emergencyMonths: m, emergencyHorizonMonths: h, emergencyTargetPaise: typed, emergencyBasis: basis, medicalTargetPaise: med });
  };
  return (
    <Sheet title="Emergency fund settings" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div role="radiogroup" aria-label="What to measure spending on" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
          {(
            [
              ["lifestyle", "Everything I spend"],
              ["essentials", "Essentials only"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={basis === key} onClick={() => setBasis(key)} className={`min-h-11 rounded-lg text-sm font-medium ${basis === key ? "bg-card shadow-sm" : "text-soft"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-soft">
          {basis === "lifestyle"
            ? `Keeps your life as it is now${fund.lifestyleBurnPaise !== null ? `: about ${rupees(fund.lifestyleBurnPaise)} a month` : ""}.`
            : `Rent, bills, groceries and instalments only${fund.essentialsBurnPaise !== null ? `: about ${rupees(fund.essentialsBurnPaise)} a month` : ""}.`}
        </p>
        <Field label="Months of spending to cover" hint="Six is a common rule of thumb; some people keep more when income is uneven.">
          <input className={inputClass} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
        </Field>
        <Field label="Or a target of your own (₹)" hint="Optional. When set, it replaces months times your spending.">
          <AmountInput className={inputClass} placeholder="Leave empty to use the months" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Medical reserve on top (₹)" hint="Optional. Kept in the same pool, filled after the living costs. It helps with what insurance does not pay.">
          <AmountInput className={inputClass} placeholder="For example 400000" value={medical} onChange={(e) => setMedical(e.target.value)} />
        </Field>
        <Field label="Months to close the gap in" hint="Sets the monthly amount shown to put aside.">
          <input className={inputClass} inputMode="numeric" value={horizon} onChange={(e) => setHorizon(e.target.value)} />
        </Field>
        <ErrorText>{error || (save.isError ? describeError(save.error) : "")}</ErrorText>
        <Button type="submit" className="w-full" disabled={save.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

/** Money kept for when income stops, sized from what you must spend. */
function EmergencyCard() {
  const query = useEmergencyFund();
  const [editing, setEditing] = useState(false);
  const f = query.data;
  if (!f) return null;
  const early = f.early && f.burnPaise !== null ? ` An early estimate, from ${f.basedOnDays} days of entries.` : "";
  return (
    <Card id="emergency" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">Emergency fund</h2>
        <button type="button" className="min-h-11 text-sm text-brand" onClick={() => setEditing(true)}>
          Settings
        </button>
      </div>

      {f.nothingFlagged ? (
        <>
          <p className="text-sm text-soft">
            Nothing is marked as your emergency fund yet. Open a bank account or an investment and tick “Part of my emergency fund”, and it shows here.
          </p>
          {f.liquidMonths !== null && f.burnPaise !== null && (
            <p className="text-sm">
              Your bank money alone would cover about <span className="font-medium">{f.liquidMonths} months</span> of {f.basis === "lifestyle" ? "your spending" : "essentials"} at {rupees(f.burnPaise)} a month. A common aim is {f.months}.
              {early}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="font-display text-4xl tabular-nums"><Amount paise={f.fundedPaise} /></p>
          {f.targetPaise !== null ? (
            <>
              <p className="text-sm text-soft">
                of {rupees(f.targetPaise)}
                {f.targetBasis === "manual" ? ", with your own target for living costs" : `, ${f.months} months of ${f.basis === "lifestyle" ? "your spending" : "essentials"}`}
                {f.medical ? " plus a medical reserve" : ""}
                {f.fundedMonths !== null ? `. It covers about ${f.fundedMonths} months.` : "."}
                {early}
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-sunk" role="img" aria-label={`${f.progressPct}% of the target`}>
                <span className="block h-full bg-good" style={{ width: `${f.progressPct ?? 0}%` }} />
              </div>
              {f.living && f.medical && (
                <ul className="divide-y divide-line text-sm">
                  {(
                    [
                      ["Living costs", f.living],
                      ["Medical reserve", f.medical],
                    ] as const
                  ).map(([label, l]) => (
                    <li key={label} className="flex justify-between gap-3 py-1.5">
                      <span>
                        {label}
                        <span className="block text-xs text-faint">{l.gapPaise ? `${rupees(l.gapPaise)} still to build` : "Complete"}</span>
                      </span>
                      <span className="tabular-nums">
                        {rupees(l.fundedPaise)} of {rupees(l.targetPaise)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {f.essentialsTargetPaise !== null && f.lifestyleTargetPaise !== null && f.targetBasis === "burn" && f.essentialsTargetPaise !== f.lifestyleTargetPaise && (
                <p className="text-xs text-soft">
                  Living costs for {f.months} months: {rupees(f.lifestyleTargetPaise)} for your current spending, or {rupees(f.essentialsTargetPaise)} for essentials only. Switch under Settings.
                </p>
              )}
              {f.gapPaise ? (
                <p className="text-sm">
                  Still to build: <span className="font-medium">{rupees(f.gapPaise)}</span>. About {rupees(f.topUpPaise ?? 0)} a month would close it in {f.horizonMonths} months.
                </p>
              ) : (
                <p className="text-sm text-good">The target is met.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-soft">Once there are about two weeks of entries, Alfred can size a target from what you must spend. Or set your own under Settings.</p>
          )}
          <ul className="divide-y divide-line text-sm">
            {f.accounts.map((a) => (
              <li key={a.id} className="flex justify-between py-1.5">
                <span>{a.name}</span>
                <span className="tabular-nums">{rupees(a.paise)}</span>
              </li>
            ))}
            {f.holdings.map((h) => (
              <li key={h.id} className="flex justify-between py-1.5">
                <span>{h.name}</span>
                <span className="tabular-nums">{rupees(h.paise)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-faint">Money in a flagged account is still spendable; this only says what your fund is made of. Six months is a rule of thumb, not advice.</p>
      {editing && <FundSettings fund={f} onClose={() => setEditing(false)} />}
    </Card>
  );
}

const STATUS: Record<LadderStep["status"], { label: string; tone: string }> = {
  done: { label: "Done", tone: "bg-good/15 text-good" },
  next: { label: "Next", tone: "bg-brand text-white" },
  later: { label: "Later", tone: "bg-sunk text-soft" },
  skipped: { label: "Skipped", tone: "bg-sunk text-faint" },
};

const WHY_NOT: Record<NonNullable<TransferView["none"]>, string> = {
  no_target: "Once there are about two weeks of entries, or a target of your own, Alfred can say how much to move.",
  fund_complete: "Your emergency fund is full. Nothing to move.",
  no_destination: "Mark a bank account as your emergency fund (tick it on the account) and Alfred can suggest what to move into it.",
  no_source: "There is no bank account to move money from.",
  no_history: "With so little history Alfred cannot tell how much you spend each day, so it cannot say what is safe to move yet.",
  nothing_movable: "Nothing is safe to move today. What is free is kept for everyday spending until your next salary.",
};

/** What could move into the emergency fund today, and why that much. */
function TransferBox({ t }: { t: TransferView }) {
  if (t.none !== null) return <p className="text-sm text-soft">{WHY_NOT[t.none]}</p>;
  return (
    <div className="space-y-1 rounded-xl bg-sunk p-3 text-sm">
      <p>
        You could move <span className="font-medium">{rupees(t.amountPaise)}</span> from {t.from?.name} to {t.to?.name} today.
      </p>
      <p className="text-soft">
        Free to spend until {shortDate(t.until)} is {rupees(t.freeToSpendPaise)}. Alfred keeps {rupees(t.cushionPaise)} back for about {t.daysLeft} {t.daysLeft === 1 ? "day" : "days"} of everyday spending, so {rupees(t.movablePaise)} is safe to move.
        {t.remainingPaise ? ` That closes ${rupees(t.amountPaise)} of the ${rupees(t.gapPaise ?? 0)} still missing; the rest is possible after your next salary.` : " That completes your emergency fund."}
      </p>
      <p className="text-soft">Move it at your bank, then send /fund in Telegram and tap Record.</p>
      {t.to?.countsTowardSafeToSpend && <p className="text-soft">Tip: {t.to.name} still counts toward safe-to-spend. Untick that on the account so this money stays put.</p>}
    </div>
  );
}

/** The costly-debt line, and nothing else to set: skipping is done on each step. */
function LadderSettings({ costlyDebtBp, onClose }: { costlyDebtBp: number; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [rate, setRate] = useState(String(costlyDebtBp / 100));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (bp: number) => api.patch<Settings>("/api/settings", { costlyDebtBp: bp }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ladder"] });
      toast.show("Saved");
      onClose();
    },
  });
  return (
    <Sheet title="Next steps settings" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const bp = /^\d+(\.\d{1,2})?$/.test(rate.trim()) ? Math.round(Number.parseFloat(rate) * 100) : null;
          if (bp === null || bp < 100 || bp > 5000) return setError("Use a yearly rate between 1 and 50, such as 12.");
          setError("");
          save.mutate(bp);
        }}
      >
        <Field label="A bank loan costs too much from (% a year)" hint="Loans at or above this count as costly debt. 12 is a common line; the part-payment what-if shows what paying one down would save.">
          <input className={inputClass} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <ErrorText>{error || (save.isError ? describeError(save.error) : "")}</ErrorText>
        <Button type="submit" className="w-full" disabled={save.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

/** A common order for firming up money, where you stand on each rung, and what to do next and why. */
function NextStepCard() {
  const client = useQueryClient();
  const ladder = useLadder();
  const transfer = useTransferSuggestion();
  const [editing, setEditing] = useState(false);
  const skip = useMutation({
    mutationFn: (skipped: string[]) => api.patch<Settings>("/api/settings", { ladderSkipped: skipped }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ladder"] });
    },
  });
  const l = ladder.data;
  if (!l) return null;
  const toggle = (key: string) => skip.mutate(l.skipped.includes(key) ? l.skipped.filter((k) => k !== key) : [...l.skipped, key]);
  const showTransfer = transfer.data && (l.next?.key === "emergency" || l.next?.key === "medical" || transfer.data.none === null);
  return (
    <Card id="next-step" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">Your next step</h2>
        <button type="button" className="min-h-11 text-sm text-brand" onClick={() => setEditing(true)}>
          Settings
        </button>
      </div>
      {l.next ? (
        <div>
          <p className="font-display text-2xl">{l.next.title}</p>
          <p className="mt-1 text-sm text-soft">{l.next.detail}</p>
          {l.next.amountPaise ? <p className="mt-1 text-sm">About {rupees(l.next.amountPaise)} to go.</p> : null}
        </div>
      ) : (
        <p className="text-sm text-good">Every step is done or skipped.</p>
      )}
      {showTransfer && transfer.data && <TransferBox t={transfer.data} />}
      <ol className="divide-y divide-line text-sm">
        {l.steps.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-3 py-1.5">
            <span className={s.status === "skipped" ? "text-faint" : ""}>
              {i + 1}. {s.title}
            </span>
            <span className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[s.status].tone}`}>{STATUS[s.status].label}</span>
              {s.status !== "done" && (
                <button type="button" className="min-h-11 text-xs text-soft underline" disabled={skip.isPending} onClick={() => toggle(s.key)}>
                  {s.status === "skipped" ? "Include" : "Skip"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-faint">A common order, not advice. Skip a step that does not apply to you. Alfred never says what to buy or invest in.</p>
      {editing && <LadderSettings costlyDebtBp={l.costlyDebtBp} onClose={() => setEditing(false)} />}
    </Card>
  );
}

const pct = (bp: number) => String(bp / 100);
const inputPct = (text: string): number | null => (/^\d+(\.\d{1,2})?$/.test(text.trim()) ? Math.round(Number.parseFloat(text) * 100) : null);
const yearsText = (months: number) => {
  const y = Math.floor(Math.abs(months) / 12);
  const m = Math.abs(months) % 12;
  return [y ? `${y} ${y === 1 ? "year" : "years"}` : "", m ? `${m} ${m === 1 ? "month" : "months"}` : ""].filter(Boolean).join(" ") || "no time";
};

/** Everything the projection runs on, with the recent average standing in for spend and saving when left empty. */
function FireAssumptions({ fire, onClose }: { fire: FireView; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const a = fire.assumptions;
  const [age, setAge] = useState(a.ageNow === null ? "" : String(a.ageNow));
  const [target, setTarget] = useState(a.targetAge === null ? "" : String(a.targetAge));
  const [spend, setSpend] = useState(a.monthlySpendPaise !== null && !a.spendIsDefault ? paiseToInput(a.monthlySpendPaise) : "");
  const [saving, setSaving] = useState(a.monthlySavingPaise !== null && !a.savingIsDefault ? paiseToInput(a.monthlySavingPaise) : "");
  const [withdrawal, setWithdrawal] = useState(pct(a.withdrawalRateBp));
  const [inflation, setInflation] = useState(pct(a.inflationBp));
  const [ret, setRet] = useState(pct(a.returnBp));
  const [stepup, setStepup] = useState(pct(a.stepupBp));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<FireView>("/api/fire", body),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["fire"] });
      toast.show("Saved");
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const num = (t: string) => (t.trim() === "" ? null : /^\d+$/.test(t.trim()) ? Number(t) : Number.NaN);
    const ageNow = num(age);
    const targetAge = num(target);
    if (Number.isNaN(ageNow) || Number.isNaN(targetAge)) return setError("Ages are whole numbers, such as 32.");
    const spendPaise = spend.trim() ? rupeesToPaise(spend) : null;
    const savingPaise = saving.trim() ? rupeesToPaise(saving) : saving.trim() === "0" ? 0 : null;
    if (spend.trim() && !spendPaise) return setError("The monthly spend looks wrong. Use a number such as 60000, or leave it empty to use your recent average.");
    if (saving.trim() && savingPaise === null) return setError("The monthly saving looks wrong. Use a number such as 40000, or leave it empty to use your recent average.");
    const w = inputPct(withdrawal);
    const i = inputPct(inflation);
    const r = inputPct(ret);
    const s = inputPct(stepup);
    if (w === null || i === null || r === null || s === null) return setError("Rates are percentages such as 3.5 or 10.");
    setError("");
    save.mutate({ ageNow, targetAge, monthlySpendPaise: spendPaise, monthlySavingPaise: savingPaise, withdrawalRateBp: w, inflationBp: i, returnBp: r, stepupBp: s });
  };
  return (
    <Sheet title="Independence assumptions" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your age now">
            <input className={inputClass} inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} />
          </Field>
          <Field label="Free by age (optional)">
            <input className={inputClass} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        </div>
        <Field label="Spending a month once work stops (₹)" hint={`In today's money. Empty uses your recent average${a.spendIsDefault && a.monthlySpendPaise !== null ? `, ${rupees(a.monthlySpendPaise)}` : ""}.`}>
          <AmountInput className={inputClass} value={spend} onChange={(e) => setSpend(e.target.value)} />
        </Field>
        <Field label="Saving a month from now (₹)" hint={`Empty uses your recent average${a.savingIsDefault && a.monthlySavingPaise !== null ? `, ${rupees(a.monthlySavingPaise)}` : ""}.`}>
          <AmountInput className={inputClass} value={saving} onChange={(e) => setSaving(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Yearly return (%)" hint="Before tax. Not a promise.">
            <input className={inputClass} inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} />
          </Field>
          <Field label="Yearly inflation (%)">
            <input className={inputClass} inputMode="decimal" value={inflation} onChange={(e) => setInflation(e.target.value)} />
          </Field>
          <Field label="Withdrawal rate (%)" hint="3.5 to 4 is a common rule of thumb.">
            <input className={inputClass} inputMode="decimal" value={withdrawal} onChange={(e) => setWithdrawal(e.target.value)} />
          </Field>
          <Field label="Saving rises each year (%)">
            <input className={inputClass} inputMode="decimal" value={stepup} onChange={(e) => setStepup(e.target.value)} />
          </Field>
        </div>
        <ErrorText>{error || (save.isError ? describeError(save.error) : "")}</ErrorText>
        <Button type="submit" className="w-full" disabled={save.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

const SENSE: Record<string, string> = { saving: "Saving ₹5,000 more a month", spend: "Spending 10% less", return: "A return 2 points lower" };

/** The corpus that would cover your spending, how far along you are, and when your assumptions reach it. */
function FireCard() {
  const query = useFire();
  const [editing, setEditing] = useState(false);
  const f = query.data;
  if (!f) return null;
  const a = f.assumptions;
  const p = f.projection;
  return (
    <Card id="fire" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">Financial independence</h2>
        <button type="button" className="min-h-11 text-sm text-brand" onClick={() => setEditing(true)}>
          Assumptions
        </button>
      </div>

      {f.numberPaise === null ? (
        <p className="text-sm text-soft">
          To work out your number Alfred needs what a month costs once work stops. With about two weeks of entries it uses your recent spending; or type it under Assumptions.
        </p>
      ) : (
        <>
          <div>
            <p className="text-xs tracking-wide text-soft uppercase">Your number</p>
            <p className="font-display text-4xl tabular-nums"><Amount paise={f.numberPaise} /></p>
            <p className="text-sm text-soft">
              {rupees(a.monthlySpendPaise ?? 0)} a month{a.spendIsDefault ? " (your recent average)" : ""} at a {pct(a.withdrawalRateBp)}% yearly withdrawal.
              {f.early && a.spendIsDefault ? ` An early estimate, from ${f.basedOnDays} days of entries.` : ""}
            </p>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-sunk" role="img" aria-label={`${f.progressPct}% of the way`}>
            <span className="block h-full bg-good" style={{ width: `${f.progressPct ?? 0}%` }} />
          </div>
          <p className="text-sm">
            You have <span className="font-medium">{rupees(f.corpus.totalPaise)}</span> counted, {f.progressPct ?? 0}% of the way.
          </p>

          {p && (
            <p className="rounded-xl bg-sunk p-3 text-sm">
              {p.reached
                ? "On these assumptions you are already there."
                : p.months === null
                  ? "At the current saving the number is not reached within 60 years. Saving more, or spending less, changes that."
                  : `At ${rupees(a.monthlySavingPaise ?? 0)} saved a month${a.savingIsDefault ? " (your recent average)" : ""}, in about ${yearsText(p.months)}: around ${p.year}${p.age === null ? "" : `, at about ${p.age}`}.`}
            </p>
          )}

          {a.targetAge !== null && a.ageNow !== null && (
            <div className="space-y-1 text-sm">
              <p>
                To be free by {a.targetAge}:{" "}
                {f.requiredSavingPaise === null ? "it is out of reach on these assumptions." : f.requiredSavingPaise === 0 ? "what you have already will do." : <span className="font-medium">about {rupees(f.requiredSavingPaise)} a month</span>}
              </p>
              {f.coastPaise !== null && (
                <p className="text-soft">
                  Coast number: {rupees(f.coastPaise)}. {f.coastReached ? "You have passed it: if you stopped saving now, growth alone would get you there." : "Past that, you could stop saving and let it grow."}
                </p>
              )}
            </div>
          )}

          {f.sensitivity.length > 0 && p && p.months !== null && (
            <div>
              <p className="text-xs tracking-wide text-soft uppercase">What would change it</p>
              <ul className="divide-y divide-line text-sm">
                {f.sensitivity.map((s) => (
                  <li key={s.key} className="flex justify-between gap-3 py-1.5">
                    <span>{SENSE[s.key]}</span>
                    <span className={`tabular-nums ${s.deltaMonths !== null && s.deltaMonths < 0 ? "text-good" : "text-soft"}`}>
                      {s.deltaMonths === null ? "never" : s.deltaMonths === 0 ? "no change" : `${yearsText(s.deltaMonths)} ${s.deltaMonths < 0 ? "sooner" : "later"}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div>
        <p className="text-xs tracking-wide text-soft uppercase">What counts</p>
        <ul className="divide-y divide-line text-sm">
          <li className="flex justify-between gap-3 py-1.5">
            <span>
              Bank money
              <span className="block text-xs text-faint">{f.corpus.emergencyNotMarked ? "All of it, since no emergency fund is marked" : "Beyond your emergency fund"}</span>
            </span>
            <span className="tabular-nums">{rupees(f.corpus.bankPaise)}</span>
          </li>
          {f.corpus.holdings.map((h) => (
            <li key={h.id} className={`flex justify-between gap-3 py-1.5 ${h.counts && !h.inEmergencyFund ? "" : "text-faint"}`}>
              <span>
                {h.name}
                <span className="block text-xs text-faint">{h.inEmergencyFund ? "In your emergency fund" : h.counts ? h.kindName : "Not counted"}</span>
              </span>
              <span className="tabular-nums">{rupees(h.paise)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-faint">Change what counts in each investment's Edit sheet. EPF, PPF and NPS are counted at their full value, though much of it cannot be touched before retirement age.</p>
      </div>

      <p className="text-xs text-faint">
        A projection on assumptions you can change. Returns are not guaranteed, and tax, healthcare costs and the order returns arrive in are not modelled. It is arithmetic, not advice on what to invest in.
      </p>
      {editing && <FireAssumptions fire={f} onClose={() => setEditing(false)} />}
    </Card>
  );
}

/** Where you stand: how the month looked, and the ratios behind it. */
export function Freedom() {
  const [period, setPeriod] = useState<"last" | "current">("last");
  const query = useMoneyHealth(period);
  const h = query.data;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/more" className="text-sm text-brand">
          ← Everything
        </Link>
        <h1 className="text-3xl">Freedom</h1>
        <p className="text-sm text-soft">How your money is doing. Reference lines are common rules of thumb, not advice.</p>
      </div>

      <div role="tablist" aria-label="Month" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
        {(
          [
            ["last", "Last month"],
            ["current", "This month so far"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={period === key} onClick={() => setPeriod(key)} className={`min-h-11 rounded-lg text-sm font-medium ${period === key ? "bg-card shadow-sm" : "text-soft"}`}>
            {label}
          </button>
        ))}
      </div>

      <NextStepCard />

      {!h && <Spinner />}
      {query.isError && <Empty title="Could not load this">Check your connection and reload.</Empty>}
      {h && h.empty && <Empty title="Nothing to show yet">No income or spending {period === "last" ? "in your last full month" : "so far this month"}. Log a few entries and this fills in.</Empty>}

      {h && !h.empty && (
        <>
          <Card>
            <p className="text-xs tracking-wide text-soft uppercase">
              {period === "last" ? "Saved last month" : "Saved so far"} · {shortDate(h.period.from)} to {shortDate(h.period.to)}
            </p>
            <p className={`font-display mt-1 text-4xl tabular-nums ${h.savingsPaise < 0 ? "text-bad" : ""}`}><Amount paise={h.savingsPaise} /></p>
            <p className="mt-1 text-sm text-soft">
              {h.savingsRatePct === null ? "No income recorded, so there is no rate." : `${h.savingsRatePct}% of income`}
              {h.savingsBand && (
                <>
                  {" · "}
                  <span className={`font-medium ${BAND[h.savingsBand]?.tone}`}>{BAND[h.savingsBand]?.label}</span>
                  <span className="text-faint"> (a common aim is 20% or more)</span>
                </>
              )}
            </p>
            <SplitBar h={h} />
          </Card>

          <Card className="divide-y divide-line">
            <Row label="Income" value={rupees(h.incomePaise)} hint="Without refunds and balance corrections" />
            <Row label="Needs" value={rupees(h.needsPaise)} hint="Essential categories, card EMIs and loan interest" />
            <Row label="Wants" value={rupees(h.wantsPaise)} hint="Everything else you spent" />
            {h.investedPaise > 0 && <Row label="Put into investments" value={rupees(h.investedPaise)} hint="Part of what was saved" />}
            {h.principalRepaidPaise > 0 && <Row label="Loan principal repaid" value={rupees(h.principalRepaidPaise)} hint="Part of what was saved" />}
          </Card>

          <Card className="divide-y divide-line">
            {h.emiBurdenPct !== null && h.emiPaise > 0 && (
              <Row label="EMIs as a share of income" value={`${h.emiBurdenPct}%`} tone={h.emiBand ? BAND[h.emiBand]?.tone : undefined} hint="Under about 30% is comfortable; about 40% is the usual ceiling" />
            )}
            {h.utilizationPct !== null && <Row label="Credit cards used" value={`${h.utilizationPct}%`} hint="Of their limits, now. Under 30% is the usual aim" />}
            {h.runway.months !== null && h.runway.burnPaise !== null ? (
              <Row
                label="Emergency cover"
                value={`${h.runway.months} months`}
                hint={`Your bank money at ${rupees(h.runway.burnPaise)} a month of essentials${h.runway.solid ? "" : `. An early estimate, from ${h.runway.basedOnDays} days of entries`}`}
              />
            ) : (
              <Row label="Emergency cover" value="Not yet" hint="Needs about two weeks of entries, with some rent, bills or groceries among them" />
            )}
            {h.netWorth && <Row label="Net worth" value={rupees(h.netWorth.endPaise)} hint={`${h.netWorth.changePaise >= 0 ? "Up" : "Down"} ${rupees(Math.abs(h.netWorth.changePaise))} over the period`} />}
          </Card>
        </>
      )}

      <EmergencyCard />
      <FireCard />
    </div>
  );
}
