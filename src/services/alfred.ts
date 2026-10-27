import { and, eq, isNull } from "drizzle-orm";
import {
  type Briefing,
  BRIEFING_FOOTER,
  buildBriefingLines,
  emptyBriefingLines,
  greeting,
  subline,
} from "../alfred/voice";
import type { Db } from "../db/client";
import { accounts } from "../db/schema";
import { type IstDate, parseIstDate } from "../domain/dates";
import { getMe } from "./auth";
import { getSummary } from "./dashboard";
import { listAccountsWithFigures } from "./ledger";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7 Nov" from an IST date. */
function shortDate(date: IstDate): string {
  const { month, day } = parseIstDate(date);
  return `${day} ${MONTHS[month - 1]}`;
}

/**
 * Alfred's briefing for the Home screen. Facts come from the ledger; the wording comes from his voice module.
 * The response shape is what an AI-written briefing will return later, with `source` switching to "ai".
 */
export async function getBriefing(db: Db, userId: string, today: IstDate, now: Date): Promise<Briefing> {
  const [me, [anyAccount]] = await Promise.all([
    getMe(db, userId),
    db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt))).limit(1),
  ]);

  const base = { greeting: greeting(me.displayName, now), subline: subline(now), source: "template" as const, generatedAt: now.toISOString(), footer: BRIEFING_FOOTER };
  if (!anyAccount) return { ...base, lines: emptyBriefingLines() };

  const [summary, figures] = await Promise.all([getSummary(db, userId, "30d", today), listAccountsWithFigures(db, userId, today)]);
  const cards = figures.flatMap((a) =>
    a.kind === "card"
      ? [{ name: a.name, nextDueDate: a.summary.nextDueDate, statementOutstandingPaise: a.summary.statementOutstandingPaise }]
      : [],
  );

  const lines = buildBriefingLines(
    {
      today,
      periodKey: summary.period.key,
      safeToSpendPaise: summary.safeToSpendPaise,
      expensePaise: summary.expensePaise,
      previousExpensePaise: summary.previousExpensePaise,
      uncategorizedCount: summary.uncategorizedCount,
      draftCount: summary.draftCount,
      cards,
    },
    shortDate,
  );
  return { ...base, lines };
}
