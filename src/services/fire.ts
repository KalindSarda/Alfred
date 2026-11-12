import { eq } from "drizzle-orm";
import { ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { firePlan } from "../db/schema";
import type { IstDate } from "../domain/dates";
import { coastNumber, fireNumber, monthsToFire, type ProjectionInput, progressPct, requiredSaving, type Sensitivity, sensitivity } from "../domain/fire";
import type { HoldingFacts } from "../domain/holdings";
import { valuePaise } from "../domain/holdings";
import type { UpdateFirePlanData } from "../schemas/fire";
import { nowIso } from "../utils/id";
import { periodFacts } from "./health";
import { loadHoldings } from "./holdings";
import { listAccountsWithFigures } from "./ledger";
import { getRunway } from "./runway";

/** Under this many days of entries, the spending and saving averages are not worked out. */
const MIN_DAYS = 14;

export interface FireView {
  assumptions: {
    ageNow: number | null;
    targetAge: number | null;
    monthlySpendPaise: number | null;
    /** True when the spend is the recent average rather than a figure the person typed. */
    spendIsDefault: boolean;
    withdrawalRateBp: number;
    inflationBp: number;
    returnBp: number;
    monthlySavingPaise: number | null;
    savingIsDefault: boolean;
    stepupBp: number;
  };
  /** The averages rest on fewer than 60 days of entries. */
  early: boolean;
  basedOnDays: number;
  corpus: {
    totalPaise: number;
    /** Bank money that counts: counted toward safe-to-spend, not part of the emergency fund, less what is blocked. */
    bankPaise: number;
    holdingsPaise: number;
    /** Every active investment, whether or not it counts, so each can be switched. */
    holdings: { id: string; name: string; kindName: string; paise: number; counts: boolean; inEmergencyFund: boolean }[];
    /** Nothing is marked as the emergency fund, so all the bank money is counted here. */
    emergencyNotMarked: boolean;
  };
  /** The corpus that covers the spending, and how far along it is. Null without a spend. */
  numberPaise: number | null;
  progressPct: number | null;
  projection: { months: number | null; years: number | null; year: number | null; age: number | null; reached: boolean } | null;
  coastPaise: number | null;
  coastReached: boolean | null;
  requiredSavingPaise: number | null;
  sensitivity: Sensitivity[];
}

export async function updateFirePlan(db: Db, userId: string, patch: UpdateFirePlanData): Promise<void> {
  const [row] = await db.select().from(firePlan).where(eq(firePlan.userId, userId)).limit(1);
  const merged = {
    ageNow: row?.ageNow ?? null,
    targetAge: row?.targetAge ?? null,
    monthlySpendPaise: row?.monthlySpendPaise ?? null,
    withdrawalRateBp: row?.withdrawalRateBp ?? 350,
    inflationBp: row?.inflationBp ?? 600,
    returnBp: row?.returnBp ?? 1000,
    monthlySavingPaise: row?.monthlySavingPaise ?? null,
    stepupBp: row?.stepupBp ?? 0,
    ...patch,
  };
  if (merged.targetAge !== null && merged.ageNow === null) {
    throw new ValidationError("Request validation failed", [{ path: "ageNow", message: "Give your age now to aim for an age" }]);
  }
  if (merged.targetAge !== null && merged.ageNow !== null && merged.targetAge <= merged.ageNow) {
    throw new ValidationError("Request validation failed", [{ path: "targetAge", message: "The age you want to be free by must be after your age now" }]);
  }
  const values = { ...merged, updatedAt: nowIso() };
  await db.insert(firePlan).values({ userId, ...values }).onConflictDoUpdate({ target: firePlan.userId, set: values });
}

/** The calendar year `months` from today. */
function yearAfter(today: IstDate, months: number): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return year + Math.floor((month + months) / 12);
}

/**
 * Where the person stands on financial independence. The corpus is every investment that counts (and is not part of the
 * emergency fund) plus bank money beyond the emergency fund. Spending and saving default to the recent average when not typed.
 */
