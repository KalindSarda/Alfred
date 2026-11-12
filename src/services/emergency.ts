import type { IstDate } from "../domain/dates";
import type { Db } from "../db/client";
import { type EmergencyFund, emergencyFund } from "../domain/emergency";
import { valuePaise } from "../domain/holdings";
import type { HoldingFacts } from "../domain/holdings";
import { listAccountsWithFigures } from "./ledger";
import { loadHoldings } from "./holdings";
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

/**
 * Where the emergency fund stands. The fund is the bank accounts and holdings the person flagged: a bank counts at its
 * balance less what is blocked, a holding at its worth now. Safe-to-spend does not change; a flagged account is still money in the bank.
 */
export async function getEmergencyFund(db: Db, userId: string, today: IstDate): Promise<EmergencyView> {
  const [settings, runway, figures, loaded] = await Promise.all([getSettings(db, userId), getRunway(db, userId, today), listAccountsWithFigures(db, userId, today), loadHoldings(db, userId)]);

  const accounts = figures
    .filter((a) => a.kind === "bank" && a.isEmergency)
    .map((a) => ({ id: a.id, name: a.name, paise: a.kind === "bank" ? Math.max(0, a.balancePaise - a.blockedPaise) : 0 }));
  const holdings = loaded.rows
    .filter((r) => r.status === "active" && r.isEmergency)
    .map((r) => ({ id: r.id, name: r.name, paise: Math.max(0, valuePaise(loaded.facts.get(r.id) as HoldingFacts, today)) }));

  const fund = emergencyFund({
    months: settings.emergencyMonths,
    manualTargetPaise: settings.emergencyTargetPaise,
    horizonMonths: settings.emergencyHorizonMonths,
    burnPaise: runway.burnPaise,
    bankPaise: accounts.reduce((s, a) => s + a.paise, 0),
    holdingsPaise: holdings.reduce((s, h) => s + h.paise, 0),
    flagged: accounts.length + holdings.length,
    liquidPaise: runway.liquidPaise,
  });
  return { ...fund, early: !runway.solid, basedOnDays: runway.basedOnDays, accounts, holdings };
}
