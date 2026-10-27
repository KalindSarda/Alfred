import type { Account, Category } from "../api";
import { activePreset, applyPreset, emptyFilters, PRESETS, type TxnFilters } from "../filters";
import { Button, Field, inputClass, Sheet } from "./ui";

type Props = {
  filters: TxnFilters;
  accounts: Account[];
  categories: Category[];
  onChange: (next: TxnFilters) => void;
  onClose: () => void;
};

/** Every change applies immediately (the filters live in the address bar); Done just closes the sheet. */
export function FilterSheet({ filters, accounts, categories, onChange, onClose }: Props) {
  const preset = activePreset(filters);
  const custom = (filters.from || filters.to) && !preset;
  const set = (patch: Partial<TxnFilters>) => onChange({ ...filters, ...patch });

  const toggleCategory = (id: string) =>
    set({ categories: filters.categories.includes(id) ? filters.categories.filter((c) => c !== id) : [...filters.categories, id] });

  const expense = categories.filter((c) => c.kind === "expense" && !c.archived);
  const income = categories.filter((c) => c.kind === "income" && !c.archived);

  const checkbox = (id: string, label: string) => (
    <label key={id} className="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" className="size-5 accent-brand" checked={filters.categories.includes(id)} onChange={() => toggleCategory(id)} />
      {label}
    </label>
  );

  return (
    <Sheet title="Filters" onClose={onClose}>
      <div className="space-y-5">
        <Field label="Period">
          <select
            className={inputClass}
            value={custom ? "custom" : (preset ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") set({ from: filters.from || filters.to, to: filters.to || filters.from });
              else onChange(applyPreset(filters, v as "" | (typeof PRESETS)[number]["key"]));
            }}
          >
            <option value="">Any time</option>
            {PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom range</option>
          </select>
        </Field>
        {(custom || (filters.from && !preset)) && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input className={inputClass} type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </Field>
          </div>
        )}

        <Field label="Account">
          <select className={inputClass} value={filters.account} onChange={(e) => set({ account: e.target.value })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount at least (₹)">
            <input className={inputClass} inputMode="decimal" placeholder="Any" value={filters.min} onChange={(e) => set({ min: e.target.value })} />
          </Field>
          <Field label="Amount at most (₹)">
            <input className={inputClass} inputMode="decimal" placeholder="Any" value={filters.max} onChange={(e) => set({ max: e.target.value })} />
          </Field>
        </div>

        <Field label="Status">
          <select className={inputClass} value={filters.status} onChange={(e) => set({ status: e.target.value as TxnFilters["status"] })}>
            <option value="">Confirmed and drafts</option>
            <option value="draft">Drafts only</option>
            <option value="confirmed">Confirmed only</option>
          </select>
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Categories</legend>
          {checkbox("none", "Uncategorized")}
          <p className="mt-2 text-xs tracking-wide text-soft uppercase">Expense</p>
          {expense.map((c) => checkbox(c.id, c.name))}
          <p className="mt-2 text-xs tracking-wide text-soft uppercase">Income</p>
          {income.map((c) => checkbox(c.id, c.name))}
        </fieldset>

        <div className="flex gap-3">
          <Button className="flex-1" onClick={onClose}>
            Done
          </Button>
          <Button variant="secondary" onClick={() => onChange({ ...emptyFilters, q: filters.q })}>
            Clear filters
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
