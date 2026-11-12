import { clampDay, type IstDate, parseIstDate, shiftMonth } from "./dates";

/**
 * Protection: health and life cover. Pure rules that look at the policies a person has recorded and two answers (does
 * anyone depend on your income, do you have health cover through work) and say where there is no cover. The reference
 * figures are common rules of thumb, shown as such. Nothing here names a product or an insurer, or says what to buy.
 */

export type PolicyKind = "health" | "term" | "other";
export type PolicySource = "personal" | "employer";
export type Frequency = "yearly" | "half_yearly" | "quarterly" | "monthly";
export type Answer = "yes" | "no" | "partly" | "unknown";

/** A commonly quoted base health cover. */
export const HEALTH_BASE_PAISE = 5_00_000_00;
/** A commonly quoted term cover: 10 to 15 times yearly income. The lower end is the line. */
export const TERM_MULTIPLE = 10;
export const TERM_MULTIPLE_HIGH = 15;
/** Renewal reminders go out this many days before. */
export const RENEWAL_LEAD_DAYS = 7;

export interface PolicyFacts {
  kind: PolicyKind;
  source: PolicySource;
  coverPaise: number;
  status: "active" | "lapsed";
}

export interface ProfileFacts {
  dependants: Answer;
  employerHealth: "yes" | "no" | "unknown";
}

export interface Gap {
  key: "health_missing" | "health_low" | "term_missing" | "term_low" | "questions";
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
}

export const MONTHS_PER: Record<Frequency, number> = { yearly: 12, half_yearly: 6, quarterly: 3, monthly: 1 };

/** The renewal date moved forward by `n` premium periods, keeping the original day of the month (short months use their last day). */
function stepped(renewalDate: IstDate, frequency: Frequency, n: number): IstDate {
  const { year, month, day } = parseIstDate(renewalDate);
  const moved = shiftMonth(year, month, n * MONTHS_PER[frequency]);
  return clampDay(moved.year, moved.month, day);
}

/** The first premium or renewal date on or after `today`, stepping the recorded date forward by the premium frequency. */
export function nextDue(renewalDate: IstDate, frequency: Frequency, today: IstDate): IstDate {
  if (renewalDate >= today) return renewalDate;
  for (let n = 1; n <= 1200; n += 1) {
    const date = stepped(renewalDate, frequency, n);
    if (date >= today) return date;
  }
  return today;
}

/** Every premium or renewal date from `from` up to, not including, `until`. */
export function dueDatesBetween(renewalDate: IstDate, frequency: Frequency, from: IstDate, until: IstDate): IstDate[] {
  const out: IstDate[] = [];
  for (let n = 0; n <= 1200; n += 1) {
    const date = n === 0 ? renewalDate : stepped(renewalDate, frequency, n);
    if (date >= until) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** Where there is no cover, in order of how much it matters. Each cover is judged on active policies only. */
export function protectionGaps(policies: readonly PolicyFacts[], profile: ProfileFacts, annualIncomePaise: number | null): Gap[] {
  const active = policies.filter((p) => p.status === "active");
  const personalHealth = active.filter((p) => p.kind === "health" && p.source === "personal").reduce((s, p) => s + p.coverPaise, 0);
  const hasPersonalHealth = active.some((p) => p.kind === "health" && p.source === "personal");
  const term = active.filter((p) => p.kind === "term").reduce((s, p) => s + p.coverPaise, 0);
  const hasTerm = active.some((p) => p.kind === "term");
  const gaps: Gap[] = [];

  if (!hasPersonalHealth) {
    gaps.push({
      key: "health_missing",
      severity: "high",
      title: "No personal health cover recorded",
      detail:
        profile.employerHealth === "yes"
          ? "Cover through work usually ends with the job, which is just when a layoff and a hospital bill could meet. A policy of your own keeps you covered either way. Waiting periods start on the day you buy."
          : "A hospital stay without cover would come out of your savings. Waiting periods start on the day you buy, and premiums rise with age.",
    });
  } else if (personalHealth < HEALTH_BASE_PAISE) {
    gaps.push({ key: "health_low", severity: "medium", title: "Health cover looks small", detail: "A commonly quoted base cover is ₹5 to 10 lakh. This is a rule of thumb; what suits you is for you and a licensed advisor." });
  }

  if (profile.dependants === "yes" || profile.dependants === "partly") {
    if (!hasTerm) {
      gaps.push({
        key: "term_missing",
        severity: profile.dependants === "yes" ? "high" : "medium",
        title: "No term life cover recorded",
        detail: "Someone depends on your income. Term cover is what would replace it, and what would keep loans from falling on them.",
      });
    } else if (annualIncomePaise !== null && annualIncomePaise > 0 && term < annualIncomePaise * TERM_MULTIPLE) {
      gaps.push({ key: "term_low", severity: "medium", title: "Term cover looks small against your income", detail: `A commonly quoted range is ${TERM_MULTIPLE} to ${TERM_MULTIPLE_HIGH} times yearly income. This is a rule of thumb, not advice.` });
    }
  }

  if (profile.dependants === "unknown" || profile.employerHealth === "unknown") {
    gaps.push({ key: "questions", severity: "info", title: "Two questions are still open", detail: "Whether anyone depends on your income, and whether you have health cover through work. The answers decide which gaps matter." });
  }
  return gaps;
}
