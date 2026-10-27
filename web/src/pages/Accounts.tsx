import { useState } from "react";
import type { Account, CardAccount } from "../api";
import { AccountForm } from "../components/AccountForm";
import { Button, Card, Empty, Sheet, Spinner } from "../components/ui";
import { rupees, shortDate } from "../format";
import { useAccounts } from "../queries";

function CardRow({ card, onOpen }: { card: CardAccount; onOpen: () => void }) {
  const pct = Math.min(100, Math.max(0, card.utilizationPct));
  const bar = pct >= 80 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full space-y-3 px-4 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            {card.name}
            {card.last4 && <span className="ml-2 text-sm text-slate-500">•••• {card.last4}</span>}
          </span>
          <span className="text-lg font-semibold tabular-nums">{rupees(card.outstandingPaise)}</span>
        </span>
        <span className="block">
          <span className="block h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden="true">
            <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="mt-1 flex justify-between text-xs text-slate-500">
            <span>
              {card.utilizationPct}% of {rupees(card.creditLimitPaise)}
            </span>
            <span>Unbilled {rupees(card.unbilledPaise)}</span>
          </span>
        </span>
        <span className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
          <span>
            Statement due: <strong>{rupees(card.statementOutstandingPaise)}</strong>
          </span>
          <span>Due {shortDate(card.nextDueDate)}</span>
        </span>
      </button>
    </li>
  );
}

export function Accounts() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);
  const [editing, setEditing] = useState<Account | "new" | null>(null);

  const banks = (accounts.data ?? []).filter((a) => a.kind === "bank");
  const cards = (accounts.data ?? []).filter((a): a is CardAccount => a.kind === "card");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts and cards</h1>
        <Button onClick={() => setEditing("new")}>Add</Button>
      </div>

      {accounts.isPending ? (
        <Spinner />
      ) : accounts.isError ? (
        <Empty title="Could not load accounts">Check your connection and reload.</Empty>
      ) : (accounts.data ?? []).length === 0 ? (
        <Empty title="No accounts yet">
          Add a bank account or credit card to start, or load demo data from More.
        </Empty>
      ) : (
        <>
          {banks.length > 0 && (
            <Card className="p-0">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-500 dark:border-slate-800">Bank accounts</h2>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {banks.map((b) =>
                  b.kind === "bank" ? (
                    <li key={b.id}>
                      <button type="button" onClick={() => setEditing(b)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {b.name}
                            {b.archived && <span className="ml-2 text-xs text-slate-400">archived</span>}
                          </span>
                          {!b.countsTowardSafeToSpend && <span className="text-xs text-slate-500">Not counted in safe-to-spend</span>}
                        </span>
                        <span className="font-semibold tabular-nums">{rupees(b.balancePaise)}</span>
                      </button>
                    </li>
                  ) : null,
                )}
              </ul>
            </Card>
          )}

          {cards.length > 0 && (
            <Card className="p-0">
              <h2 className="border-b border-slate-100 px-4 py-2 text-sm font-medium text-slate-500 dark:border-slate-800">Credit cards</h2>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {cards.map((c) => (
                  <CardRow key={c.id} card={c} onOpen={() => setEditing(c)} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <label className="flex min-h-11 items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
        <input type="checkbox" className="size-5 accent-emerald-600" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived accounts
      </label>

      {editing && (
        <Sheet title={editing === "new" ? "Add account" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <AccountForm {...(editing === "new" ? {} : { initial: editing })} onDone={() => setEditing(null)} />
        </Sheet>
      )}
    </div>
  );
}
