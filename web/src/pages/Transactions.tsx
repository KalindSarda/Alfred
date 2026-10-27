import { useEffect, useMemo, useState } from "react";
import type { Account, Category, Transaction } from "../api";
import { TxnForm } from "../components/TxnForm";
import { Button, Card, Empty, inputClass, Sheet, Spinner } from "../components/ui";
import { longDate, rupees } from "../format";
import { useAccounts, useCategories, useTransactions } from "../queries";

const TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfers" },
];

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

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
  const account = accounts.get(txn.accountId)?.name ?? "Account";
  const to = txn.toAccountId ? (accounts.get(txn.toAccountId)?.name ?? "Account") : null;
  const category = txn.categoryId ? categories.get(txn.categoryId)?.name : undefined;
  const title = txn.type === "transfer" ? `${account} → ${to}` : txn.merchant || category || "Uncategorized";
  const sub = txn.type === "transfer" ? (txn.note ?? "Transfer") : [category && txn.merchant ? category : null, account].filter(Boolean).join(" · ");
  const color =
    txn.type === "income" ? "text-emerald-600 dark:text-emerald-400" : txn.type === "expense" ? "" : "text-slate-500";
  const sign = txn.type === "income" ? "+" : txn.type === "expense" ? "−" : "";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm text-slate-500">
            {sub}
            {txn.status === "draft" && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                draft
              </span>
            )}
            {txn.source === "seed" && <span className="ml-2 text-xs text-slate-400">demo</span>}
          </span>
        </span>
        <span className={`shrink-0 font-semibold tabular-nums ${color}`}>
          {sign}
          {rupees(txn.amountPaise)}
        </span>
      </button>
    </li>
  );
}

export function Transactions() {
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [type, setType] = useState("");
  const q = useDebounced(search.trim());
  const [editing, setEditing] = useState<Transaction | null>(null);

  const accountsQuery = useAccounts(true);
  const categoriesQuery = useCategories();
  const list = useTransactions({ q, accountId, type });

  const accountMap = useMemo(() => new Map((accountsQuery.data ?? []).map((a) => [a.id, a])), [accountsQuery.data]);
  const categoryMap = useMemo(() => new Map((categoriesQuery.data ?? []).map((c) => [c.id, c])), [categoriesQuery.data]);

  const groups = useMemo(() => {
    const byDate = new Map<string, Transaction[]>();
    for (const page of list.data?.pages ?? []) {
      for (const txn of page.items) byDate.set(txn.txnDate, [...(byDate.get(txn.txnDate) ?? []), txn]);
    }
    return [...byDate.entries()];
  }, [list.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Transactions</h1>

      <div className="space-y-3">
        <input
          className={inputClass}
          type="search"
          placeholder="Search merchant or note"
          aria-label="Search transactions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <select className={`${inputClass} w-auto`} aria-label="Filter by account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {(accountsQuery.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div role="group" aria-label="Filter by type" className="flex gap-1">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={type === f.value}
                onClick={() => setType(f.value)}
                className={`min-h-11 rounded-full px-3 text-sm font-medium ${
                  type === f.value
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <Empty title="Could not load transactions">Check your connection and reload.</Empty>
      ) : groups.length === 0 ? (
        <Empty title={q || accountId || type ? "No matching transactions" : "No transactions yet"}>
          {q || accountId || type ? "Try clearing the filters." : "Tap New to add your first one."}
        </Empty>
      ) : (
        <>
          {groups.map(([date, items]) => (
            <Card key={date} className="p-0">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-500 dark:border-slate-800">
                {longDate(date)}
              </h2>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
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
    </div>
  );
}