export async function getFire(db: Db, userId: string, today: IstDate): Promise<FireView> {
  const [rows, runway, figures, loaded] = await Promise.all([db.select().from(firePlan).where(eq(firePlan.userId, userId)).limit(1), getRunway(db, userId, today), listAccountsWithFigures(db, userId, today), loadHoldings(db, userId)]);
  const plan = rows[0];

  const days = runway.basedOnDays;
  const average = days >= MIN_DAYS ? await periodFacts(db, userId, { from: runway.windowFrom, to: today }) : null;
  const scale = (paise: number) => Math.round((paise * 30) / Math.max(1, days));
  const avgSpend = average ? scale(average.needsPaise + average.wantsPaise) : null;
  const avgSaving = average ? Math.max(0, scale(average.incomePaise - average.needsPaise - average.wantsPaise)) : null;

  const monthlySpendPaise = plan?.monthlySpendPaise ?? avgSpend;
  const monthlySavingPaise = plan?.monthlySavingPaise ?? avgSaving;
  const assumptions = {
    ageNow: plan?.ageNow ?? null,
    targetAge: plan?.targetAge ?? null,
    monthlySpendPaise: monthlySpendPaise !== null && monthlySpendPaise > 0 ? monthlySpendPaise : null,
    spendIsDefault: plan?.monthlySpendPaise == null,
    withdrawalRateBp: plan?.withdrawalRateBp ?? 350,
    inflationBp: plan?.inflationBp ?? 600,
    returnBp: plan?.returnBp ?? 1000,
    monthlySavingPaise,
    savingIsDefault: plan?.monthlySavingPaise == null,
    stepupBp: plan?.stepupBp ?? 0,
  };

  const bankPaise = figures.reduce((s, a) => s + (a.kind === "bank" && a.countsTowardSafeToSpend && !a.isEmergency ? Math.max(0, a.balancePaise - a.blockedPaise) : 0), 0);
  const holdings = loaded.rows
    .filter((r) => r.status === "active")
    .map((r) => ({ id: r.id, name: r.name, kindName: loaded.kinds.get(r.kind)?.name ?? r.kind, paise: Math.max(0, valuePaise(loaded.facts.get(r.id) as HoldingFacts, today)), counts: r.countsForFire, inEmergencyFund: r.isEmergency }))
    .sort((a, b) => b.paise - a.paise);
  const holdingsPaise = holdings.filter((h) => h.counts && !h.inEmergencyFund).reduce((s, h) => s + h.paise, 0);
  const totalPaise = bankPaise + holdingsPaise;
  const emergencyNotMarked = !figures.some((a) => a.kind === "bank" && a.isEmergency) && !loaded.rows.some((r) => r.status === "active" && r.isEmergency);

  const base = { early: !runway.solid, basedOnDays: days, assumptions, corpus: { totalPaise, bankPaise, holdingsPaise, holdings, emergencyNotMarked } };
  if (assumptions.monthlySpendPaise === null) {
    return { ...base, numberPaise: null, progressPct: null, projection: null, coastPaise: null, coastReached: null, requiredSavingPaise: null, sensitivity: [] };
  }

  const input: ProjectionInput = {
    corpusPaise: totalPaise,
    monthlySavingPaise: assumptions.monthlySavingPaise ?? 0,
    stepupBp: assumptions.stepupBp,
    returnBp: assumptions.returnBp,
    inflationBp: assumptions.inflationBp,
    monthlySpendPaise: assumptions.monthlySpendPaise,
    withdrawalRateBp: assumptions.withdrawalRateBp,
  };
  const numberPaise = fireNumber(input.monthlySpendPaise, input.withdrawalRateBp);
  const months = monthsToFire(input);
  const toTarget = assumptions.targetAge !== null && assumptions.ageNow !== null ? (assumptions.targetAge - assumptions.ageNow) * 12 : null;
  const coastPaise = coastNumber(input, toTarget);
  return {
    ...base,
    numberPaise,
    progressPct: progressPct(totalPaise, numberPaise),
    projection: {
      months,
      years: months === null ? null : Math.round(months / 1.2) / 10,
      year: months === null ? null : yearAfter(today, months),
      age: months === null || assumptions.ageNow === null ? null : assumptions.ageNow + Math.floor(months / 12),
      reached: months === 0,
    },
    coastPaise,
    coastReached: coastPaise === null ? null : totalPaise >= coastPaise,
    requiredSavingPaise: requiredSaving(input, toTarget),
    sensitivity: sensitivity(input, months),
  };
}
