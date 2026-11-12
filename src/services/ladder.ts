import type { Db } from "../db/client";
import type { IstDate } from "../domain/dates";
import { buildFoundations, type Foundations, type FoundationFacts, monthlyEquivalent } from "../domain/ladder";
import { getEmergencyFund } from "./emergency";
import { getFire } from "./fire";
import { listLoans } from "./loans";
import { getProtection } from "./protection";
import { listRules } from "./recurring";
import { getRunway } from "./runway";
import { getSettings } from "./settings";

/** What runs alongside, in a month: so the percentages can be seen as parallel work, not a queue. */
export interface Flows {
  /** Repeating investments (SIPs) a month. */
  investingPaise: number;
  /** Insurance premiums on the person's own policies, a month. */
  premiumsPaise: number;
  /** What is left over in a typical and in a lean month after spending and investing, which is what builds the emergency fund; null without enough history. */
  leftOverPaise: number | null;
  leftOverLeanPaise: number | null;
  /** The left-over figure rests on fewer than three complete months. */
  early: boolean;
}

export interface LadderView extends Foundations {
  /** The yearly rate, in basis points, from which a bank loan counts as costly debt. */
  costlyDebtBp: number;
  flows: Flows;
}

/**
 * Where the person stands on the usual foundations, each with its ideal and how far along they are: a starter buffer, costly
 * debt, health and life cover, the emergency fund against lifestyle and against essentials, the medical layer, and independence.
 * They run in parallel, so there is no order to follow; one row at a time is tagged as needing attention, by rule. Reads figures
 * the rest of Alfred already works out.
 */
export async function getLadder(db: Db, userId: string, today: IstDate): Promise<LadderView> {
  const [settings, runway, loans, protection, fund, fire, rules] = await Promise.all([getSettings(db, userId), getRunway(db, userId, today), listLoans(db, userId, "active"), getProtection(db, userId, today), getEmergencyFund(db, userId, today), getFire(db, userId, today), listRules(db, userId, today)]);

  const costlyLoans = loans.loans
    .filter((l) => l.outstandingPaise > 0 && Math.round(l.ratePct * 100) >= settings.costlyDebtBp)
    .sort((a, b) => b.ratePct - a.ratePct)
    .map((l) => ({ name: l.name, ratePct: l.ratePct, outstandingPaise: l.outstandingPaise }));

  // Covers the situation calls for: personal health always, term life when someone depends on the income.
  const needed = 1 + (protection.profile.dependants === "yes" || protection.profile.dependants === "partly" ? 1 : 0);
  const missingGaps = protection.gaps.filter((g) => g.key === "health_missing" || g.key === "term_missing");

  const facts: FoundationFacts = {
    essentialsBurnPaise: runway.burnPaise,
    liquidPaise: runway.liquidPaise,
    costlyLoans,
    costlyDebtBp: settings.costlyDebtBp,
    cover: { needed, inPlace: Math.max(0, needed - missingGaps.length), missing: missingGaps.map((g) => g.title), urgent: missingGaps.some((g) => g.severity === "high") },
    fund: {
      nothingFlagged: fund.nothingFlagged,
      fundedPaise: fund.fundedPaise,
      lifestyle: { pct: fund.targets.lifestyle.pct, gapPaise: fund.targets.lifestyle.gapPaise, monthsAtTypical: fund.targets.lifestyle.monthsAtTypical },
      essentials: { pct: fund.targets.essentials.pct, gapPaise: fund.targets.essentials.gapPaise, monthsAtTypical: fund.targets.essentials.monthsAtTypical },
      medical: fund.medical ? { fundedPaise: fund.medical.fundedPaise, targetPaise: fund.medical.targetPaise } : null,
    },
    firePct: fire.progressPct,
  };

  const flows: Flows = {
    investingPaise: rules.filter((r) => r.status === "active" && r.type === "investment").reduce((s, r) => s + monthlyEquivalent(r.amountPaise, r.frequency), 0),
    premiumsPaise: Math.round(protection.yearlyPremiumPaise / 12),
    leftOverPaise: fund.pace ? fund.pace.typicalPaise : null,
    leftOverLeanPaise: fund.pace ? fund.pace.cautiousPaise : null,
    early: fund.pace ? fund.pace.early : false,
  };
  return { ...buildFoundations(facts), costlyDebtBp: settings.costlyDebtBp, flows };
}
