import type { Db } from "../db/client";
import type { IstDate } from "../domain/dates";
import { buildLadder, type Ladder, type StepKey } from "../domain/ladder";
import { getEmergencyFund } from "./emergency";
import { getFire } from "./fire";
import { listLoans } from "./loans";
import { getProtection } from "./protection";
import { getRunway } from "./runway";
import { getSettings } from "./settings";

export interface LadderView extends Ladder {
  /** The yearly rate, in basis points, from which a bank loan counts as costly debt, and the steps the person skips. */
  costlyDebtBp: number;
  skipped: StepKey[];
}

/**
 * Where the person stands on the usual order of firming up money: a starter buffer, costly debt, health and life cover,
 * the emergency fund (living costs, then medical), then investing for independence. Reads figures the rest of Alfred already
 * works out; a step the person skips is passed over.
 */
export async function getLadder(db: Db, userId: string, today: IstDate): Promise<LadderView> {
  const [settings, runway, loans, protection, fund, fire] = await Promise.all([getSettings(db, userId), getRunway(db, userId, today), listLoans(db, userId, "active"), getProtection(db, userId, today), getEmergencyFund(db, userId, today), getFire(db, userId, today)]);
  const skipped = settings.ladderSkipped as StepKey[];
  const costlyLoans = loans.loans
    .filter((l) => l.outstandingPaise > 0 && Math.round(l.ratePct * 100) >= settings.costlyDebtBp)
    .sort((a, b) => b.ratePct - a.ratePct)
    .map((l) => ({ name: l.name, ratePct: l.ratePct, outstandingPaise: l.outstandingPaise }));

  const ladder = buildLadder({
    essentialsBurnPaise: runway.burnPaise,
    liquidPaise: runway.liquidPaise,
    costlyLoans,
    costlyDebtBp: settings.costlyDebtBp,
    protectionGaps: protection.gaps.filter((g) => g.severity === "high").map((g) => g.title),
    living: fund.living ? { gapPaise: fund.living.gapPaise } : null,
    medical: fund.medical ? { gapPaise: fund.medical.gapPaise } : null,
    nothingFlagged: fund.nothingFlagged,
    firePct: fire.progressPct,
    skipped,
  });
  return { ...ladder, costlyDebtBp: settings.costlyDebtBp, skipped };
}
