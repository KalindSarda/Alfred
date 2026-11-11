import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { listAccounts } from "../db/accounts";
import { toShape } from "../db/emi";
import { accounts, debtPayments, debts, emiPlans } from "../db/schema";
import { loadLedgerTxns } from "../db/transactions";
import { bankBalance, cardOwed } from "../domain/balances";
import { type IstDate, toIstDate } from "../domain/dates";
import { emiToCome, instalmentSchedule } from "../domain/emi";
import { type DebtFact, debtOutstandingAsOf, type MonthPoint, monthPoints, type NetWorthPoint, netWorthOf, trimLeading } from "../domain/networth";
import { valuePaise } from "../domain/holdings";
import { loadHoldings } from "./holdings";
import { loanFacts } from "./loans";
import { toLedgerAccount } from "./ledger";

export interface NetWorthTrend {
  points: NetWorthPoint[];
}

/**
 * Net worth at the end of each of the last `months` months, rebuilt from the entries on the books: balances and card
 * owing from the ledger as of each date, EMI instalments not yet billed then, and loans outstanding then. Nothing is
 * stored. Months before the first entry are left out, and the latest point is today, so it equals the headline figure.
 */
export async function getNetWorthTrend(db: Db, userId: string, today: IstDate, months: number): Promise<NetWorthTrend> {
  const { points, firstDate } = await computePoints(db, userId, monthPoints(today, months));
  return { points: trimLeading(points, firstDate) };
}

/** Net worth as of each of the given days, with the day of the person's earliest entry (null when there is none). */
export async function getNetWorthAt(db: Db, userId: string, days: IstDate[]): Promise<{ values: Map<IstDate, number>; firstDate: IstDate | null }> {
  const { points, firstDate } = await computePoints(db, userId, days.map((asOf) => ({ month: asOf.slice(0, 7), asOf })));
  return { values: new Map(points.map((p) => [p.asOf, p.netWorthPaise])), firstDate };
}

async function computePoints(db: Db, userId: string, pointsFor: MonthPoint[]): Promise<{ points: NetWorthPoint[]; firstDate: IstDate | null }> {
  const [accountRows, txns, planRows, debtRows, paymentRows, held, loanList] = await Promise.all([
    listAccounts(db, userId),
    loadLedgerTxns(db, userId),
    db
      .select({ plan: emiPlans, statementDay: accounts.statementDay, dueDay: accounts.dueDay, archivedAt: accounts.archivedAt })
      .from(emiPlans)
      .innerJoin(accounts, eq(accounts.id, emiPlans.cardAccountId))
      .where(and(eq(emiPlans.userId, userId), isNull(accounts.archivedAt))),
    db.select().from(debts).where(eq(debts.userId, userId)),
    db.select().from(debtPayments).where(eq(debtPayments.userId, userId)),
    loadHoldings(db, userId),
    loanFacts(db, userId),
  ]);

  const ledger = accountRows.map(toLedgerAccount);
  const paymentsBy = new Map<string, { amountPaise: number; date: IstDate }[]>();
  for (const p of paymentRows) paymentsBy.set(p.debtId, [...(paymentsBy.get(p.debtId) ?? []), { amountPaise: p.amountPaise, date: p.date }]);
  const facts: DebtFact[] = debtRows.map((d) => ({
    direction: d.direction,
    amountPaise: d.amountPaise,
    date: d.date,
    writtenOffOn: d.forgiven && d.settledAt ? toIstDate(new Date(d.settledAt)) : null,
    payments: paymentsBy.get(d.id) ?? [],
  }));
  const plans = planRows.map(({ plan, statementDay, dueDay }) => ({
    shape: toShape(plan),
    card: { statementDay: statementDay ?? 1, dueDay: dueDay ?? 1 },
    cancelledOn: plan.cancelledAt ? toIstDate(new Date(plan.cancelledAt)) : null,
  }));

  const points = pointsFor.map((p): NetWorthPoint => {
    let banksPaise = 0;
    let cardsOwedPaise = 0;
    for (const a of ledger) {
      if (a.kind === "bank") banksPaise += bankBalance(a, txns, p.asOf);
      else cardsOwedPaise += cardOwed(a, txns, p.asOf);
    }
    let emiToComePaise = 0;
    for (const { shape, card, cancelledOn } of plans) {
      // Part of the debt only from its first instalment, and until it was closed early.
      const first = instalmentSchedule({ ...shape, cancelled: false }, card)[0];
      if (!first || first.date > p.asOf) continue;
      emiToComePaise += emiToCome({ ...shape, cancelled: cancelledOn !== null && cancelledOn <= p.asOf }, card, p.asOf);
    }
    let owedToYouPaise = 0;
    let youOwePaise = 0;
    for (const d of facts) {
      const left = debtOutstandingAsOf(d, p.asOf);
      if (d.direction === "lent") owedToYouPaise += left;
      else youOwePaise += left;
    }
    let investmentsPaise = 0;
    for (const f of held.facts.values()) investmentsPaise += valuePaise(f, p.asOf);
    let loansPaise = 0;
    for (const l of loanList) loansPaise += Math.max(0, l.principalPaise - l.payments.filter((x) => x.date <= p.asOf).reduce((sum, x) => sum + x.amountPaise, 0));
    const parts = { banksPaise, cardsOwedPaise, emiToComePaise, owedToYouPaise, youOwePaise, investmentsPaise, loansPaise };
    return { ...p, ...parts, netWorthPaise: netWorthOf(parts) };
  });

  const dates = [...txns.map((t) => t.txnDate), ...debtRows.map((d) => d.date)].sort();
  return { points, firstDate: dates[0] ?? null };
}
