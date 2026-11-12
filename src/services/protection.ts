import { and, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { insurancePolicies, protectionProfile } from "../db/schema";
import { daysBetween as dayDiff } from "../alfred/voice";
import { isValidIstDate, type IstDate } from "../domain/dates";
import { type Answer, dueDatesBetween, type Frequency, type Gap, nextDue, type PolicyKind, type PolicySource, protectionGaps } from "../domain/protection";
import type { CreatePolicyData, UpdatePolicyData, UpdateProfileData } from "../schemas/insurance";
import { newId, nowIso } from "../utils/id";
import { periodFacts } from "./health";
import { getRunway } from "./runway";

export interface PolicyDto {
  id: string;
  kind: PolicyKind;
  source: PolicySource;
  insurer: string;
  coverPaise: number;
  premiumPaise: number;
  frequency: Frequency;
  renewalDate: IstDate;
  /** The next premium or renewal date on or after today, and how many days away it is. */
  nextDueDate: IstDate;
  daysToDue: number;
  note: string | null;
  status: "active" | "lapsed";
}

export interface ProtectionView {
  profile: { dependants: Answer; employerHealth: "yes" | "no" | "unknown" };
  policies: PolicyDto[];
  gaps: Gap[];
  /** Premiums a year across active personal policies. */
  yearlyPremiumPaise: number;
}

const FACTOR: Record<Frequency, number> = { yearly: 1, half_yearly: 2, quarterly: 4, monthly: 12 };
const invalid = (path: string, message: string) => new ValidationError("Request validation failed", [{ path, message }]);
type Row = typeof insurancePolicies.$inferSelect;

function toDto(row: Row, today: IstDate): PolicyDto {
  const next = nextDue(row.renewalDate, row.frequency, today);
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    insurer: row.insurer,
    coverPaise: row.coverPaise,
    premiumPaise: row.premiumPaise,
    frequency: row.frequency,
    renewalDate: row.renewalDate,
    nextDueDate: next,
    daysToDue: dayDiff(today, next),
    note: row.note,
    status: row.status,
  };
}

export async function listPolicies(db: Db, userId: string, today: IstDate): Promise<PolicyDto[]> {
  const rows = await db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId));
  return rows.map((r) => toDto(r, today)).sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || a.nextDueDate.localeCompare(b.nextDueDate) || a.insurer.localeCompare(b.insurer));
}

async function getProfile(db: Db, userId: string): Promise<ProtectionView["profile"]> {
  const [row] = await db.select().from(protectionProfile).where(eq(protectionProfile.userId, userId)).limit(1);
  return { dependants: row?.dependants ?? "unknown", employerHealth: row?.employerHealth ?? "unknown" };
}

export async function updateProfile(db: Db, userId: string, patch: UpdateProfileData): Promise<void> {
  const merged = { ...(await getProfile(db, userId)), ...patch };
  const values = { ...merged, updatedAt: nowIso() };
  await db.insert(protectionProfile).values({ userId, ...values }).onConflictDoUpdate({ target: protectionProfile.userId, set: values });
}

/** Where the cover stands: the answers, the policies and the gaps. Income for the term comparison is the recent rate, from 30 days of entries. */
export async function getProtection(db: Db, userId: string, today: IstDate): Promise<ProtectionView> {
  const [profile, policies, runway] = await Promise.all([getProfile(db, userId), listPolicies(db, userId, today), getRunway(db, userId, today)]);
  let annualIncomePaise: number | null = null;
  if (runway.basedOnDays >= 30) {
    const facts = await periodFacts(db, userId, { from: runway.windowFrom, to: today });
    annualIncomePaise = Math.round((facts.incomePaise * 365) / runway.basedOnDays);
  }
  return {
    profile,
    policies,
    gaps: protectionGaps(policies, profile, annualIncomePaise),
    yearlyPremiumPaise: policies.filter((p) => p.status === "active" && p.source === "personal").reduce((s, p) => s + p.premiumPaise * FACTOR[p.frequency], 0),
  };
}

function checkDate(date: string) {
  if (!isValidIstDate(date)) throw invalid("renewalDate", "Not a real calendar date");
}

export async function createPolicy(db: Db, userId: string, input: CreatePolicyData, today: IstDate): Promise<PolicyDto> {
  checkDate(input.renewalDate);
  const source = input.source ?? "personal";
  const row = {
    id: newId(),
    userId,
    kind: input.kind,
    source,
    insurer: input.insurer,
    coverPaise: input.coverPaise,
    // Cover through work has no premium of yours to plan for.
    premiumPaise: source === "employer" ? 0 : (input.premiumPaise ?? 0),
    frequency: input.frequency ?? ("yearly" as const),
    renewalDate: input.renewalDate,
    note: input.note ?? null,
    status: "active" as const,
    createdAt: nowIso(),
  };
  await db.insert(insurancePolicies).values(row);
  return toDto(row, today);
}

async function requirePolicy(db: Db, userId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(insurancePolicies).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId))).limit(1);
  if (!row) throw new NotFoundError("Policy not found");
  return row;
}

export async function updatePolicy(db: Db, userId: string, id: string, patch: UpdatePolicyData, today: IstDate): Promise<PolicyDto> {
  const row = await requirePolicy(db, userId, id);
  if (patch.renewalDate !== undefined) checkDate(patch.renewalDate);
  const source = patch.source ?? row.source;
  const next = {
    kind: patch.kind ?? row.kind,
    source,
    insurer: patch.insurer ?? row.insurer,
    coverPaise: patch.coverPaise ?? row.coverPaise,
    premiumPaise: source === "employer" ? 0 : (patch.premiumPaise ?? row.premiumPaise),
    frequency: patch.frequency ?? row.frequency,
    renewalDate: patch.renewalDate ?? row.renewalDate,
    note: patch.note === undefined ? row.note : patch.note,
    status: patch.status ?? row.status,
  };
  await db.update(insurancePolicies).set(next).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)));
  return toDto({ ...row, ...next }, today);
}

export async function deletePolicy(db: Db, userId: string, id: string): Promise<void> {
  await requirePolicy(db, userId, id);
  await db.delete(insurancePolicies).where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)));
}

/** Premiums due from `from` up to, not including, `to`, for active personal policies: what the commitments timeline lists. */
export async function premiumsDue(db: Db, userId: string, from: IstDate, to: IstDate): Promise<{ id: string; insurer: string; kind: PolicyKind; date: IstDate; amountPaise: number }[]> {
  const rows = await db.select().from(insurancePolicies).where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, "active"), eq(insurancePolicies.source, "personal")));
  return rows.filter((r) => r.premiumPaise > 0).flatMap((r) => dueDatesBetween(r.renewalDate, r.frequency, from, to).map((date) => ({ id: r.id, insurer: r.insurer, kind: r.kind, date, amountPaise: r.premiumPaise })));
}
