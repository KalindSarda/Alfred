import { useState } from "react";
import { type Holding, type HoldingKind, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { e4ToQty, paiseToInput, qtyToE4, rupees, shortDate, today } from "../format";
import { useAccounts, useHoldingKinds, useHoldings, useInvestmentAccounts, useRefreshMoney } from "../queries";
import { byNewest, type KindPurchase, type KindSummary, looseByKind, purchasesOf } from "../investmentKinds";
import { NewKindSheet } from "./InvestmentKinds";
import { AccountSelect, AccountsSheet, MoveSheet } from "./InvestmentAccounts";
import { useToast } from "./toast";
import { Amount, AmountInput, Button, Card, Chevron, Empty, ErrorText, Field, Sheet, inputClass } from "./ui";

/** What a kind is held in, and the quantity its rate is quoted for (gold for 10 g, silver for 1,000 g). */
interface UnitInfo {
  label: string;
  one: string;
  per: number;
}
const unitOfKind = (k: HoldingKind | undefined): UnitInfo | undefined => (k?.unit ? { label: k.unit, one: k.unitOne ?? k.unit, per: k.ratePer } : undefined);
const unitOfHolding = (h: Holding): UnitInfo | undefined => (h.unitLabel ? { label: h.unitLabel, one: h.unitOne ?? h.unitLabel, per: h.ratePer } : undefined);
const spoken = (unit: string) => (unit === "g" ? "grams" : unit === "kg" ? "kilograms" : unit);
const rateWord = (u: { one: string; per: number }) => `per ${u.per > 1 ? `${u.per} ` : ""}${u.one}`;
const heldText = (h: Holding) => `${e4ToQty(h.unitsHeldE4)} ${h.unitLabel ?? ""}`.trim();

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

const signed = (paise: number) => `${paise > 0 ? "+" : paise < 0 ? "−" : ""}${rupees(Math.abs(paise))}`;
const tone = (paise: number) => (paise > 0 ? "text-good" : paise < 0 ? "text-bad" : "text-soft");
const ago = (days: number | null) => (days === null ? "no value typed yet" : days === 0 ? "valued today" : `valued ${days} ${days === 1 ? "day" : "days"} ago`);

function BankPick({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank");
  return (
    <Field label={label}>
      <select className={inputClass} value={value || banks[0]?.id || ""} onChange={(e) => onChange(e.target.value)}>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

const NEW_KIND = "__new";

function HoldingSheet({ holding, all, onBuyInstead, onClose }: { holding: Holding | null; all: Holding[]; onBuyInstead: (h: Holding) => void; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [name, setName] = useState(holding?.name ?? "");
  const kinds = useHoldingKinds().data ?? [];
  const options = kinds.filter((k) => !k.archived || k.key === holding?.kind);
  const [kind, setKind] = useState<string>(holding?.kind ?? "gold");
  const [addingKind, setAddingKind] = useState(false);
  const [invested, setInvested] = useState("");
  // Editing something valued by typing: the total put in, so contributions with no bank entry (an EPF passbook) can be kept in step.
  const [putIn, setPutIn] = useState(holding && holding.tracking === "value" ? paiseToInput(holding.investedPaise) : "");
  const [value, setValue] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [typed, setTyped] = useState(false);
  const [emergency, setEmergency] = useState(holding?.isEmergency ?? false);
  const [forFire, setForFire] = useState(holding?.countsForFire ?? true);
  const [brokerId, setBrokerId] = useState(holding?.investmentAccountId ?? "");
  const brokers = useInvestmentAccounts().data?.accounts ?? [];
  const brokerUse = kinds.find((k) => k.key === kind)?.brokerUse ?? "optional";
  const unit = unitOfKind(kinds.find((k) => k.key === kind));
  const counted = !holding && !!unit && !typed;
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  const dupe = !holding && key ? all.find((h) => h.status === "active" && h.name.trim().replace(/\s+/g, " ").toLowerCase() === key) : undefined;

  const save = () => {
    if (!name.trim()) return setError("Name it, such as Gold coins or Tata Technologies.");
    if (brokerUse === "required" && brokers.length > 0 && !brokerId) return setError("Choose the broker account this is held in.");
    if (holding) {
      const total = putIn.trim() ? rupeesToPaise(putIn) : 0;
      if (holding.tracking === "value" && putIn.trim() && total === null) return setError("The total put in looks wrong. Use an amount such as 16399.");
      const changedTotal = holding.tracking === "value" && total !== null && total !== holding.investedPaise;
      return void run(() => api.patch(`/api/holdings/${holding.id}`, { name: name.trim(), kind, isEmergency: emergency, countsForFire: forFire, investmentAccountId: brokerId || null, ...(changedTotal ? { investedPaise: total } : {}) }), "Saved.");
    }
    if (dupe) return setError(`You already have ${dupe.name}. Add a purchase to it instead.`);
    const put = invested.trim() ? rupeesToPaise(invested) : 0;
    if (invested.trim() && put === null) return setError("What you paid looks wrong. Leave it empty if nothing yet.");
    if (counted && unit) {
      const held = qty.trim() ? qtyToE4(qty) : 0;
      if (qty.trim() && held === null) return setError(`How many ${spoken(unit.label)} you hold looks wrong. Use a number such as 15.2.`);
      const price = rate.trim() ? rupeesToPaise(rate) : null;
      if (rate.trim() && !price) return setError(`The rate looks wrong. Type it ${rateWord(unit)}, such as 130000.`);
      return void run(
        () => api.post("/api/holdings", { name: name.trim(), kind, ...(brokerId ? { investmentAccountId: brokerId } : {}), tracking: "units", ...(held ? { unitsE4: held } : {}), ...(put ? { investedPaise: put } : {}), ...(price ? { ratePaise: price } : {}) }),
        "Investment added.",
      );
    }
    const worth = value.trim() ? rupeesToPaise(value) : null;
    if (value.trim() && worth === null) return setError("What it is worth looks wrong. Leave it empty if you do not know yet.");
    void run(() => api.post("/api/holdings", { name: name.trim(), kind, ...(brokerId ? { investmentAccountId: brokerId } : {}), ...(put ? { investedPaise: put } : {}), ...(worth !== null ? { valuePaise: worth } : {}) }), "Investment added.");
  };

  return (
    <>
    <Sheet title={holding ? "Edit investment" : "Add an investment"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="What is it?">
          <input className={inputClass} maxLength={40} autoComplete="off" placeholder="Gold coins" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind">
          <select
            className={inputClass}
            value={kind}
            onChange={(e) => {
              if (e.target.value === NEW_KIND) setAddingKind(true);
              else {
                setKind(e.target.value);
                // A kind that is not held in a broker account cannot keep one.
                if (kinds.find((k) => k.key === e.target.value)?.brokerUse === "never") setBrokerId("");
              }
            }}
          >
            {options.map((k) => (
              <option key={k.key} value={k.key}>
                {k.name}
              </option>
            ))}
            <option value={NEW_KIND}>+ New kind…</option>
          </select>
        </Field>
        <AccountSelect value={brokerId} onChange={setBrokerId} use={brokerUse} />
        {holding && holding.tracking === "value" && (
          <Field label="Total put in (₹)" hint="Everything you have put in, such as the contributions on your EPF passbook. Interest then shows as the gain.">
            <AmountInput className={inputClass} autoComplete="off" placeholder="16399" value={putIn} onChange={(e) => setPutIn(e.target.value)} />
          </Field>
        )}
        {holding && (
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 size-5 accent-brand" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
            <span>
              Part of my emergency fund
              <span className="block text-xs text-soft">For money you could turn into cash quickly, such as a liquid fund. Its worth counts toward the fund.</span>
            </span>
          </label>
        )}
        {holding && (
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 size-5 accent-brand" checked={forFire} onChange={(e) => setForFire(e.target.checked)} />
            <span>
              Count it toward financial independence
              <span className="block text-xs text-soft">Its worth is part of the corpus on the Freedom page. Untick it for money you do not plan to live on.</span>
            </span>
          </label>
        )}
        {dupe && (
          <div className="rounded-xl bg-warn-bg p-3 text-sm text-warn-ink">
            You already have {dupe.name}. Buying more of the same thing is a purchase on it, not a new investment.
            <Button type="button" variant="secondary" className="mt-2 min-h-11 w-full text-sm" onClick={() => onBuyInstead(dupe)}>
              Add a purchase to {dupe.name}
            </Button>
          </div>
        )}
        {!holding && counted && unit && (
          <>
            <Field label={`How many ${spoken(unit.label)} do you hold now?`} hint={kind === "gold" ? "All of it together. Leave empty to start with nothing and add purchases one by one." : "Leave empty to start with nothing and add purchases one by one."}>
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder={kind === "gold" ? "15.2" : "120.5"} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Total paid for it (₹)" hint="Everything you paid, including making charges and GST, so the gain shown is the real one.">
              <AmountInput className={inputClass} autoComplete="off" placeholder="190000" value={invested} onChange={(e) => setInvested(e.target.value)} />
            </Field>
            <Field label={`Rate today (₹ ${rateWord(unit)})`} hint="You update this one number whenever you like. Alfred asks on the 1st of each month.">
              <AmountInput className={inputClass} autoComplete="off" placeholder={kind === "gold" ? "130000" : "52.34"} value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <button type="button" className="min-h-9 text-sm text-soft underline" onClick={() => setTyped(true)}>
              I will type what it is worth instead
            </button>
          </>
        )}
        {!holding && !counted && (
          <>
            <Field label="Already put in (₹)" hint="What you invested before Alfred, with no bank entry. Anything you buy from here on is recorded through a bank.">
              <AmountInput className={inputClass} autoComplete="off" placeholder="10000" value={invested} onChange={(e) => setInvested(e.target.value)} />
            </Field>
            <Field label="Worth now (₹)" hint="You type this yourself, and update it when you like. Alfred asks on the 1st of each month.">
              <AmountInput className={inputClass} autoComplete="off" placeholder="12000" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            {typed && (
              <button type="button" className="min-h-9 text-sm text-soft underline" onClick={() => setTyped(false)}>
                Count it by quantity instead
              </button>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy || !!dupe}>
            Save
          </Button>
          {holding && holding.entries.length === 0 && holding.lots.length === 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Remove this investment? Nothing was bought or sold through it.")) void run(() => api.del(`/api/holdings/${holding.id}`), "Removed.");
              }}
            >
              Remove
            </Button>
          )}
        </div>
      </form>
    </Sheet>
    {addingKind && <NewKindSheet onCreated={(k) => setKind(k.key)} onClose={() => setAddingKind(false)} />}
    </>
  );
}

/** Types today's rate for gold, a fund or shares; the worth follows from the quantity held. */
function RateSheet({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const unit = unitOfHolding(holding) ?? { label: "units", one: "unit", per: 1 };
  const [amount, setAmount] = useState(holding.ratePaise ? paiseToInput(holding.ratePaise) : "");
  const [date, setDate] = useState(today());
  const paise = rupeesToPaise(amount);
  const preview = paise ? Math.round((holding.unitsHeldE4 * paise) / (10_000 * holding.ratePer)) : null;

  const save = () => {
    if (!paise) return setError(`Enter the rate ${rateWord(unit)}, such as ${holding.kind === "gold" ? "130000" : "52.34"}.`);
    void run(() => api.post(`/api/holdings/${holding.id}/rate`, { ratePaise: paise, date }), `${holding.name}: ${rupees(paise)} ${rateWord(unit)}.`);
  };

  return (
    <Sheet title={`${holding.name}: today's rate`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          You hold {heldText(holding)} and paid {rupees(holding.investedPaise)}.{" "}
          {holding.ratePaise ? `Last rate ${rupees(holding.ratePaise)} ${rateWord(unit)}${holding.valueDate ? ` on ${shortDate(holding.valueDate)}` : ""}.` : "No rate typed yet."}
        </p>
        <Field label={`Rate (₹ ${rateWord(unit)})`}>
          <AmountInput className={inputClass} autoComplete="off" autoFocus placeholder={holding.kind === "gold" ? "130000" : "52.34"} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {preview !== null && (
          <p className="text-sm">
            Worth {rupees(preview)} ·{" "}
            <span className={`font-medium ${tone(preview + holding.soldPaise - holding.investedPaise)}`}>{signed(preview + holding.soldPaise - holding.investedPaise)}</span>
          </p>
        )}
        <Field label="As of">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

/** Switches an investment valued by typing to quantity times rate. */
function ConvertSheet({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const unit = unitOfKind((useHoldingKinds().data ?? []).find((k) => k.key === holding.kind)) ?? { label: "units", one: "unit", per: 1 };
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");

  const save = () => {
    const held = qtyToE4(qty);
    const price = rupeesToPaise(rate);
    if (!held) return setError(`Enter how many ${spoken(unit.label)} you hold, such as 15.2.`);
    if (!price) return setError(`Enter today's rate ${rateWord(unit)}.`);
    void run(() => api.post(`/api/holdings/${holding.id}/convert`, { unitsE4: held, ratePaise: price }), `${holding.name} is now counted by quantity.`);
  };

  return (
    <Sheet title={`Count ${holding.name} by quantity`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          What you put in ({rupees(holding.investedPaise)}) stays as it is. Tell Alfred how much you hold in total and today's rate; the worth then follows the rate. Later purchases are added with their quantity.
        </p>
        <Field label={`${spoken(unit.label)[0]?.toUpperCase()}${spoken(unit.label).slice(1)} held in total`}>
          <input className={inputClass} inputMode="decimal" autoComplete="off" autoFocus placeholder={holding.kind === "gold" ? "15.2" : "120.5"} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label={`Rate today (₹ ${rateWord(unit)})`}>
          <AmountInput className={inputClass} autoComplete="off" placeholder={holding.kind === "gold" ? "130000" : "52.34"} value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Switch
        </Button>
      </form>
    </Sheet>
  );
}

function ValueSheet({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [amount, setAmount] = useState(holding.valuePaise ? paiseToInput(holding.valuePaise) : "");
  const [date, setDate] = useState(today());

  const save = () => {
    const paise = amount.trim() === "0" ? 0 : rupeesToPaise(amount);
    if (paise === null) return setError("Enter what it is worth, such as 15200.");
    void run(() => api.post(`/api/holdings/${holding.id}/value`, { valuePaise: paise, date }), `${holding.name} is now ${rupees(paise)}.`);
  };

  return (
    <Sheet title={`What is ${holding.name} worth?`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          You put in {rupees(holding.investedPaise)}. Last {holding.valueDate ? `valued ${rupees(holding.valuePaise)} on ${shortDate(holding.valueDate)}` : "not valued yet"}.
        </p>
        <Field label="Worth now (₹)">
          <AmountInput className={inputClass} autoComplete="off" autoFocus placeholder="15200" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="As of">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

const NO_BANK = "earlier";

function TradeSheet({ holding, selling, onClose }: { holding: Holding; selling: boolean; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [closeOut, setCloseOut] = useState(false);
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank");
  const counted = holding.tracking === "units";
  const unit = unitOfHolding(holding) ?? { label: "units", one: "unit", per: 1 };
  const account = accountId || banks[0]?.id || "";
  const earlier = !selling && counted && account === NO_BANK;

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!paise && !(earlier && paise === 0)) return setError(selling ? "Enter what you received, such as 4000." : "Enter what you paid, such as 5000.");
    const units = counted ? qtyToE4(qty) : undefined;
    if (counted && !units) return setError(`Enter how many ${spoken(unit.label)} you ${selling ? "sold" : "bought"}, such as 2.5.`);
    if (selling && counted && units && units > holding.unitsHeldE4) return setError(`You hold ${heldText(holding)}.`);
    if (earlier) {
      return void run(() => api.post(`/api/holdings/${holding.id}/lots`, { unitsE4: units, costPaise: paise ?? 0, date, note: note.trim() || null }), "Purchase added. No bank was touched.");
    }
    if (!account) return setError("Add a bank account first.");
    const body = { amountPaise: paise, ...(units ? { unitsE4: units } : {}), accountId: account, date, note: note.trim() || null, ...(selling && closeOut ? { closeOut: true } : {}) };
    void run(
      () => api.post(`/api/holdings/${holding.id}/${selling ? "sell" : "buy"}`, body),
      selling ? `Sold: ${rupees(paise ?? 0)} came into your bank.` : `Bought ${rupees(paise ?? 0)} of ${holding.name}.`,
    );
  };

  return (
    <Sheet title={selling ? `Sell ${holding.name}` : `Buy more ${holding.name}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          {selling
            ? `The money comes into the bank you choose. It is not income. It is worth ${rupees(holding.valuePaise)} now${counted ? ` (${heldText(holding)})` : ""}.`
            : earlier
              ? "A purchase from before Alfred: it adds to what you hold and what you paid, and no bank is touched."
              : "The money goes out of the bank you choose as an Investment entry. It is not spending."}
        </p>
        {counted && (
          <Field label={`${selling ? "Sold" : "Bought"} (${spoken(unit.label)})`}>
            <input className={inputClass} inputMode="decimal" autoComplete="off" autoFocus placeholder={holding.kind === "gold" ? "2.5" : "10"} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        )}
        <Field label={selling ? "Received (₹)" : "Paid in total (₹)"} hint={!selling && counted ? "Include making charges and GST." : undefined}>
          <AmountInput className={inputClass} autoComplete="off" autoFocus={!counted} placeholder={selling && !counted ? paiseToInput(holding.valuePaise) : "5000"} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {!selling && counted ? (
          <Field label="From">
            <select className={inputClass} value={account} onChange={(e) => setAccountId(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              <option value={NO_BANK}>Paid earlier, not from a bank I track</option>
            </select>
          </Field>
        ) : (
          <BankPick label={selling ? "Into" : "From"} value={account} onChange={setAccountId} />
        )}
        <Field label="On">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {selling && (
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 size-5 accent-brand" checked={closeOut} onChange={(e) => setCloseOut(e.target.checked)} />
            <span>
              That was all of it
              <span className="block text-xs text-soft">Closes this investment and stops counting it.</span>
            </span>
          </label>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

type Act = "value" | "rate" | "buy" | "sell" | "edit" | "convert";
type SheetState = { kind: "edit"; holding: Holding | null } | { kind: Exclude<Act, "edit">; holding: Holding } | null;

/** Changes one holding and refreshes what depends on it, reporting back. */
function useHoldingActions() {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [error, setError] = useState("");
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
  return { act, error };
}

/** The typed rates and values of one holding, newest first. */
function RateHistorySheet({ h, onClose }: { h: Holding; onClose: () => void }) {
  const unit = unitOfHolding(h);
  return (
    <Sheet title={`${h.name}: rate history`} onClose={onClose}>
      {h.values.length === 0 ? (
        <p className="text-sm text-soft">Nothing typed yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {h.values.map((v) => (
            <li key={v.date} className="flex items-baseline justify-between gap-3 py-2.5">
              <span>
                {shortDate(v.date)}
                {v.ratePaise && unit ? <span className="block text-xs text-soft">{rupees(v.ratePaise)} {rateWord(unit)}</span> : null}
              </span>
              <span className="font-medium tabular-nums">{rupees(v.valuePaise)}</span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** What can be done to a holding: the main three, and the rest under More. */
function HoldingButtons({ h, onAct }: { h: Holding; onAct: (what: Act) => void }) {
  const { act, error } = useHoldingActions();
  const [more, setMore] = useState(false);
  const [history, setHistory] = useState(false);
  const counted = h.tracking === "units";
  const kindUnit = unitOfKind((useHoldingKinds().data ?? []).find((k) => k.key === h.kind));

  if (h.status !== "active") {
    return (
      <div className="space-y-2">
        <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => void act(() => api.post(`/api/holdings/${h.id}/reopen`), `${h.name} reopened. Type its value to count it again.`)}>
          Reopen
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11 py-1.5 text-sm" onClick={() => onAct(counted ? "rate" : "value")}>
          {counted ? "Update rate" : "Update value"}
        </Button>
        <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("buy")}>
          Buy more
        </Button>
        {(counted ? h.unitsHeldE4 > 0 : h.valuePaise > 0) && (
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("sell")}>
            Sell
          </Button>
        )}
        <Button variant="ghost" className="min-h-11 py-1.5 text-sm" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          More <Chevron open={more} className="ml-1 inline" />
        </Button>
      </div>
      {more && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("edit")}>
            Edit
          </Button>
          {!counted && kindUnit && (
            <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("convert")}>
              Count by quantity
            </Button>
          )}
          {h.values.length > 0 && (
            <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => setHistory(true)}>
              Rate history
            </Button>
          )}
          <Button
            variant="ghost"
            className="min-h-11 py-1.5 text-sm"
            onClick={() => {
              if (window.confirm(`Close ${h.name}? It stops counting toward your net worth. Use this when it is gone without a sale you want recorded.`)) void act(() => api.post(`/api/holdings/${h.id}/close`), `${h.name} closed.`);
            }}
          >
            Close
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {history && <RateHistorySheet h={h} onClose={() => setHistory(false)} />}
    </div>
  );
}

/** Purchases shown at first in a list; the rest open in place. */
const PURCHASES = 8;

/** The one list of what went in: buys, sales, earlier lots and the opening balance, each with the account it came from. */
function PurchaseList({ purchases, investedPaise, unitLabel, showHolding, holdings }: { purchases: KindPurchase[]; investedPaise: number; unitLabel: string | null; showHolding: boolean; holdings: Holding[] }) {
  const { act, error } = useHoldingActions();
  const [all, setAll] = useState(false);
  if (purchases.length === 0) return null;
  const label = unitLabel ?? "";
  const shown = all ? purchases : purchases.slice(0, PURCHASES);
  const unitOf = (holdingId: string) => holdings.find((h) => h.id === holdingId)?.unitLabel ?? label;
  return (
    <div className="border-t border-line px-4 py-3">
      <h3 className="text-xs tracking-wide text-soft uppercase">Purchases · paid {rupees(investedPaise)} in all</h3>
      <ul className="mt-2 space-y-2.5 text-sm">
        {shown.map((p) => (
          <li key={p.key} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block">
                {p.kind === "opening" ? "Opening balance" : shortDate(p.date)}
                {p.unitsE4 !== null && p.unitsE4 > 0 ? ` · ${e4ToQty(p.unitsE4)} ${unitOf(p.holdingId)}`.trimEnd() : ""}
              </span>
              <span className="block text-xs text-soft">
                {p.kind === "sell" ? "Sold" : p.kind === "lot" ? "Before tracking" : p.kind === "opening" ? "Held before tracking" : "Bought"}
                {p.accountName ? ` · ${p.kind === "sell" ? "into" : "from"} ${p.accountName}` : ""}
                {showHolding ? ` · ${p.holdingName}` : ""}
                {p.lotId && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        if (window.confirm("Remove this purchase?")) void act(() => api.del(`/api/holdings/${p.holdingId}/lots/${p.lotId}`), "Removed.");
                      }}
                    >
                      remove
                    </button>
                  </>
                )}
                {p.needsQuantity && p.entryId && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="font-medium text-warn-ink underline"
                      onClick={() => {
                        const typed = window.prompt(`How many ${unitOf(p.holdingId)} was that?`);
                        const units = typed ? qtyToE4(typed) : null;
                        if (units) void act(() => api.post(`/api/holdings/${p.holdingId}/entries/${p.entryId}/units`, { unitsE4: units }), "Quantity added.");
                      }}
                    >
                      add quantity
                    </button>
                  </>
                )}
              </span>
            </span>
            <span className={`shrink-0 tabular-nums ${p.kind === "sell" ? "text-good" : ""}`}>
              {p.kind === "sell" ? "+" : ""}
              {rupees(p.amountPaise)}
            </span>
          </li>
        ))}
      </ul>
      {purchases.length > PURCHASES && (
        <button type="button" className="mt-2 min-h-11 text-sm text-brand" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${purchases.length}`}
        </button>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** One holding as a line: its name, how much and at what, and what it is worth; tap for its buttons and purchases. */
function HoldingLine({ h, onAct, showKind = false }: { h: Holding; onAct: (what: Act) => void; showKind?: boolean }) {
  const [open, setOpen] = useState(false);
  const active = h.status === "active";
  const counted = h.tracking === "units";
  const unit = unitOfHolding(h);
  const stale = active && (h.staleDays === null || h.staleDays > 35);
  const second = counted && unit ? (h.ratePaise ? `${heldText(h)} at ${rupees(h.ratePaise)} ${rateWord(unit)}` : `${heldText(h)} · no rate typed yet`) : ago(h.staleDays);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-14 w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-hover">
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {h.name}
            {(showKind || !active) && (
              <span className="ml-2 text-xs font-normal text-faint">
                {showKind ? h.kindName : ""}
                {!active && `${showKind ? " · " : ""}closed`}
              </span>
            )}
          </span>
          <span className={`block text-xs ${stale ? "font-medium text-warn-ink" : "text-soft"}`}>{second}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">{rupees(h.valuePaise)}</span>
          <span className={`block text-xs ${tone(h.gainPaise)}`}>
            {signed(h.gainPaise)}
            {h.gainPct !== null && ` (${h.gainPct}%)`}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 pb-3">
          <div className="px-4">
            {h.missingUnits > 0 && <p className="mb-2 text-xs font-medium text-warn-ink">{h.missingUnits} {h.missingUnits === 1 ? "entry has" : "entries have"} no quantity. Add it below, or the quantity held will be short.</p>}
            <HoldingButtons h={h} onAct={onAct} />
          </div>
          <PurchaseList purchases={byNewest(purchasesOf(h))} investedPaise={h.investedPaise} unitLabel={h.unitLabel} showHolding={false} holdings={[h]} />
        </div>
      )}
    </li>
  );
}

type Sort = "value" | "gain" | "name";
const SORTS: { key: Sort; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "gain", label: "Gain" },
  { key: "name", label: "A to Z" },
];
const sortHoldings = (items: Holding[], by: Sort): Holding[] =>
  [...items].sort((a, b) => (by === "name" ? a.name.localeCompare(b.name) : by === "gain" ? b.gainPaise - a.gainPaise : b.valuePaise - a.valuePaise) || a.name.localeCompare(b.name));

/** One rate for the whole kind, such as the gold rate: set on every holding of it counted by quantity and not in a broker account. */
function KindRateSheet({ summary, onClose }: { summary: KindSummary; onClose: () => void }) {
  const kind = (useHoldingKinds().data ?? []).find((k) => k.key === summary.kindKey);
  const { run, error, setError, busy } = useAction(onClose);
  const first = summary.holdings.find((h) => h.tracking === "units");
  const unit = summary.rate ? { one: summary.rate.unitOne, per: summary.rate.per } : { one: first?.unitOne ?? first?.unitLabel ?? "unit", per: first?.ratePer ?? 1 };
  const [amount, setAmount] = useState(summary.rate ? paiseToInput(summary.rate.paise) : "");
  const [date, setDate] = useState(today());
  const paise = rupeesToPaise(amount);
  const counted = summary.holdings.filter((h) => h.tracking === "units");
  const preview = paise ? counted.reduce((s, h) => s + Math.round((h.unitsHeldE4 * paise) / (10_000 * h.ratePer)), 0) : null;

  const save = () => {
    if (!kind) return;
    if (!paise) return setError(`Enter the rate ${rateWord(unit)}, such as 130000.`);
    void run(() => api.post(`/api/holding-kinds/${kind.id}/rate`, { ratePaise: paise, date }), `${summary.kindName}: ${rupees(paise)} ${rateWord(unit)}.`);
  };

  return (
    <Sheet title={`${summary.kindName}: today's rate`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-soft">
          One rate for {counted.length === 1 ? "your" : `all ${counted.length}`} {summary.kindName} {counted.length === 1 ? "holding" : "holdings"} outside a broker account. {summary.rate ? `Last rate ${rupees(summary.rate.paise)} ${rateWord(unit)}${summary.rate.date ? ` on ${shortDate(summary.rate.date)}` : ""}.` : "No rate typed yet."}
        </p>
        <Field label={`Rate (₹ ${rateWord(unit)})`}>
          <AmountInput className={inputClass} autoComplete="off" autoFocus placeholder="130000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {preview !== null && <p className="text-sm">Together worth {rupees(preview)}.</p>}
        <Field label="As of">
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

/**
 * Investments outside any broker account, one card per kind (Gold, Silver…). A kind with one holding is a single card: what you
 * hold, what it is worth, the gain, the rate, the buttons and the purchases. A kind with several shows its totals, one line per
 * holding, and the purchases of all of them.
 */
function KindCard({ summary: s, sort, open, onToggle, onAct, onRate, onAssign }: { summary: KindSummary; sort: Sort; open: boolean; onToggle: () => void; onAct: (h: Holding) => (what: Act) => void; onRate: () => void; onAssign?: () => void }) {
  const single = s.holdings.length === 1 ? (s.holdings[0] as Holding) : null;
  const label = s.unitLabel ?? "";
  const quantity = s.unitsE4 !== null ? `${e4ToQty(s.unitsE4)} ${label}`.trim() : null;
  const rate = s.rate;
  const ages = s.holdings.filter((h) => h.tracking === "units" && h.ratePaise !== null).map((h) => h.staleDays ?? Number.POSITIVE_INFINITY);
  const stale = ages.length > 0 && Math.min(...ages) > 35;
  const named = single && single.name.trim().toLowerCase() !== s.kindName.trim().toLowerCase() ? single.name : null;
  return (
    <Card pad="p-0">
      <button type="button" className="flex min-h-14 w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="min-w-0">
          <span className="block font-medium">{s.kindName}</span>
          <span className="block text-xs text-soft">
            {[named, single ? null : `${s.holdings.length} holdings`, quantity].filter(Boolean).join(" · ")}
          </span>
          {rate && (
            <span className={`block text-xs ${stale ? "font-medium text-warn-ink" : "text-soft"}`}>
              {rupees(rate.paise)} {rateWord({ one: rate.unitOne, per: rate.per })}
              {rate.date ? `, ${shortDate(rate.date)}` : ""}
              {stale ? " · over a month old" : ""}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">
            <Amount paise={s.valuePaise} />
          </span>
          <span className={`block text-xs ${tone(s.gainPaise)}`}>
            {signed(s.gainPaise)}
            {s.gainPct !== null && ` (${s.gainPct}%)`}
          </span>
        </span>
        <Chevron open={open} className="mt-1.5 text-soft" />
      </button>
      {open && (
        <>
          {single ? (
            <div className="px-4 pb-3">
              <HoldingButtons h={single} onAct={onAct(single)} />
            </div>
          ) : (
            <>
              {(s.counted || onAssign) && (
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  {s.counted && (
                    <Button className="min-h-11 py-1.5 text-sm" onClick={onRate}>
                      Update rate
                    </Button>
                  )}
                  {onAssign && (
                    <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={onAssign}>
                      Assign to a broker account
                    </Button>
                  )}
                </div>
              )}
              <ul className="divide-y divide-line border-t border-line">
                {sortHoldings(s.holdings, sort).map((h) => (
                  <HoldingLine key={h.id} h={h} onAct={onAct(h)} />
                ))}
              </ul>
            </>
          )}
          {single && onAssign && (
            <div className="px-4 pb-3">
              <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={onAssign}>
                Assign to a broker account
              </Button>
            </div>
          )}
          <PurchaseList purchases={s.purchases} investedPaise={s.investedPaise} unitLabel={s.unitLabel} showHolding={!single} holdings={s.holdings} />
        </>
      )}
    </Card>
  );
}

/** Rows shown at first in an account; the rest open in place. */
const TOP = 5;

/** One broker account (or what is not in one yet): its totals, and its holdings, the first few at first. */
function Group({ title, note, holdings, sort, open, onToggle, onAct, actions }: { title: string; note: string | null; holdings: Holding[]; sort: Sort; open: boolean; onToggle: () => void; onAct: (h: Holding) => (what: Act) => void; actions?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  const value = holdings.reduce((s, h) => s + h.valuePaise, 0);
  const put = holdings.reduce((s, h) => s + h.investedPaise, 0);
  const gain = holdings.reduce((s, h) => s + h.gainPaise, 0);
  const sorted = sortHoldings(holdings, sort);
  const shown = all ? sorted : sorted.slice(0, TOP);
  return (
    <Card pad="p-0">
      <button type="button" className="flex min-h-14 w-full items-start justify-between gap-3 px-4 py-3 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          <span className="block text-xs text-soft">
            {holdings.length} {holdings.length === 1 ? "holding" : "holdings"}
            {note ? ` · ${note}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-semibold tabular-nums">
            <Amount paise={value} />
          </span>
          <span className={`block text-xs ${tone(gain)}`}>
            {signed(gain)}
            {put > 0 && ` (${Math.round((gain / put) * 1000) / 10}%)`}
          </span>
        </span>
        <Chevron open={open} className="mt-1.5 text-soft" />
      </button>
      {open && (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {shown.map((h) => (
              <HoldingLine key={h.id} h={h} onAct={onAct(h)} showKind />
            ))}
          </ul>
          {sorted.length > TOP && (
            <button type="button" className="min-h-11 w-full border-t border-line px-4 text-sm text-brand" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show ${sorted.length - TOP} more`}
            </button>
          )}
          {actions}
        </>
      )}
    </Card>
  );
}

/** What you own and what it is worth, by broker account: shares, IPO allotments, funds, gold, crypto. Values are typed by you; buying and selling go through a bank. */
export function Investments() {
  const query = useHoldings("all");
  const brokers = useInvestmentAccounts();
  const kindsList = useHoldingKinds().data ?? [];
  const [sheet, setSheet] = useState<SheetState>(null);
  const [manage, setManage] = useState<"accounts" | "move" | null>(null);
  const [rateKind, setRateKind] = useState<KindSummary | null>(null);
  const [sort, setSort] = useState<Sort>("value");
  const [shut, setShut] = useState<Set<string>>(new Set());

  if (query.isPending) return <p className="py-8 text-center text-sm text-soft">Loading…</p>;
  if (query.isError) return <Empty title="Could not load your investments">Check your connection and reload.</Empty>;

  const { holdings, totalValuePaise, totalInvestedPaise, gainPaise } = query.data;
  const active = holdings.filter((h) => h.status === "active");
  const closed = holdings.filter((h) => h.status === "closed");
  const act = (h: Holding) => (what: Act) => setSheet(what === "edit" ? { kind: "edit", holding: h } : { kind: what, holding: h });
  const pct = totalInvestedPaise > 0 ? Math.round((gainPaise / totalInvestedPaise) * 1000) / 10 : null;
  const accounts = brokers.data?.accounts ?? [];
  const known = new Set(accounts.map((a) => a.id));
  const inAccount = (id: string) => active.filter((h) => h.investmentAccountId === id);
  const loose = active.filter((h) => !h.investmentAccountId || !known.has(h.investmentAccountId));
  const toggle = (key: string) =>
    setShut((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4" id="investments">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-soft">{active.length === 0 ? "Nothing recorded yet" : `${active.length} ${active.length === 1 ? "investment" : "investments"}`}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => setManage("accounts")}>
            Broker accounts
          </Button>
          <Button onClick={() => setSheet({ kind: "edit", holding: null })}>Add investment</Button>
        </div>
      </div>

      {active.length > 0 && (
        <Card>
          <p className="text-xs tracking-wide text-soft uppercase">Worth now</p>
          <p className="font-display mt-1 text-4xl tabular-nums">
            <Amount paise={totalValuePaise} />
          </p>
          <p className="mt-2 text-sm text-soft">
            Put in {rupees(totalInvestedPaise)} ·{" "}
            <span className={`font-medium ${tone(gainPaise)}`}>
              {signed(gainPaise)}
              {pct !== null && ` (${pct}%)`}
            </span>
          </p>
          {accounts.length > 0 && totalValuePaise > 0 && (
            <div className="mt-3 space-y-1.5">
              {accounts.filter((a) => a.valuePaise > 0).map((a) => (
                <div key={a.id}>
                  <div className="flex justify-between text-xs text-soft">
                    <span>{a.name}</span>
                    <span>{a.sharePct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-sunk">
                    <span className="block h-full bg-brand" style={{ width: `${a.sharePct ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {active.length === 0 ? (
        <Empty title="No investments yet">Add gold, a mutual fund, shares or crypto. For gold, funds and shares you give the quantity and the rate; otherwise you type what it is worth. It counts toward your net worth.</Empty>
      ) : (
        <>
          {active.length > TOP && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sort by">
              {SORTS.map((s) => (
                <button key={s.key} type="button" aria-pressed={sort === s.key} className={`min-h-11 rounded-full px-3 text-sm ${sort === s.key ? "bg-brand text-white" : "bg-sunk text-soft"}`} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              ))}
              {accounts.length > 0 && (
                <button type="button" className="ml-auto min-h-11 text-sm text-brand" onClick={() => setManage("move")}>
                  Move investments…
                </button>
              )}
            </div>
          )}

          {accounts.length === 0 && active.length > 0 && (
            <p className="rounded-xl bg-sunk p-3 text-sm text-soft">
              Hold investments in more than one demat or broker account? Add them under Broker accounts and Alfred shows what each holds.
            </p>
          )}

          {accounts.map((a) => (
            <Group key={a.id} title={a.name} note={a.purpose} holdings={inAccount(a.id)} sort={sort} open={!shut.has(a.id)} onToggle={() => toggle(a.id)} onAct={act} />
          ))}
          {/* Investments that are in no broker account (gold coins, a property) are simply listed, with no card to open. */}
          {loose.length > 0 && (
            <div className="space-y-2">
              {accounts.length > 0 && <p className="px-1 text-xs tracking-wide text-soft uppercase">Other investments</p>}
              {looseByKind(active, known).map((k) => (
                <KindCard
                  key={k.kindKey}
                  summary={k}
                  sort={sort}
                  open={!shut.has(`kind:${k.kindKey}`)}
                  onToggle={() => toggle(`kind:${k.kindKey}`)}
                  onAct={act}
                  onRate={() => setRateKind(k)}
                  {...(accounts.length > 0 && kindsList.find((x) => x.key === k.kindKey)?.brokerUse === "required" ? { onAssign: () => setManage("move") } : {})}
                />
              ))}
            </div>
          )}
        </>
      )}

      {closed.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-soft">Closed ({closed.length})</summary>
          <Card pad="p-0">
            <ul className="divide-y divide-line">
              {closed.map((h) => (
                <HoldingLine key={h.id} h={h} onAct={act(h)} showKind />
              ))}
            </ul>
          </Card>
        </details>
      )}

      {rateKind && <KindRateSheet summary={rateKind} onClose={() => setRateKind(null)} />}
      {manage === "accounts" && <AccountsSheet onClose={() => setManage(null)} />}
      {manage === "move" && <MoveSheet holdings={active} onClose={() => setManage(null)} />}
      {sheet?.kind === "edit" && <HoldingSheet holding={sheet.holding} all={holdings} onBuyInstead={(h) => setSheet({ kind: "buy", holding: h })} onClose={() => setSheet(null)} />}
      {sheet?.kind === "rate" && <RateSheet holding={sheet.holding} onClose={() => setSheet(null)} />}
      {sheet?.kind === "convert" && <ConvertSheet holding={sheet.holding} onClose={() => setSheet(null)} />}
      {sheet?.kind === "value" && <ValueSheet holding={sheet.holding} onClose={() => setSheet(null)} />}
      {(sheet?.kind === "buy" || sheet?.kind === "sell") && <TradeSheet holding={sheet.holding} selling={sheet.kind === "sell"} onClose={() => setSheet(null)} />}
    </div>
  );
}
