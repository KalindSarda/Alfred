import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "../router";
import { api, describeError, type BudgetItem } from "../api";
import { Button, Card, Empty, ErrorText, Field, Sheet, Spinner, inputClass } from "../components/ui";
import { useToast } from "../components/toast";
import { rupeesToPaise, transactionsLink } from "../filters";
import { paiseToInput, rupees, shortDate } from "../format";
import { useBudgets, useCategories, useRefreshMoney } from "../queries";

const barColor = { ok: "bg-brand", near: "bg-brass", over: "bg-bad" } as const;

function statusText(b: BudgetItem): string {
  if (b.status === "over") return `${rupees(-b.remainingPaise)} over`;
  const left = `${rupees(b.remainingPaise)} left`;
  return b.status === "near" ? `${left}, close to the limit` : left;
}

function BudgetRow({ item, from, to, onEdit }: { item: BudgetItem; from: string; to: string; onEdit: () => void }) {
  const width = Math.min(100, item.pct);
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Link
          to={transactionsLink({ categories: [item.categoryId], type: "expense", from, to })}
          className="min-w-0 truncate font-medium hover:underline"
        >
          {item.categoryName}
        </Link>
        <button type="button" onClick={onEdit} className="min-h-11 shrink-0 px-2 text-sm font-medium text-brand">
          Edit
        </button>
      </div>
      <div
        role="progressbar"
        aria-label={`${item.categoryName} budget`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(100, item.pct))}
        className="h-2 overflow-hidden rounded-full bg-hover"
      >
        <div className={`h-full rounded-full ${barColor[item.status]}`} style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1.5 flex justify-between gap-3 text-sm">
        <span className="text-soft">
          {rupees(item.spentPaise)} of {rupees(item.limitPaise)}
        </span>
        <span className={item.status === "over" ? "font-medium text-bad" : item.status === "near" ? "text-warn-ink" : "text-soft"}>
          {statusText(item)}
        </span>
      </p>
    </li>
  );
}

function BudgetSheet({
  categoryId,
  limitPaise,
  options,
  onClose,
}: {
  categoryId: string;
  limitPaise: number | null;
  options: { id: string; name: string }[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const editing = limitPaise !== null;
  const [category, setCategory] = useState(categoryId);
  const [amount, setAmount] = useState(editing ? paiseToInput(limitPaise) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await Promise.all([client.invalidateQueries({ queryKey: ["budgets"] }), refresh()]);
      toast.show(done);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const save = () => {
    const paise = rupeesToPaise(amount);
    if (!category) return setError("Choose a category.");
    if (!paise) return setError("Enter a monthly limit above zero, such as 6000.");
    void run(() => api.put(`/api/budgets/${category}`, { limitPaise: paise }), "Budget saved.");
  };

  return (
    <Sheet title={editing ? "Edit budget" : "Add a budget"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Category">
          <select className={inputClass} value={category} disabled={editing} onChange={(e) => setCategory(e.target.value)}>
            {!editing && <option value="">Choose…</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monthly limit (₹)" hint="Measured over your month, as set on the home page.">
          <input
            className={inputClass}
            inputMode="decimal"
            autoComplete="off"
            placeholder="6000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={busy}>
            Save
          </Button>
          {editing && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => api.del(`/api/budgets/${category}`), "Budget removed.")}
            >
              Remove
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

export function Budgets() {
  const budgets = useBudgets();
  const categories = useCategories();
  const [sheet, setSheet] = useState<{ categoryId: string; limitPaise: number | null } | null>(null);

  if (budgets.isPending || categories.isPending) return <Spinner />;
  if (budgets.isError || categories.isError) return <ErrorText>Could not load your budgets. Pull to refresh or try again.</ErrorText>;

  const { items, period, totalLimitPaise, totalSpentPaise } = budgets.data;
  const taken = new Set(items.map((i) => i.categoryId));
  const available = categories.data.filter((c) => c.kind === "expense" && !c.archived && !taken.has(c.id));
  const totalPct = totalLimitPaise > 0 ? Math.min(100, (totalSpentPaise / totalLimitPaise) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Budgets</h1>
          <p className="text-sm text-soft">
            {shortDate(period.from)} to {shortDate(period.to)}
          </p>
        </div>
        {available.length > 0 && (
          <Button onClick={() => setSheet({ categoryId: "", limitPaise: null })}>Add budget</Button>
        )}
      </div>

      {items.length === 0 ? (
        <Empty title="No budgets yet">
          Set a monthly limit for a category such as Food &amp; Dining, and Alfred will tell you how it stands.
        </Empty>
      ) : (
        <>
          <Card>
            <p className="text-sm text-soft">In total</p>
            <p className="text-2xl font-semibold">
              {rupees(totalSpentPaise)} <span className="text-base font-normal text-soft">of {rupees(totalLimitPaise)}</span>
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-brand" style={{ width: `${totalPct}%` }} />
            </div>
          </Card>
          <Card>
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <BudgetRow
                  key={item.categoryId}
                  item={item}
                  from={period.from}
                  to={period.to}
                  onEdit={() => setSheet({ categoryId: item.categoryId, limitPaise: item.limitPaise })}
                />
              ))}
            </ul>
          </Card>
        </>
      )}

      {sheet && (
        <BudgetSheet
          categoryId={sheet.categoryId}
          limitPaise={sheet.limitPaise}
          options={
            sheet.limitPaise === null
              ? available
              : categories.data.filter((c) => c.id === sheet.categoryId)
          }
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
