import type { BalanceOverview } from "../api";
import { FEATURES } from "../features";
import { rupees } from "../format";
import { useGoals, useHoldings } from "../queries";
import { Link } from "../router";
import { rememberFeature } from "./JumpSearch";

const to = (id: string) => FEATURES.find((f) => f.id === id)?.to ?? "/";

function Tile({ id, title, status, quiet }: { id: string; title: string; status: string; quiet?: boolean }) {
  return (
    <Link
      to={to(id)}
      onClick={() => rememberFeature(id)}
      className="flex min-h-16 flex-col justify-center rounded-2xl border border-line bg-card px-3 py-2 hover:bg-hover"
    >
      <span className="text-sm font-medium">{title}</span>
      <span className={`text-xs ${quiet ? "text-faint" : "text-soft"} tabular-nums`}>{status}</span>
    </Link>
  );
}

/** Quick doors to the things that live a few taps down, each saying how things stand right now. */
export function Shortcuts({ overview }: { overview: BalanceOverview }) {
  const goals = useGoals("active").data;
  const held = useHoldings("active").data;
  const count = goals?.goals.length ?? 0;
  const owed = overview.owedToYouPaise;
  const owe = overview.youOwePaise;

  return (
    <section aria-label="Shortcuts" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <Tile
        id="lent"
        title="Lent and borrowed"
        status={owed > 0 || owe > 0 ? [owed > 0 ? `${rupees(owed)} owed to you` : "", owe > 0 ? `you owe ${rupees(owe)}` : ""].filter(Boolean).join(" · ") : "Nobody owes anyone"}
        quiet={owed === 0 && owe === 0}
      />
      <Tile id="emi" title="EMI plans" status={overview.emiToComePaise > 0 ? `${rupees(overview.emiToComePaise)} still to come` : "No plans running"} quiet={overview.emiToComePaise === 0} />
      <Tile id="blocked" title="Blocked for IPOs" status={overview.blockedPaise > 0 ? `${rupees(overview.blockedPaise)} blocked` : "Nothing blocked"} quiet={overview.blockedPaise === 0} />
      <Tile
        id="goals"
        title="Savings goals"
        status={count > 0 ? `${rupees(overview.goalsSetAsidePaise)} put toward ${count} ${count === 1 ? "goal" : "goals"}` : "Save for something"}
        quiet={count === 0}
      />
      <Tile
        id="investments"
        title="Investments"
        status={held && held.holdings.length > 0 ? `${rupees(held.totalValuePaise)} · ${held.gainPaise >= 0 ? "up" : "down"} ${rupees(Math.abs(held.gainPaise))}` : "Track what you own"}
        quiet={!held || held.holdings.length === 0}
      />
      <Tile id="budgets" title="Budgets" status="Monthly limits" />
      <Tile id="recurring" title="Recurring" status="Rent, subscriptions, salary" />
    </section>
  );
}
