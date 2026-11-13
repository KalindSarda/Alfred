import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { parsePaise } from "../../../src/domain/money";
import { type Transaction, type TxnType, api, describeError } from "../api";
import { newKey, paiseToInput, rupees, today } from "../format";
import { defaultAccountId, describeQuickLine, memoryFor, parseQuickLine, quickFailure, topMerchants } from "../quickLine";
import { useAccounts, useCategories, useEntryHints, useHoldings, useRefreshMoney } from "../queries";
import { AmountInput, Button, ErrorText, Field, inputClass } from "./ui";
import { useToast } from "./toast";

const TYPES: { value: TxnType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "bill_payment", label: "Pay bill" },
  { value: "investment", label: "Invest" },
];

const isMovement = (type: TxnType) => type === "transfer" || type === "bill_payment";
/** Movements and investments are not income or expense, so they have no category. */
const noCategory = (type: TxnType) => isMovement(type) || type === "investment";

export function TxnForm({ initial, onDone }: { initial?: Transaction; onDone: () => void }) {
  const accountsQuery = useAccounts(true);
  const categoriesQuery = useCategories();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const idempotencyKey = useRef(newKey());
  const lineRef = useRef<HTMLInputElement>(null);
  const hintsQuery = useEntryHints();
  const holdingsQuery = useHoldings("active");
  const hints = hintsQuery.data;

  const [type, setType] = useState<TxnType>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? paiseToInput(initial.amountPaise) : "");
  const [date, setDate] = useState(initial?.txnDate ?? today());
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [holdingId, setHoldingId] = useState(initial?.holdingId ?? "");
  const [countsFor, setCountsFor] = useState(initial?.countsForDate ?? "");
  const [localError, setLocalError] = useState("");
  // The sheet takes focus when it opens; the one-line add gets it straight after, so typing can begin at once.
  useEffect(() => {
    if (initial) return;
    const t = window.setTimeout(() => lineRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [initial]);
  // The one-line add, and what it understood. Choices made by hand are not overwritten by the merchant's memory.
  const [line, setLine] = useState("");
  const [lineNote, setLineNote] = useState<{ text: string; problem: boolean } | null>(null);
  const [accountTouched, setAccountTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);

  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => !a.archived || a.id === initial?.accountId || a.id === initial?.toAccountId),
    [accountsQuery.data, initial],
  );
  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => c.kind === type && (!c.archived || c.id === initial?.categoryId)),
    [categoriesQuery.data, type, initial],
  );
  // Transfers are bank to bank; a bill payment goes from a bank to a credit card.
  const fromOptions = useMemo(() => accounts.filter((a) => !noCategory(type) || a.kind === "bank"), [accounts, type]);
  const toOptions = useMemo(
    () => accounts.filter((a) => (type === "bill_payment" ? a.kind === "card" : a.kind === "bank") && a.id !== accountId),
    [accounts, type, accountId],
  );
  const effectiveAccount = fromOptions.find((a) => a.id === accountId)?.id ?? defaultAccountId(fromOptions, hints?.lastUsedAccountIds ?? []);

  const kindOf = (t: TxnType): "expense" | "income" => (t === "income" ? "income" : "expense");
  const allowedFrom = (t: TxnType) => accounts.filter((a) => !noCategory(t) || a.kind === "bank");

  /** Reads the sentence and fills the form from it; the fields stay editable and win from then on. */
  const onLine = (text: string) => {
    setLine(text);
    if (!text.trim()) return setLineNote(null);
    const result = parseQuickLine(
      text,
      type,
      {
        today: today(),
        accounts: accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
        categories: (categoriesQuery.data ?? []).filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
        hints,
      },
    );
    if (!result.ok) return setLineNote({ text: quickFailure(result.reason), problem: true });
    const f = result.fill;
    setType(f.type);
    setAmount(paiseToInput(f.amountPaise));
    setDate(f.txnDate);
    setToAccountId(f.toAccountId ?? "");
    setCategoryId(f.categoryId ?? "");
    setCategoryTouched(false);
    setMerchant(f.merchant ?? "");
    const usable = f.accountId && allowedFrom(f.type).some((a) => a.id === f.accountId) ? f.accountId : "";
    setAccountId(usable);
    setAccountTouched(Boolean(usable) && f.accountNamed);
    setLineNote({
      text: describeQuickLine(f, { accounts: new Map(accounts.map((a) => [a.id, a.name])), categories: new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.name])) }, today()),
      problem: false,
    });
  };

  /** A merchant seen before brings its usual category and account, unless you have already chosen them. */
  const applyMemory = (name: string, force = false) => {
    if (initial || noCategory(type)) return;
    const memory = memoryFor(name, hints, kindOf(type), categoriesQuery.data ?? []);
    if (!memory) return;
    if (memory.categoryId && (force || !categoryTouched)) setCategoryId(memory.categoryId);
    if ((force || !accountTouched) && allowedFrom(type).some((a) => a.id === memory.accountId)) setAccountId(memory.accountId);
  };

  // Refunds and money other people paid back are taken off spending: they can count in the month of the spending they pay back.
  const comesBack = type === "income" && ["Refunds", "Repaid by others"].includes((categoriesQuery.data ?? []).find((c) => c.id === categoryId)?.name ?? "");

  const save = useMutation({
    mutationFn: () => {
      const paise = parsePaise(amount);
      if (paise === null) throw new Error("Enter an amount like 450 or 450.50");
      const body = {
        type,
        amountPaise: paise,
        txnDate: date,
        accountId: effectiveAccount,
        toAccountId: isMovement(type) ? toAccountId : null,
        categoryId: noCategory(type) || !categoryId ? null : categoryId,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        holdingId: type === "investment" && holdingId ? holdingId : null,
        countsForDate: comesBack && countsFor ? countsFor : null,
      };
      return initial
        ? api.patch<Transaction>(`/api/transactions/${initial.id}`, body)
        : api.post<Transaction>("/api/transactions", body, { "Idempotency-Key": idempotencyKey.current });
    },
    onSuccess: async (saved) => {
      await refresh();
      toast.show(initial ? "Saved" : `Added ${rupees(saved.amountPaise)}`);
      onDone();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/transactions/${initial?.id}`),
    onSuccess: async () => {
      const id = initial?.id;
      await refresh();
      onDone();
      toast.show("Deleted", {
        label: "Undo",
        run: () => {
          void api.post(`/api/transactions/${id}/restore`).then(refresh);
        },
      });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    if (!effectiveAccount) return setLocalError("Add an account first (Accounts and commitments tab).");
    if (isMovement(type) && !toAccountId) {
      return setLocalError(type === "bill_payment" ? "Choose the credit card you are paying." : "Choose the account the money goes to.");
    }
    save.mutate();
  };

  const serverError = save.isError ? (save.error instanceof Error && !("status" in save.error) ? save.error.message : describeError(save.error)) : "";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Type" className="grid grid-cols-5 gap-1 rounded-xl bg-sunk p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={type === t.value}
            onClick={() => {
              setType(t.value);
              setCategoryId("");
              setCategoryTouched(false);
              setToAccountId("");
            }}
            className={`min-h-11 rounded-lg text-xs font-medium ${
              type === t.value ? "bg-card shadow-sm" : "text-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!initial && (
        <div className="space-y-2">
          <Field label="Type it in one line" hint="For example: 450 swiggy hdfc yesterday. The form below fills in; change anything, then Add.">
            <input
              className={inputClass}
              autoComplete="off"
              ref={lineRef}
              enterKeyHint="done"
              placeholder="450 swiggy hdfc yesterday"
              aria-label="Describe the entry in one line"
              value={line}
              onChange={(e) => onLine(e.target.value)}
            />
          </Field>
          {lineNote && (
            <p className={`rounded-lg px-3 py-2 text-sm ${lineNote.problem ? "bg-warn-bg text-warn-ink" : "bg-sunk"}`} aria-live="polite">
              {lineNote.text}
            </p>
          )}
          {!line && !noCategory(type) && (hints?.merchants.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Frequent merchants">
              {topMerchants(hints, 6).map((m) => (
                <button
                  key={m.merchant}
                  type="button"
                  className="min-h-9 rounded-full border border-line bg-card px-3 text-sm hover:bg-hover"
                  onClick={() => {
                    setMerchant(m.merchant);
                    applyMemory(m.merchant, true);
                  }}
                >
                  {m.merchant}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Field label="Amount (₹)">
        <AmountInput
          className={`${inputClass} text-2xl font-semibold`}
         
          placeholder="0"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>

      <Field label={isMovement(type) ? "Pay from" : type === "investment" ? "Paid from" : "Account"} {...(type === "investment" ? { hint: "Money put into shares, IPOs or funds. It lowers the balance but is not counted as spending." } : {})}>
        <select
          className={inputClass}
          value={effectiveAccount}
          onChange={(e) => {
            setAccountId(e.target.value);
            setAccountTouched(true);
          }}
          required
        >
          {fromOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.kind === "card" ? " (card)" : ""}
            </option>
          ))}
        </select>
      </Field>

      {isMovement(type) && (
        <Field
          label={type === "bill_payment" ? "Credit card" : "To account"}
          hint={
            type === "bill_payment"
              ? "Pays down what the card owes. It is not an expense."
              : "Moves money between two of your bank accounts. To pay a card, use Pay bill."
          }
        >
          <select className={inputClass} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
            <option value="">Choose…</option>
            {toOptions
              .filter((a) => a.id !== effectiveAccount)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
      )}

      {!noCategory(type) && (
        <Field label="Category">
          <select
            className={inputClass}
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setCategoryTouched(true);
            }}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Date">
        <input className={inputClass} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      {comesBack && (
        <Field label="For spending on (optional)" hint="Leave empty if it pays back something from this month. Set it to the day you spent the money, so that month shows the true spending.">
          <input className={inputClass} type="date" value={countsFor} onChange={(e) => setCountsFor(e.target.value)} />
        </Field>
      )}

      {!isMovement(type) && (
        <Field label={type === "investment" ? "What (for example, the IPO)" : "Merchant"}>
          <input
            className={inputClass}
            maxLength={80}
            autoComplete="off"
            list={initial ? undefined : "known-merchants"}
            value={merchant}
            onChange={(e) => {
              setMerchant(e.target.value);
              applyMemory(e.target.value);
            }}
          />
          {!initial && (
            <datalist id="known-merchants">
              {(hints?.merchants ?? []).map((m) => (
                <option key={m.merchant} value={m.merchant} />
              ))}
            </datalist>
          )}
        </Field>
      )}

      {type === "investment" && (holdingsQuery.data?.holdings.length ?? 0) > 0 && (
        <Field label="Belongs to" hint="Pick the investment this buys, so it counts toward what you have put in.">
          <select className={inputClass} value={holdingId} onChange={(e) => setHoldingId(e.target.value)}>
            <option value="">None</option>
            {(holdingsQuery.data?.holdings ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Note">
        <input className={inputClass} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <ErrorText>{localError || serverError || (remove.isError ? describeError(remove.error) : "")}</ErrorText>

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={save.isPending}>
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Add"}
        </Button>
        {initial && (
          <Button type="button" variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}
