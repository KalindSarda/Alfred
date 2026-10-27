import { useState } from "react";
import type { Account, CardAccount } from "../api";
import { AccountForm } from "../components/AccountForm";
import { Button, Card, Empty, Sheet, Spinner } from "../components/ui";
import { rupees, shortDate } from "../format";
import { NetWorthCard } from "../components/NetWorth";
import { useAccounts, useBalanceOverview } from "../queries";

function CardRow({ card, onOpen }: { card: CardAccount; onOpen: () => void }) {
  const pct = Math.min(100, Math.max(0, card.utilizationPct));
  const bar = pct >= 80 ? "bg-bad" : pct >= 50 ? "bg-brass" : "bg-good";
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full space-y-3 px-4 py-4 text-left hover:bg-hover">
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            {card.name}
            {card.last4 && <span className="ml-2 text-sm text-soft">•••• {card.last4}</span>}
          </span>
          <span className="text-lg font-semibold tabular-nums">{rupees(card.outstandingPaise)}</span>
        </span>
        <span className="block">
          <span className="block h-2 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="mt-1 flex justify-between text-xs text-soft">
            <span>
              {card.utilizationPct}% of {rupees(card.creditLimitPaise)}
            </span>
            <span>Unbilled {rupees(card.unbilledPaise)}</span>
          </span>
        </span>
        <span className="flex justify-between text-sm text-soft">
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
  const overview = useBalanceOverview();
  const [editing, setEditing] = useState<Account | "new" | null>(null);

  const banks = (accounts.data ?? []).filter((a) => a.kind === "bank");
  const cards = (accounts.data ?? []).filter((a): a is CardAccount => a.kind === "card");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Accounts and cards</h1>
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
          {overview.data && <NetWorthCard overview={overview.data} />}
          {banks.length > 0 && (
            <Card pad="p-0">
              <h2 className="border-b border-line px-4 py-2 text-sm font-medium text-soft">Bank accounts</h2>
              <ul className="divide-y divide-line">
                {banks.map((b) =>
                  b.kind === "bank" ? (
                    <li key={b.id}>
                      <button type="button" onClick={() => setEditing(b)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {b.name}
                            {b.archived && <span className="ml-2 text-xs text-faint">archived</span>}
                          </span>
                          {!b.countsTowardSafeToSpend && <span className="text-xs text-soft">Not counted in safe-to-spend</span>}
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
            <Card pad="p-0">
              <h2 className="border-b border-line px-4 py-2 text-sm font-medium text-soft">Credit cards</h2>
              <ul className="divide-y divide-line">
                {cards.map((c) => (
                  <CardRow key={c.id} card={c} onOpen={() => setEditing(c)} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <label className="flex min-h-11 items-center gap-3 text-sm text-soft">
        <input type="checkbox" className="size-5 accent-brand" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
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
