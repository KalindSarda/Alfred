import { and, eq, isNull, min } from "drizzle-orm";
import type { Db } from "../db/client";
import { transactions } from "../db/schema";
import { addDays, cycleRange, type IstDate } from "../domain/dates";
import { type EmergencyFund, emergencyFund } from "../domain/emergency";
import type { HoldingFacts } from "../domain/holdings";
import { valuePaise } from "../domain/holdings";
import { type CycleFacts, MAX_CYCLES, type Pace, paceFromCycles, paceFromWindow } from "../domain/pace";
import type { PeriodFacts } from "../domain/health";
import { healthRange, periodFacts } from "./health";
import { loadHoldings } from "./holdings";
import { listAccountsWithFigures } from "./ledger";
import { getRunway } from "./runway";
import { getSettings } from "./settings";

export interface EmergencyView extends EmergencyFund {
  /** True when the burn rests on fewer than 60 days of entries. */
  early: boolean;
  basedOnDays: number;
  /** What the fund is made of, for showing it. */
  accounts: { id: string; name: string; paise: number }[];
  holdings: { id: string; name: string; paise: number }[];
}

const cycleOf = (f: PeriodFacts): CycleFacts => ({ incomePaise: f.incomePaise, spentPaise: f.needsPaise + f.wantsPaise, investedPaise: f.investedPaise, principalRepaidPaise: f.principalRepaidPaise });

/**
 * What is left over in a month, from the person's own recent months: the last three complete ones (a month that began before
 * their first entry is not complete, and a month with nothing in it says nothing). With none yet, the recent window scaled to a
 * month, which is only an estimate.
 */
export async function getPace(db: Db, userId: string, today: IstDate, periodStartDay: number, window: { from: IstDate; days: number }): Promise<Pace | null> {
  const [first] = await db.select({ day: min(transactions.txnDate) }).from(transactions).where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), eq(transactions.status, "confirmed")));
  const firstDay = first?.day ?? null;
  if (firstDay === null) return null;

  const ranges = [healthRange(today, periodStartDay, "last")];
  while (ranges.length < MAX_CYCLES) ranges.push(cycleRange(addDays((ranges.at(-1) as { from: IstDate }).from, -1), periodStartDay));
  const complete = ranges.filter((r) => firstDay <= r.from);
  const cycles = (await Promise.all(complete.map((r) => periodFacts(db, userId, r)))).map(cycleOf).filter((c) => c.incomePaise > 0 || c.spentPaise > 0);
  const fromCycles = paceFromCycles(cycles);
  if (fromCycles) return fromCycles;
  if (window.days < 14) return null;
  return paceFromWindow(cycleOf(await periodFacts(db, userId, { from: window.from, to: today })), window.days);
}

/**
 * Where the emergency fund stands. The fund is the bank accounts and holdings the person flagged: a bank counts at its
 * balance less what is blocked, a holding at its worth now. It is judged against the lifestyle they live now and against
 * essentials only, both with the medical amount on top, and how long closing each gap takes at their usual pace. Safe-to-spend does
 * not change; a flagged account is still money in the bank.
 */
export async function getEmergencyFund(db: Db, userId: string, today: IstDate): Promise<EmergencyView> {
  const [settings, runway, figures, loaded] = await Promise.all([getSettings(db, userId), getRunway(db, userId, today), listAccountsWithFigures(db, userId, today), loadHoldings(db, userId)]);

  const accounts = figures
    .filter((a) => a.kind === "bank" && a.isEmergency)
    .map((a) => ({ id: a.id, name: a.name, paise: a.kind === "bank" ? Math.max(0, a.balancePaise - a.blockedPaise) : 0 }));
  const holdings = loaded.rows
    .filter((r) => r.status === "active" && r.isEmergency)
    .map((r) => ({ id: r.id, name: r.name, paise: Math.max(0, valuePaise(loaded.facts.get(r.id) as HoldingFacts, today)) }));

  // What is spent in all, as a month at the recent rate; needs the same 14 days of history as the essentials figure.
  const days = runway.basedOnDays;
  const spent = days >= 14 ? await periodFacts(db, userId, { from: runway.windowFrom, to: today }) : null;
  const lifestyleBurnPaise = spent ? Math.round(((spent.needsPaise + spent.wantsPaise) * 30) / Math.max(1, days)) : null;
  const pace = await getPace(db, userId, today, settings.periodStartDay, { from: runway.windowFrom, days });

  const fund = emergencyFund({
    months: settings.emergencyMonths,
    manualTargetPaise: settings.emergencyTargetPaise,
    medicalTargetPaise: settings.medicalTargetPaise,
    horizonMonths: settings.emergencyHorizonMonths,
    essentialsBurnPaise: runway.burnPaise,
    lifestyleBurnPaise: lifestyleBurnPaise !== null && lifestyleBurnPaise > 0 ? lifestyleBurnPaise : null,
    bankPaise: accounts.reduce((s, a) => s + a.paise, 0),
    holdingsPaise: holdings.reduce((s, h) => s + h.paise, 0),
    flagged: accounts.length + holdings.length,
    liquidPaise: runway.liquidPaise,
    pace,
  });
  return { ...fund, early: !runway.solid, basedOnDays: runway.basedOnDays, accounts, holdings };
}
