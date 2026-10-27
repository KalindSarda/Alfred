import { useEffect, useMemo, useState } from "react";
import type { Account, Category, Transaction } from "../api";
import { FilterSheet } from "../components/FilterSheet";
import { TxnForm } from "../components/TxnForm";
import { Button, Card, Empty, inputClass, Sheet, Spinner } from "../components/ui";
import { activeFilterCount, activePreset, emptyFilters, filtersFromSearch, filtersToSearch, PRESETS, type TxnFilters } from "../filters";
import { longDate, rupees, shortDate } from "../format";
import { useAccounts, useCategories, useTransactions } from "../queries";
import { Link, replaceSearch, useSearch } from "../router";
import { amountSign, amountTone, describeTxn, needsCategory } from "../txn";

const TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
  { value: "bill_payment", label: "Bill payments" },
] as const;

function Row({
  txn,
  accounts,
  categories,
  onOpen,
}: {
  txn: Transaction;
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  onOpen: () => void;
}) {
  const { title, sub } = describeTxn(txn, accounts, categories);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-hover"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm text-soft">
            {sub}
            {needsCategory(txn) && <span className="ml-2 rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-ink">no category</span>}
            {txn.status === "draft" && <span className="ml-2 rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-ink">draft</span>}
            {txn.source === "seed" && <span className="ml-2 text-xs text-faint">demo</span>}
          </span>
        </span>
        <span className={`shrink-0 font-semibold tabular-nums ${amountTone(txn.type)}`}>
          {amountSign(txn.type)}
          {rupees(txn.amountPaise)}
        </span>
      </button>
    </li>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-sunk py-1 pr-1 pl-3 text-sm">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="flex size-7 items-center justify-center rounded-full text-soft hover:bg-hover">
        ✕
      </button>
    </span>
  );
}

export function Transactions() {
  const search = useSearch();
  const filters = useMemo(() => filtersFromSearch(search), [search]);
  const setFilters = (next: TxnFilters) => replaceSearch(filtersToSearch(next));

  // The search box types freely and updates the address a moment after you stop.
  const [text, setText] = useState(filters.q);
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text.trim() === filters.q) return;
    const id = window.setTimeout(() => setFilters({ ...filters, q: text.trim() }), 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [filtering, setFiltering] = useState(false);

  const accountsQuery = useAccounts(true);
  const categoriesQuery = useCategories();
  const list = useTransactions(filters);

  const accountMap = useMemo(() => new Map((accountsQuery.data ?? []).map((a) => [a.id, a])), [accountsQuery.data]);
  const categoryMap = useMemo(() => new Map((categoriesQuery.data ?? []).map((c) => [c.id, c])), [categoriesQuery.data]);

  const groups = useMemo(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const page of list.data?.pages ?? []) {
      for (const txn of page.items) byDate.set(txn.txnDate, [...(byDate.get(txn.txnDate) ?? []), txn]);
    }
    return [...byDate.entries()];
  }, [list.data]);

  const totals = list.data?.pages[0]?.totals;
  const count = activeFilterCount(filters);
  const anyFilter = count > 0 || filters.q !== "" || filters.type !== "";

  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.from || filters.to) {
    const preset = activePreset(filters);
    const label = preset ? (PRESETS.find((p) => p.key === preset)?.label ?? "") : `${filters.from ? shortDate(filters.from) : "…"} – ${filters.to ? shortDate(filters.to) : "…"}`;
    chips.push({ key: "period", label, remove: () => setFilters({ ...filters, from: "", to: "" }) });
  }
  if (filters.account) chips.push({ key: "account", label: accountMap.get(filters.account)?.name ?? "Account", remove: () => setFilters({ ...filters, account: "" }) });
  for (const id of filters.categories) {
    const label = id === "none" ? "Uncategorized" : (categoryMap.get(id)?.name ?? "Category");
    chips.push({ key: `cat-${id}`, label, remove: () => setFilters({ ...filters, categories: filters.categories.filter((c) => c !== id) }) });
  }
  if (filters.min || filters.max) {
    const label = filters.min && filters.max ? `₹${filters.min} – ₹${filters.max}` : filters.min ? `At least ₹${filters.min}` : `At most ₹${filters.max}`;
    chips.push({ key: "amount", label, remove: () => setFilters({ ...filters, min: "", max: "" }) });
  }
  if (filters.status) chips.push({ key: "status", label: filters.status === "draft" ? "Drafts only" : "Confirmed only", remove: () => setFilters({ ...filters, status: "" }) });

  const reviewing = filters.categories.length === 1 && filters.categories[0] === "none" ? "category" : filters.status === "draft" ? "confirmation" : null;

  return (
    <div className="space-y-4">
      <h1 className="text-3xl">Transactions</h1>

      <div className="space-y-3">
        <input
          className={inputClass}
          type="search"
          placeholder="Search merchant, note, category or account"
          aria-label="Search transactions"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="secondary" className="shrink-0" aria-haspopup="dialog" onClick={() => setFiltering(true)}>
            Filters{count > 0 ? ` (${count})` : ""}
          </Button>
          <div role="group" aria-label="Filter by type" className="flex gap-1 overflow-x-auto pb-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filters.type === f.value}
                onClick={() => setFilters({ ...filters, type: f.value })}
                className={`min-h-11 shrink-0 rounded-full px-3 text-sm font-medium ${filters.type === f.value ? "bg-brand text-white" : "bg-sunk text-soft"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={c.remove} />
            ))}
            <button type="button" className="min-h-9 px-2 text-sm text-brand hover:underline" onClick={() => setFilters({ ...emptyFilters, q: filters.q })}>
              Clear all
            </button>
          </div>
        )}
      </div>

      {reviewing && (
        <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          {reviewing === "category" ? "These entries need a category. Open one to choose it." : "These entries are drafts waiting for your confirmation. Open one to review it."}{" "}
          <Link to="/transactions" className="font-medium underline">
            Show everything
          </Link>
        </p>
      )}

      {totals && !list.isPending && (
        <p className="text-sm text-soft" aria-live="polite">
          {totals.count} {totals.count === 1 ? "entry" : "entries"}
          {totals.expensePaise > 0 && <> · spent {rupees(totals.expensePaise)}</>}
          {totals.incomePaise > 0 && <> · received {rupees(totals.incomePaise)}</>}
        </p>
      )}

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Empty title="Could not load transactions">Check your connection and reload.</Empty>
      ) : groups.length === 0 ? (
        <Empty title={anyFilter ? "No matching transactions" : "No transactions yet"}>
          {anyFilter ? "Try loosening the filters." : "Tap New to add your first one."}
        </Empty>
      ) : (
        <>
          {groups.map(([date, items]) => (
            <Card key={date} pad="p-0">
              <h2 className="border-b border-line px-4 py-2 text-sm font-medium text-soft">{longDate(date)}</h2>
              <ul className="divide-y divide-line">
                {items.map((txn) => (
                  <Row key={txn.id} txn={txn} accounts={accountMap} categories={categoryMap} onOpen={() => setEditing(txn)} />
                ))}
              </ul>
            </Card>
          ))}
          {list.hasNextPage && (
            <Button variant="secondary" className="w-full" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}

      {editing && (
        <Sheet title="Edit transaction" onClose={() => setEditing(null)}>
          <TxnForm initial={editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}

      {filtering && (
        <FilterSheet
          filters={filters}
          accounts={accountsQuery.data ?? []}
          categories={categoriesQuery.data ?? []}
          onChange={setFilters}
          onClose={() => setFiltering(false)}
        />
      )}
    </div>
  );
}
