import { useState } from "react";
import { type AccountsView, accountsPath, searchForView, viewFromSearch } from "../accountsView";
import type { Account, BankAccount, CardAccount } from "../api";
import { AccountForm } from "../components/AccountForm";
import { BalanceCheckSheet } from "../components/BalanceCheck";
import { BlockedFunds } from "../components/BlockedFunds";
import { NetWorthTrend } from "../components/NetWorthTrend";
import { EmiPlans } from "../components/EmiPlans";
import { Investments } from "../components/Investments";
import { LentBorrowed } from "../components/LentBorrowed";
import { Loans } from "../components/Loans";
import { Button, Card, Empty, Sheet, Spinner } from "../components/ui";
import { rupees, shortDate } from "../format";
import { NetWorthCard } from "../components/NetWorth";
import { useAccounts, useBalanceOverview } from "../queries";
import { Link, replaceSearch, useSearch } from "../router";

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
          <span className="mt-1 flex justify-between text-xs text-soft">
            <span>Available credit {rupees(card.availableCreditPaise)}</span>
            {card.emiToComePaise > 0 && <span>{rupees(card.emiToComePaise)} in EMIs to come</span>}
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

const VIEWS: { value: AccountsView; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "commitments", label: "Commitments" },
  { value: "investments", label: "Investments" },
];

export function Accounts() {
  const view = viewFromSearch(useSearch());
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);
  const overview = useBalanceOverview();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [checking, setChecking] = useState(false);

  const banks = (accounts.data ?? []).filter((a) => a.kind === "bank");
  const cards = (accounts.data ?? []).filter((a): a is CardAccount => a.kind === "card");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Accounts and commitments</h1>
        {view === "accounts" && <Button onClick={() => setEditing("new")}>Add</Button>}
      </div>

      <div role="tablist" aria-label="View" className="grid grid-cols-3 gap-1 rounded-xl bg-sunk p-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => replaceSearch(searchForView(v.value))}
            className={`min-h-11 rounded-lg text-sm font-medium ${view === v.value ? "bg-card shadow-sm" : "text-soft"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {accounts.isPending ? (
        <Spinner />
      ) : accounts.isError ? (
        <Empty title="Could not load accounts">Check your connection and reload.</Empty>
      ) : (accounts.data ?? []).length === 0 ? (
        <Empty title="No accounts yet">
          Add a bank account or credit card to start, or load demo data from Everything, then Settings.
        </Empty>
      ) : (
        view === "investments" ? (
          <Investments />
        ) : view === "commitments" ? (
          <>
            {overview.data && (overview.data.blockedPaise > 0 || overview.data.emiToComePaise > 0) && (
              <p className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-soft">
                Money that is spoken for:{" "}
                {overview.data.blockedPaise > 0 && <strong className="text-ink">{rupees(overview.data.blockedPaise)} blocked for applications</strong>}
                {overview.data.blockedPaise > 0 && overview.data.emiToComePaise > 0 && " and "}
                {overview.data.emiToComePaise > 0 && <strong className="text-ink">{rupees(overview.data.emiToComePaise)} of card EMIs still to be billed</strong>}.
              </p>
            )}
            <BlockedFunds />
            <EmiPlans />
            <Loans />
            <LentBorrowed />
          </>
        ) : (
        <>
          {overview.data && <NetWorthCard overview={overview.data} />}
          <NetWorthTrend />
          {overview.data && (overview.data.blockedPaise > 0 || overview.data.emiToComePaise > 0 || overview.data.owedToYouPaise > 0 || overview.data.youOwePaise > 0) && (
            <Link to={accountsPath("commitments")} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm hover:bg-hover">
              <span className="text-soft">
                {overview.data.blockedPaise > 0 && <>{rupees(overview.data.blockedPaise)} blocked</>}
                {overview.data.blockedPaise > 0 && overview.data.emiToComePaise > 0 && " · "}
                {overview.data.emiToComePaise > 0 && <>{rupees(overview.data.emiToComePaise)} of EMIs to come</>}
                {(overview.data.blockedPaise > 0 || overview.data.emiToComePaise > 0) && (overview.data.owedToYouPaise > 0 || overview.data.youOwePaise > 0) && " · "}
                {overview.data.owedToYouPaise > 0 && <>{rupees(overview.data.owedToYouPaise)} owed to you</>}
                {overview.data.owedToYouPaise > 0 && overview.data.youOwePaise > 0 && " · "}
                {overview.data.youOwePaise > 0 && <>you owe {rupees(overview.data.youOwePaise)}</>}
              </span>
              <span className="font-medium text-brand">Commitments →</span>
            </Link>
          )}
          {banks.length > 0 && (
            <Card pad="p-0">
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-1">
                <h2 className="text-sm font-medium text-soft">Bank accounts</h2>
                <button type="button" onClick={() => setChecking(true)} className="min-h-11 text-sm font-medium text-brand hover:underline">
                  Check balance
                </button>
              </div>
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
                          {!b.countsTowardSafeToSpend && <span className="block text-xs text-soft">Not counted in safe-to-spend</span>}
                        </span>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums">{rupees(b.balancePaise)}</span>
                          {b.blockedPaise > 0 && <span className="block text-xs text-soft">{rupees(b.blockedPaise)} blocked, {rupees(b.availablePaise)} available</span>}
                        </span>
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
        )
      )}

      {view === "accounts" && (
        <label className="flex min-h-11 items-center gap-3 text-sm text-soft">
          <input type="checkbox" className="size-5 accent-brand" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived accounts
        </label>
      )}

      {checking && <BalanceCheckSheet banks={banks.filter((b): b is BankAccount => b.kind === "bank" && !b.archived)} onClose={() => setChecking(false)} />}

      {editing && (
        <Sheet title={editing === "new" ? "Add account" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <AccountForm {...(editing === "new" ? {} : { initial: editing })} onDone={() => setEditing(null)} />
        </Sheet>
      )}
    </div>
  );
}
