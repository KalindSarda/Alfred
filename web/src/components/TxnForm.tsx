import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { parsePaise } from "../../../src/domain/money";
import { type Transaction, type TxnType, api, describeError } from "../api";
import { newKey, paiseToInput, rupees, today } from "../format";
import { useAccounts, useCategories, useRefreshMoney } from "../queries";
import { Button, ErrorText, Field, inputClass } from "./ui";
import { useToast } from "./toast";

const TYPES: { value: TxnType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "bill_payment", label: "Pay bill" },
];

const isMovement = (type: TxnType) => type === "transfer" || type === "bill_payment";

export function TxnForm({ initial, onDone }: { initial?: Transaction; onDone: () => void }) {
  const accountsQuery = useAccounts(true);
  const categoriesQuery = useCategories();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const idempotencyKey = useRef(newKey());

  const [type, setType] = useState<TxnType>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? paiseToInput(initial.amountPaise) : "");
  const [date, setDate] = useState(initial?.txnDate ?? today());
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [localError, setLocalError] = useState("");

  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => !a.archived || a.id === initial?.accountId || a.id === initial?.toAccountId),
    [accountsQuery.data, initial],
  );
  const categories = useMemo(
    () => (categoriesQuery.data ?? []).filter((c) => c.kind === type && (!c.archived || c.id === initial?.categoryId)),
    [categoriesQuery.data, type, initial],
  );
  // Transfers are bank to bank; a bill payment goes from a bank to a credit card.
  const fromOptions = useMemo(() => accounts.filter((a) => !isMovement(type) || a.kind === "bank"), [accounts, type]);
  const toOptions = useMemo(
    () => accounts.filter((a) => (type === "bill_payment" ? a.kind === "card" : a.kind === "bank") && a.id !== accountId),
    [accounts, type, accountId],
  );
  const effectiveAccount = fromOptions.find((a) => a.id === accountId)?.id ?? fromOptions[0]?.id ?? "";

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
        categoryId: isMovement(type) || !categoryId ? null : categoryId,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
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
    if (!effectiveAccount) return setLocalError("Add an account first (Accounts and cards tab).");
    if (isMovement(type) && !toAccountId) {
      return setLocalError(type === "bill_payment" ? "Choose the credit card you are paying." : "Choose the account the money goes to.");
    }
    save.mutate();
  };

  const serverError = save.isError ? (save.error instanceof Error && !("status" in save.error) ? save.error.message : describeError(save.error)) : "";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Type" className="grid grid-cols-4 gap-1 rounded-xl bg-sunk p-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={type === t.value}
            onClick={() => {
              setType(t.value);
              setCategoryId("");
              setToAccountId("");
            }}
            className={`min-h-11 rounded-lg text-[13px] font-medium ${
              type === t.value ? "bg-card shadow-sm" : "text-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Field label="Amount (₹)">
        <input
          className={`${inputClass} text-2xl font-semibold`}
          inputMode="decimal"
          placeholder="0"
          required
          autoFocus={!initial}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>

      <Field label={isMovement(type) ? "Pay from" : "Account"}>
        <select className={inputClass} value={effectiveAccount} onChange={(e) => setAccountId(e.target.value)} required>
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

      {!isMovement(type) && (
        <Field label="Category">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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

      {!isMovement(type) && (
        <Field label="Merchant">
          <input className={inputClass} maxLength={80} value={merchant} onChange={(e) => setMerchant(e.target.value)} />
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
