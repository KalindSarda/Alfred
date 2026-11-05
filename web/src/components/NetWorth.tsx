import type { BalanceOverview } from "../api";
import { rupees } from "../format";
import { Link } from "../router";
import { Card } from "./ui";

const LABEL = "Net worth";

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-soft">
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** The full breakdown, shown at the top of Accounts and cards. */
export function NetWorthCard({ overview }: { overview: BalanceOverview }) {
  return (
    <Card>
      <p className="text-xs tracking-wide text-soft uppercase">{LABEL}</p>
      <p className="font-display mt-1 text-4xl tabular-nums">{rupees(overview.netWorthPaise)}</p>
      <div className="mt-3 divide-y divide-line border-t border-brass/50 pt-2">
        <Row label="In your bank accounts" value={rupees(overview.totalInBanksPaise)} />
        {overview.setAsidePaise !== 0 && (
          <>
            <Row label="Counted as available" value={rupees(overview.countedPaise)} />
            <Row label="Set aside" value={rupees(overview.setAsidePaise)} hint="Accounts not counted toward safe-to-spend" />
          </>
        )}
        <Row label="Owed on credit cards" value={rupees(overview.cardsOwedPaise)} />
        {overview.emiToComePaise > 0 && (
          <Row label="EMIs still to be billed" value={rupees(overview.emiToComePaise)} hint="Owed, but on no statement yet; not held back from safe-to-spend" />
        )}
        {overview.owedToYouPaise > 0 && <Row label="Owed to you" value={rupees(overview.owedToYouPaise)} hint="Money you have lent; not counted toward safe-to-spend" />}
        {overview.youOwePaise > 0 && <Row label="You owe people" value={rupees(overview.youOwePaise)} hint="Money you have borrowed" />}
        {overview.investmentsPaise > 0 && <Row label="Investments" value={rupees(overview.investmentsPaise)} hint="At the values you last typed" />}
        {overview.goalsSetAsidePaise > 0 && (
          <Row label="Put toward goals" value={rupees(overview.goalsSetAsidePaise)} hint="Still yours, but not counted as spendable" />
        )}
        {overview.blockedPaise > 0 && (
          <Row label="Blocked for applications" value={rupees(overview.blockedPaise)} hint="Still yours, but not available to spend until the result" />
        )}
      </div>
      <p className="mt-3 text-xs text-faint">Bank loans will join this once they are tracked.</p>
    </Card>
  );
}

/** A slim strip for Home that links to the full breakdown. */
export function NetWorthStrip({ overview }: { overview: BalanceOverview }) {
  return (
    <Link to="/accounts" className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 hover:bg-hover">
      <span>
        <span className="block text-xs tracking-wide text-soft uppercase">{LABEL}</span>
        <span className="block text-xs text-soft">
          In banks {rupees(overview.totalInBanksPaise)}
          {overview.setAsidePaise > 0 && <> (of which {rupees(overview.setAsidePaise)} set aside)</>} · owed on cards{" "}
          {rupees(overview.cardsOwedPaise)}
          {overview.emiToComePaise > 0 && <> · {rupees(overview.emiToComePaise)} of EMIs to come</>}
          {overview.blockedPaise > 0 && <> · {rupees(overview.blockedPaise)} blocked for applications</>}
          {overview.goalsSetAsidePaise > 0 && <> · {rupees(overview.goalsSetAsidePaise)} put toward goals</>}
          {overview.investmentsPaise > 0 && <> · {rupees(overview.investmentsPaise)} invested</>}
        </span>
      </span>
      <span className="font-display text-2xl tabular-nums">{rupees(overview.netWorthPaise)}</span>
    </Link>
  );
}
