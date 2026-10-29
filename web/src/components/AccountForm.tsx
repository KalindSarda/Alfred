import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { parsePaise } from "../../../src/domain/money";
import { type Account, api, describeError } from "../api";
import { paiseToInput, parseSignedPaise } from "../format";
import { useAccounts, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, ErrorText, Field, inputClass } from "./ui";

const entriesText = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

export function AccountForm({ initial, onDone }: { initial?: Account; onDone: () => void }) {
  const refresh = useRefreshMoney();
  const client = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"bank" | "card">(initial?.kind ?? "bank");
  const [name, setName] = useState(initial?.name ?? "");
  const [last4, setLast4] = useState(initial?.last4 ?? "");
  const [opening, setOpening] = useState(initial?.kind === "bank" ? paiseToInput(initial.openingBalancePaise) : "");
  const [counts, setCounts] = useState(initial?.kind === "bank" ? initial.countsTowardSafeToSpend : true);
  const [limit, setLimit] = useState(initial?.kind === "card" ? paiseToInput(initial.creditLimitPaise) : "");
  const [statementDay, setStatementDay] = useState(initial?.kind === "card" ? String(initial.statementDay) : "");
  const [dueDay, setDueDay] = useState(initial?.kind === "card" ? String(initial.dueDay) : "");
  const [outstanding, setOutstanding] = useState(
    initial?.kind === "card" ? paiseToInput(initial.openingOutstandingPaise) : "",
  );
  const [localError, setLocalError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const common = { name: name.trim(), last4: last4.trim() || null };
      let body: Record<string, unknown>;
      if (kind === "bank") {
        const openingBalancePaise = parseSignedPaise(opening);
        if (openingBalancePaise === null) throw new LocalError("Opening balance looks wrong. Use a number like 25000 or -1500.");
        body = { ...common, openingBalancePaise, countsTowardSafeToSpend: counts };
      } else {
        const creditLimitPaise = parsePaise(limit);
        const openingOutstandingPaise = parseSignedPaise(outstanding);
        if (creditLimitPaise === null) throw new LocalError("Enter the credit limit, for example 200000.");
        if (openingOutstandingPaise === null || openingOutstandingPaise < 0) {
          throw new LocalError("Outstanding amount must be zero or more.");
        }
        body = {
          ...common,
          creditLimitPaise,
          statementDay: Number(statementDay),
          dueDay: Number(dueDay),
          openingOutstandingPaise,
        };
      }
      return initial ? api.patch(`/api/accounts/${initial.id}`, body) : api.post("/api/accounts", { kind, ...body });
    },
    onSuccess: async () => {
      await refresh();
      toast.show(initial ? "Saved" : "Account added");
      onDone();
    },
  });

  const archive = useMutation({
    mutationFn: () => api.post(`/api/accounts/${initial?.id}/${initial?.archived ? "unarchive" : "archive"}`),
    onSuccess: async () => {
      await refresh();
      await client.invalidateQueries({ queryKey: ["accounts"] });
      onDone();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/accounts/${initial?.id}`),
    onSuccess: async () => {
      await refresh();
      toast.show("Account deleted");
      onDone();
    },
  });

  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState("");
  const all = useAccounts(true);
  const candidates = (all.data ?? []).filter((a) => initial && a.kind === initial.kind && a.id !== initial.id && !a.archived);
  const into = candidates.find((a) => a.id === target);
  const merge = useMutation({
    mutationFn: () => api.post<{ movedEntries: number; removedTransfers: number }>(`/api/accounts/${initial?.id}/merge`, { intoId: target }),
    onSuccess: async (r) => {
      await refresh();
      toast.show(`Merged into ${into?.name ?? "the other account"}. ${entriesText(r.movedEntries)} moved.`);
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    save.mutate();
  };

  const error = save.error instanceof LocalError ? save.error.message : save.isError ? describeError(save.error) : "";

  return (
    <form onSubmit={submit} className="space-y-4">
      {!initial && (
        <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
          {(["bank", "card"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 rounded-lg text-sm font-medium ${kind === k ? "bg-card shadow-sm" : "text-soft"}`}
            >
              {k === "bank" ? "Bank account" : "Credit card"}
            </button>
          ))}
        </div>
      )}

      <Field label="Name">
        <input className={inputClass} required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "bank" ? "HDFC Bank" : "HDFC Millennia"} />
      </Field>

      <Field label="Last 4 digits (optional)" hint="Only the last four digits are ever stored. Never enter a full card or account number.">
        <input className={inputClass} inputMode="numeric" maxLength={4} pattern="\d{4}|" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
      </Field>

      {kind === "bank" ? (
        <>
          <Field
            label={initial ? "Balance before your first entry (₹)" : "Balance today (₹)"}
            hint={
              initial
                ? "Your balance is this figure plus every entry. Changing it moves the balance by the same amount, on every day."
                : "What the account holds right now. Entries you add from here on are applied on top of it."
            }
          >
            <input className={inputClass} inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-brand" checked={counts} onChange={(e) => setCounts(e.target.checked)} />
            Count this account toward safe-to-spend
          </label>
        </>
      ) : (
        <>
          <Field label="Credit limit (₹)">
            <input className={inputClass} inputMode="decimal" required value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Statement day">
              <input className={inputClass} type="number" min={1} max={31} required value={statementDay} onChange={(e) => setStatementDay(e.target.value)} />
            </Field>
            <Field label="Payment due day">
              <input className={inputClass} type="number" min={1} max={31} required value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-soft">
            If the due day is later than the statement day it falls in the same month; otherwise in the next month.
          </p>
          <Field
            label={initial ? "Owed before your first entry (₹)" : "Owed right now (₹)"}
            hint={initial ? "What the card owed before the entries here. Changing it changes what it owes now by the same amount." : "Leave empty if you are starting fresh."}
          >
            <input className={inputClass} inputMode="decimal" placeholder="0" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} />
          </Field>
        </>
      )}

      <ErrorText>
        {localError ||
          error ||
          (archive.isError ? describeError(archive.error) : remove.isError ? describeError(remove.error) : merge.isError ? describeError(merge.error) : "")}
      </ErrorText>

      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={save.isPending}>
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Add account"}
        </Button>
        {initial && (
          <Button type="button" variant="secondary" disabled={archive.isPending} onClick={() => archive.mutate()}>
            {initial.archived ? "Unarchive" : "Archive"}
          </Button>
        )}
      </div>

      {initial && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-sm text-soft">
            {entriesText(initial.entryCount)} use this {initial.kind === "bank" ? "account" : "card"}.
          </p>

          {candidates.length > 0 &&
            (!merging ? (
              <Button type="button" variant="secondary" onClick={() => setMerging(true)}>
                Merge into another {initial.kind === "bank" ? "account" : "card"}…
              </Button>
            ) : (
              <div className="space-y-3">
                <Field label="Merge into">
                  <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Choose…</option>
                    {candidates.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {into && (
                  <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
                    All entries move to {into.name}, and {initial.name} is removed. Its {initial.kind === "bank" ? "starting balance is added to" : "starting amount owed is added to"} {into.name}, so totals stay the same
                    {initial.archived ? " once it is included again" : ""}. Transfers between the two cancel out and are removed.
                    {initial.kind === "card" ? ` Statements follow ${into.name}'s statement and due days.` : ""} This cannot be undone.
                  </p>
                )}
                <Button type="button" disabled={!into || merge.isPending} onClick={() => merge.mutate()}>
                  Merge and remove {initial.name}
                </Button>
              </div>
            ))}

          {initial.entryCount === 0 ? (
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete ${initial.name}? This cannot be undone.`)) remove.mutate();
              }}
            >
              Delete
            </Button>
          ) : (
            <p className="text-xs text-soft">An account with entries cannot be deleted. Merge it into another, or archive it to hide it.</p>
          )}
        </div>
      )}
    </form>
  );
}

class LocalError extends Error {}
