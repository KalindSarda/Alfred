import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type EmergencyFund, type MoneyHealth, type Settings, api, describeError } from "../api";
import { useToast } from "../components/toast";
import { Button, Card, Empty, ErrorText, Field, Sheet, Spinner, inputClass } from "../components/ui";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate } from "../format";
import { useEmergencyFund, useMoneyHealth } from "../queries";
import { Link } from "../router";

const BAND: Record<string, { label: string; tone: string }> = {
  strong: { label: "Strong", tone: "text-good" },
  fair: { label: "Fair", tone: "text-warn-ink" },
  low: { label: "Low", tone: "text-bad" },
  comfortable: { label: "Comfortable", tone: "text-good" },
  stretched: { label: "Stretched", tone: "text-warn-ink" },
  heavy: { label: "Heavy", tone: "text-bad" },
};

function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-sm text-soft">
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      <span className={`font-medium tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

/** Needs, wants and what was saved, as shares of income. */
function SplitBar({ h }: { h: MoneyHealth }) {
  if (h.incomePaise <= 0) return null;
  const needs = Math.min(100, h.needsPct ?? 0);
  const wants = Math.min(100 - needs, h.wantsPct ?? 0);
  const saved = Math.max(0, 100 - needs - wants);
  const seg = (pct: number, cls: string, label: string) => (pct > 0 ? <span className={`block h-full ${cls}`} style={{ width: `${pct}%` }} title={`${label} ${pct}%`} /> : null);
  return (
    <div className="mt-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-sunk" role="img" aria-label={`Needs ${h.needsPct}%, wants ${h.wantsPct}%, saved ${h.savingsRatePct}% of income`}>
        {seg(needs, "bg-brass", "Needs")}
        {seg(wants, "bg-faint", "Wants")}
        {seg(saved, "bg-good", "Saved")}
      </div>
      <p className="mt-1 flex justify-between text-xs text-soft">
        <span>Needs {h.needsPct}%</span>
        <span>Wants {h.wantsPct}%</span>
        <span>Saved {h.savingsRatePct}%</span>
      </p>
      <p className="mt-1 text-xs text-faint">A common rule of thumb is 50% needs, 30% wants and 20% saved.</p>
    </div>
  );
}

/** The months to cover, an optional target of your own, and how fast to close a gap. */
function FundSettings({ fund, onClose }: { fund: EmergencyFund; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [months, setMonths] = useState(String(fund.months));
  const [target, setTarget] = useState(fund.basis === "manual" && fund.targetPaise !== null ? paiseToInput(fund.targetPaise) : "");
  const [horizon, setHorizon] = useState(String(fund.horizonMonths));
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>("/api/settings", patch),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["emergency-fund"] });
      await client.invalidateQueries({ queryKey: ["settings"] });
      toast.show("Saved");
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = Number(months);
    const h = Number(horizon);
    if (!Number.isInteger(m) || m < 1 || m > 24) return setError("Months to cover: a whole number from 1 to 24.");
    if (!Number.isInteger(h) || h < 1 || h > 60) return setError("Months to build it in: a whole number from 1 to 60.");
    const typed = target.trim() ? rupeesToPaise(target) : null;
    if (target.trim() && !typed) return setError("The target looks wrong. Use a number such as 300000, or leave it empty.");
    setError("");
    save.mutate({ emergencyMonths: m, emergencyHorizonMonths: h, emergencyTargetPaise: typed });
  };
  return (
    <Sheet title="Emergency fund settings" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Months of essential spending to cover" hint="Six is a common rule of thumb; some people keep more when income is uneven.">
          <input className={inputClass} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
        </Field>
        <Field label="Or a target of your own (₹)" hint="Optional. When set, it replaces months times your essential spending.">
          <input className={inputClass} inputMode="decimal" placeholder="Leave empty to use the months" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label="Months to close the gap in" hint="Sets the monthly amount shown to put aside.">
          <input className={inputClass} inputMode="numeric" value={horizon} onChange={(e) => setHorizon(e.target.value)} />
        </Field>
        <ErrorText>{error || (save.isError ? describeError(save.error) : "")}</ErrorText>
        <Button type="submit" className="w-full" disabled={save.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

/** Money kept for when income stops, sized from what you must spend. */
function EmergencyCard() {
  const query = useEmergencyFund();
  const [editing, setEditing] = useState(false);
  const f = query.data;
  if (!f) return null;
  const early = f.early && f.burnPaise !== null ? ` An early estimate, from ${f.basedOnDays} days of entries.` : "";
  return (
    <Card id="emergency" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">Emergency fund</h2>
        <button type="button" className="min-h-11 text-sm text-brand" onClick={() => setEditing(true)}>
          Settings
        </button>
      </div>

      {f.nothingFlagged ? (
        <>
          <p className="text-sm text-soft">
            Nothing is marked as your emergency fund yet. Open a bank account or an investment and tick “Part of my emergency fund”, and it shows here.
          </p>
          {f.liquidMonths !== null && f.burnPaise !== null && (
            <p className="text-sm">
              Your bank money alone would cover about <span className="font-medium">{f.liquidMonths} months</span> of essentials at {rupees(f.burnPaise)} a month. A common aim is {f.months}.
              {early}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="font-display text-4xl tabular-nums">{rupees(f.fundedPaise)}</p>
          {f.targetPaise !== null ? (
            <>
              <p className="text-sm text-soft">
                of {rupees(f.targetPaise)}
                {f.basis === "manual" ? ", your own target" : `, ${f.months} months of essentials`}
                {f.fundedMonths !== null ? `. It covers about ${f.fundedMonths} months.` : "."}
                {early}
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-sunk" role="img" aria-label={`${f.progressPct}% of the target`}>
                <span className="block h-full bg-good" style={{ width: `${f.progressPct ?? 0}%` }} />
              </div>
              {f.gapPaise ? (
                <p className="text-sm">
                  Still to build: <span className="font-medium">{rupees(f.gapPaise)}</span>. About {rupees(f.topUpPaise ?? 0)} a month would close it in {f.horizonMonths} months.
                </p>
              ) : (
                <p className="text-sm text-good">The target is met.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-soft">Once there are about two weeks of entries, Alfred can size a target from what you must spend. Or set your own under Settings.</p>
          )}
          <ul className="divide-y divide-line text-sm">
            {f.accounts.map((a) => (
              <li key={a.id} className="flex justify-between py-1.5">
                <span>{a.name}</span>
                <span className="tabular-nums">{rupees(a.paise)}</span>
              </li>
            ))}
            {f.holdings.map((h) => (
              <li key={h.id} className="flex justify-between py-1.5">
                <span>{h.name}</span>
                <span className="tabular-nums">{rupees(h.paise)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-faint">Money in a flagged account is still spendable; this only says what your fund is made of. Six months is a rule of thumb, not advice.</p>
      {editing && <FundSettings fund={f} onClose={() => setEditing(false)} />}
    </Card>
  );
}

/** Where you stand: how the month looked, and the ratios behind it. */
export function Freedom() {
  const [period, setPeriod] = useState<"last" | "current">("last");
  const query = useMoneyHealth(period);
  const h = query.data;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/more" className="text-sm text-brand">
          ← Everything
        </Link>
        <h1 className="text-3xl">Freedom</h1>
        <p className="text-sm text-soft">How your money is doing. Reference lines are common rules of thumb, not advice.</p>
      </div>

      <div role="tablist" aria-label="Month" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
        {(
          [
            ["last", "Last month"],
            ["current", "This month so far"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={period === key} onClick={() => setPeriod(key)} className={`min-h-11 rounded-lg text-sm font-medium ${period === key ? "bg-card shadow-sm" : "text-soft"}`}>
            {label}
          </button>
        ))}
      </div>

      {!h && <Spinner />}
      {query.isError && <Empty title="Could not load this">Check your connection and reload.</Empty>}
      {h && h.empty && <Empty title="Nothing to show yet">No income or spending {period === "last" ? "in your last full month" : "so far this month"}. Log a few entries and this fills in.</Empty>}

      {h && !h.empty && (
        <>
          <Card>
            <p className="text-xs tracking-wide text-soft uppercase">
              {period === "last" ? "Saved last month" : "Saved so far"} · {shortDate(h.period.from)} to {shortDate(h.period.to)}
            </p>
            <p className={`font-display mt-1 text-4xl tabular-nums ${h.savingsPaise < 0 ? "text-bad" : ""}`}>{rupees(h.savingsPaise)}</p>
            <p className="mt-1 text-sm text-soft">
              {h.savingsRatePct === null ? "No income recorded, so there is no rate." : `${h.savingsRatePct}% of income`}
              {h.savingsBand && (
                <>
                  {" · "}
                  <span className={`font-medium ${BAND[h.savingsBand]?.tone}`}>{BAND[h.savingsBand]?.label}</span>
                  <span className="text-faint"> (a common aim is 20% or more)</span>
                </>
              )}
            </p>
            <SplitBar h={h} />
          </Card>

          <Card className="divide-y divide-line">
            <Row label="Income" value={rupees(h.incomePaise)} hint="Without refunds and balance corrections" />
            <Row label="Needs" value={rupees(h.needsPaise)} hint="Essential categories, card EMIs and loan interest" />
            <Row label="Wants" value={rupees(h.wantsPaise)} hint="Everything else you spent" />
            {h.investedPaise > 0 && <Row label="Put into investments" value={rupees(h.investedPaise)} hint="Part of what was saved" />}
            {h.principalRepaidPaise > 0 && <Row label="Loan principal repaid" value={rupees(h.principalRepaidPaise)} hint="Part of what was saved" />}
          </Card>

          <Card className="divide-y divide-line">
            {h.emiBurdenPct !== null && h.emiPaise > 0 && (
              <Row label="EMIs as a share of income" value={`${h.emiBurdenPct}%`} tone={h.emiBand ? BAND[h.emiBand]?.tone : undefined} hint="Under about 30% is comfortable; about 40% is the usual ceiling" />
            )}
            {h.utilizationPct !== null && <Row label="Credit cards used" value={`${h.utilizationPct}%`} hint="Of their limits, now. Under 30% is the usual aim" />}
            {h.runway.months !== null && h.runway.burnPaise !== null ? (
              <Row
                label="Emergency cover"
                value={`${h.runway.months} months`}
                hint={`Your bank money at ${rupees(h.runway.burnPaise)} a month of essentials${h.runway.solid ? "" : `. An early estimate, from ${h.runway.basedOnDays} days of entries`}`}
              />
            ) : (
              <Row label="Emergency cover" value="Not yet" hint="Needs about two weeks of entries, with some rent, bills or groceries among them" />
            )}
            {h.netWorth && <Row label="Net worth" value={rupees(h.netWorth.endPaise)} hint={`${h.netWorth.changePaise >= 0 ? "Up" : "Down"} ${rupees(Math.abs(h.netWorth.changePaise))} over the period`} />}
          </Card>
        </>
      )}

      <EmergencyCard />
    </div>
  );
}
