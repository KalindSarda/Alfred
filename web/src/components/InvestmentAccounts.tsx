import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { type Holding, type InvestmentAccount, api, describeError } from "../api";
import { rupees } from "../format";
import { useInvestmentAccounts, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, ErrorText, Field, Sheet, inputClass } from "./ui";

/** The account choice on a holding or an allotment: none, or one of the person's broker accounts. */
export function AccountSelect({ value, onChange, label = "Broker account" }: { value: string; onChange: (id: string) => void; label?: string }) {
  const accounts = useInvestmentAccounts().data?.accounts ?? [];
  if (accounts.length === 0) return null;
  return (
    <Field label={label} hint="Where this is held, such as your demat account. Optional.">
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not in an account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Add, rename, change the purpose of, or archive the broker and demat accounts. */
export function AccountsSheet({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const query = useInvestmentAccounts(true);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [editing, setEditing] = useState<InvestmentAccount | null>(null);
  const [error, setError] = useState("");

  const done = async (message: string) => {
    await client.invalidateQueries({ queryKey: ["investment-accounts"] });
    await client.invalidateQueries({ queryKey: ["holdings"] });
    toast.show(message);
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), purpose: purpose.trim() || null };
      return editing ? api.patch(`/api/investment-accounts/${editing.id}`, body) : api.post("/api/investment-accounts", body);
    },
    onSuccess: async () => {
      await done(editing ? "Saved" : "Account added");
      setEditing(null);
      setName("");
      setPurpose("");
    },
  });
  const archive = useMutation({
    mutationFn: (a: InvestmentAccount) => api.post(`/api/investment-accounts/${a.id}/${a.archived ? "unarchive" : "archive"}`),
    onSuccess: () => done("Saved"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name it, such as ICICI Direct or Groww.");
    setError("");
    save.mutate();
  };
  const accounts = query.data?.accounts ?? [];

  return (
    <Sheet title="Broker accounts" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-soft">Your demat or broker accounts. Put each investment in one, and Alfred shows what each holds.</p>
        {accounts.length > 0 && (
          <ul className="divide-y divide-line">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                <span className={a.archived ? "text-faint" : ""}>
                  <span className="block font-medium">
                    {a.name}
                    {a.archived && " · archived"}
                  </span>
                  <span className="block text-xs text-soft">
                    {a.purpose ? `${a.purpose} · ` : ""}
                    {a.holdingCount} {a.holdingCount === 1 ? "holding" : "holdings"} · {rupees(a.valuePaise)}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="min-h-11 text-sm text-brand"
                    onClick={() => {
                      setEditing(a);
                      setName(a.name);
                      setPurpose(a.purpose ?? "");
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="min-h-11 text-sm text-soft" disabled={archive.isPending} onClick={() => archive.mutate(a)}>
                    {a.archived ? "Restore" : "Archive"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-3 border-t border-line pt-3" onSubmit={submit} noValidate>
          <p className="text-sm font-medium">{editing ? `Edit ${editing.name}` : "Add an account"}</p>
          <Field label="Name">
            <input className={inputClass} maxLength={40} autoComplete="off" placeholder="ICICI Direct" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="What it is for (optional)" hint="A few words, such as long term, family, or IPOs and learning.">
            <input className={inputClass} maxLength={80} autoComplete="off" placeholder="Long term, family" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
          <ErrorText>{error || (save.isError ? describeError(save.error) : archive.isError ? describeError(archive.error) : "")}</ErrorText>
          <div className="flex gap-3">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {editing ? "Save changes" : "Add account"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setName("");
                  setPurpose("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </div>
    </Sheet>
  );
}

/** Pick any number of investments and move them into an account together, which is what you want with a long list. */
export function MoveSheet({ holdings, start, onClose }: { holdings: Holding[]; /** Holdings ticked to begin with. */ start?: string[]; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const accounts = useInvestmentAccounts().data?.accounts ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set(start ?? []));
  const [target, setTarget] = useState(accounts[0]?.id ?? "");
  const [find, setFind] = useState("");
  const [error, setError] = useState("");
  const shown = useMemo(() => holdings.filter((h) => !find.trim() || h.name.toLowerCase().includes(find.trim().toLowerCase())), [holdings, find]);

  const move = useMutation({
    mutationFn: () => api.post<{ moved: number }>("/api/holdings/move", { ids: [...picked], investmentAccountId: target || null }),
    onSuccess: async (r) => {
      await refresh();
      toast.show(`Moved ${r.moved} ${r.moved === 1 ? "investment" : "investments"}`);
      onClose();
    },
  });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (picked.size === 0) return setError("Tick at least one investment.");
    if (picked.size > 90) return setError("Move up to 90 at a time.");
    setError("");
    move.mutate();
  };

  return (
    <Sheet title="Move investments" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <Field label="Move them to">
          <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Not in an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Find an investment">
          <input className={inputClass} autoComplete="off" placeholder="Type to narrow the list" value={find} onChange={(e) => setFind(e.target.value)} />
        </Field>
        <div className="flex items-center justify-between text-sm">
          <span className="text-soft">{picked.size} ticked</span>
          <span className="flex gap-3">
            <button type="button" className="min-h-11 text-brand" onClick={() => setPicked((prev) => new Set([...prev, ...shown.map((h) => h.id)]))}>
              Tick all shown
            </button>
            <button type="button" className="min-h-11 text-soft" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </span>
        </div>
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {shown.map((h) => (
            <li key={h.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" className="size-5 accent-brand" checked={picked.has(h.id)} onChange={() => toggle(h.id)} />
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                <span className="shrink-0 text-xs text-soft">{h.accountName ?? "No account"}</span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-3 text-sm text-soft">Nothing matches.</li>}
        </ul>
        <ErrorText>{error || (move.isError ? describeError(move.error) : "")}</ErrorText>
        <Button type="submit" className="w-full" disabled={move.isPending}>
          Move {picked.size > 0 ? picked.size : ""}
        </Button>
      </form>
    </Sheet>
  );
}
