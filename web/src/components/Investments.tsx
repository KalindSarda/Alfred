import { useState } from "react";
import { type Holding, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useAccounts, useHoldings, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, Empty, ErrorText, Field, Sheet, inputClass } from "./ui";

const KINDS: { value: Holding["kind"]; label: string }[] = [
  { value: "stock", label: "Stock or IPO" },
  { value: "gold", label: "Gold" },
  { value: "crypto", label: "Crypto" },
  { value: "other", label: "Other" },
];
const kindLabel = (k: Holding["kind"]) => KINDS.find((x) => x.value === k)?.label ?? "Other";

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

function HoldingSheet({ holding, onClose }: { holding: Holding | null; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [name, setName] = useState(holding?.name ?? "");
  const [kind, setKind] = useState<Holding["kind"]>(holding?.kind ?? "stock");
  const [invested, setInvested] = useState("");
  const [value, setValue] = useState("");

  const save = () => {
    if (!name.trim()) return setError("Name it, such as Tata Technologies or Gold.");
    if (holding) return void run(() => api.patch(`/api/holdings/${holding.id}`, { name: name.trim(), kind }), "Saved.");
    const put = invested.trim() ? rupeesToPaise(invested) : 0;
    const worth = value.trim() ? rupeesToPaise(value) : null;
    if (invested.trim() && put === null) return setError("What you put in looks wrong. Leave it empty if nothing yet.");
    if (value.trim() && worth === null) return setError("What it is worth looks wrong. Leave it empty if you do not know yet.");
    void run(() => api.post("/api/holdings", { name: name.trim(), kind, ...(put ? { investedPaise: put } : {}), ...(worth !== null ? { valuePaise: worth } : {}) }), "Investment added.");
  };

  return (
    <Sheet title={holding ? "Edit investment" : "Add an investment"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="What is it?">
          <input className={inputClass} maxLength={40} autoComplete="off" placeholder="Tata Technologies" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Holding["kind"])}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        {!holding && (
          <>
            <Field label="Already put in (₹)" hint="What you invested before Alfred, with no bank entry. Anything you buy from here on is recorded through a bank.">
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="10000" value={invested} onChange={(e) => setInvested(e.target.value)} />
            </Field>
            <Field label="Worth now (₹)" hint="You type this yourself, and update it when you like. Alfred asks on the 1st of each month.">
              <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="12000" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {holding && holding.entries.length === 0 && (
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
          <input className={inputClass} inputMode="decimal" autoComplete="off" autoFocus placeholder="15200" value={amount} onChange={(e) => setAmount(e.target.value)} />
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

function TradeSheet({ holding, selling, onClose }: { holding: Holding; selling: boolean; onClose: () => void }) {
  const { run, error, setError, busy } = useAction(onClose);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [closeOut, setCloseOut] = useState(false);
  const banks = (useAccounts().data ?? []).filter((a) => a.kind === "bank");
  const account = accountId || banks[0]?.id || "";

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!paise) return setError(selling ? "Enter what you received, such as 4000." : "Enter what you paid, such as 5000.");
    if (!account) return setError("Add a bank account first.");
    const body = { amountPaise: paise, accountId: account, date, note: note.trim() || null, ...(selling && closeOut ? { closeOut: true } : {}) };
    void run(
      () => api.post(`/api/holdings/${holding.id}/${selling ? "sell" : "buy"}`, body),
      selling ? `Sold: ${rupees(paise)} came into your bank.` : `Bought ${rupees(paise)} of ${holding.name}.`,
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
            ? `The money comes into the bank you choose. It is not income. It is worth ${rupees(holding.valuePaise)} now.`
            : "The money goes out of the bank you choose as an Investment entry. It is not spending."}
        </p>
        <Field label={selling ? "Received (₹)" : "Paid (₹)"}>
          <input className={inputClass} inputMode="decimal" autoComplete="off" autoFocus placeholder={selling ? paiseToInput(holding.valuePaise) : "5000"} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <BankPick label={selling ? "Into" : "From"} value={account} onChange={setAccountId} />
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

type SheetState = { kind: "edit"; holding: Holding | null } | { kind: "value" | "buy" | "sell"; holding: Holding } | null;

function Row({ h, onAct }: { h: Holding; onAct: (what: "value" | "buy" | "sell" | "edit") => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const active = h.status === "active";
  const stale = active && (h.staleDays === null || h.staleDays > 35);

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
        <span className="min-w-0 truncate font-medium">
          {h.name}
          <span className="ml-2 text-xs font-normal text-faint">{kindLabel(h.kind)}{!active && " · closed"}</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{rupees(h.valuePaise)}</span>
      </div>
      <p className="text-sm text-soft">
        Put in {rupees(h.investedPaise)}
        {h.soldPaise > 0 && <> · sold for {rupees(h.soldPaise)}</>}
        {" · "}
        <span className={`font-medium ${tone(h.gainPaise)}`}>
          {signed(h.gainPaise)}
          {h.gainPct !== null && ` (${h.gainPct}%)`}
        </span>
      </p>
      <p className={`text-xs ${stale ? "font-medium text-warn-ink" : "text-soft"}`}>{ago(h.staleDays)}</p>
      <div className="flex flex-wrap gap-2">
        {active ? (
          <>
            <Button className="min-h-11 py-1.5 text-sm" onClick={() => onAct("value")}>
              Update value
            </Button>
            <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("buy")}>
              Buy more
            </Button>
            {h.valuePaise > 0 && (
              <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("sell")}>
                Sell
              </Button>
            )}
            <Button variant="ghost" className="min-h-11 py-1.5 text-sm" onClick={() => onAct("edit")}>
              Edit
            </Button>
            <Button
              variant="ghost"
              className="min-h-11 py-1.5 text-sm"
              onClick={() => {
                if (window.confirm(`Close ${h.name}? It stops counting toward your net worth. Use this when it is gone without a sale you want recorded.`)) void act(() => api.post(`/api/holdings/${h.id}/close`), `${h.name} closed.`);
              }}
            >
              Close
            </Button>
          </>
        ) : (
          <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => void act(() => api.post(`/api/holdings/${h.id}/reopen`), `${h.name} reopened. Type its value to count it again.`)}>
            Reopen
          </Button>
        )}
      </div>
      {(h.entries.length > 0 || h.values.length > 1) && (
        <div>
          <button type="button" className="min-h-9 text-sm text-soft underline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide history" : "History"}
          </button>
          {open && (
            <ul className="mt-1 space-y-1 text-sm text-soft">
              {h.entries.map((e) => (
                <li key={e.id}>
                  {shortDate(e.date)} · {e.kind === "buy" ? "bought" : "sold"} {rupees(e.amountPaise)}
                  {e.accountName ? ` ${e.kind === "buy" ? "from" : "into"} ${e.accountName}` : ""}
                  {e.note ? ` · ${e.note}` : ""}
                </li>
              ))}
              {h.values.map((v) => (
                <li key={v.date}>
                  {shortDate(v.date)} · valued {rupees(v.valuePaise)}
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

/** What you own and what it is worth: shares, IPO allotments, gold, crypto. Values are typed by you; buying and selling go through a bank. */
export function Investments() {
  const query = useHoldings("all");
  const [sheet, setSheet] = useState<SheetState>(null);

  if (query.isPending) return <p className="py-8 text-center text-sm text-soft">Loading…</p>;
  if (query.isError) return <Empty title="Could not load your investments">Check your connection and reload.</Empty>;

  const { holdings, totalValuePaise, totalInvestedPaise, gainPaise } = query.data;
  const active = holdings.filter((h) => h.status === "active");
  const closed = holdings.filter((h) => h.status === "closed");
  const act = (h: Holding) => (what: "value" | "buy" | "sell" | "edit") => setSheet(what === "edit" ? { kind: "edit", holding: h } : { kind: what, holding: h });
  const pct = totalInvestedPaise > 0 ? Math.round((gainPaise / totalInvestedPaise) * 1000) / 10 : null;

  return (
    <div className="space-y-4" id="investments">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-soft">{active.length === 0 ? "Nothing recorded yet" : `${active.length} ${active.length === 1 ? "investment" : "investments"}`}</p>
        <Button onClick={() => setSheet({ kind: "edit", holding: null })}>Add investment</Button>
      </div>

      {active.length > 0 && (
        <Card>
          <p className="text-xs tracking-wide text-soft uppercase">Worth now</p>
          <p className="font-display mt-1 text-4xl tabular-nums">{rupees(totalValuePaise)}</p>
          <p className="mt-2 text-sm text-soft">
            Put in {rupees(totalInvestedPaise)} ·{" "}
            <span className={`font-medium ${tone(gainPaise)}`}>
              {signed(gainPaise)}
              {pct !== null && ` (${pct}%)`}
            </span>
          </p>
        </Card>
      )}

      {active.length === 0 ? (
        <Empty title="No investments yet">Add shares, an IPO allotment, gold or crypto, and type what it is worth now. It counts toward your net worth.</Empty>
      ) : (
        <Card pad="p-0">
          <ul className="divide-y divide-line">
            {active.map((h) => (
              <Row key={h.id} h={h} onAct={act(h)} />
            ))}
          </ul>
        </Card>
      )}

      {closed.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-soft">Closed ({closed.length})</summary>
          <Card pad="p-0">
            <ul className="divide-y divide-line">
              {closed.map((h) => (
                <Row key={h.id} h={h} onAct={act(h)} />
              ))}
            </ul>
          </Card>
        </details>
      )}

      {sheet?.kind === "edit" && <HoldingSheet holding={sheet.holding} onClose={() => setSheet(null)} />}
      {sheet?.kind === "value" && <ValueSheet holding={sheet.holding} onClose={() => setSheet(null)} />}
      {(sheet?.kind === "buy" || sheet?.kind === "sell") && <TradeSheet holding={sheet.holding} selling={sheet.kind === "sell"} onClose={() => setSheet(null)} />}
    </div>
  );
}
