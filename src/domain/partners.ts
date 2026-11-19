import { type HoldingFacts, investedPaise, soldPaise, valuePaise } from "./holdings";
import type { IstDate } from "./dates";

/** One thing a partner did on a shared investment: put money in, or was paid back. */
export interface StakeEntry {
  date: IstDate;
  kind: "in" | "out";
  amountPaise: number;
}

/** What one other person has in one holding. */
export interface Stake {
  contactId: string;
  name: string;
  entries: readonly StakeEntry[];
}

export interface PartnerSplit {
  contactId: string;
  name: string;
  putInPaise: number;
  paidOutPaise: number;
  /** Their share of the holding, one decimal (40 is 40%). */
  sharePct: number;
  /** Their share of what it is worth now. */
  valuePaise: number;
  /** Their share of what was already sold. */
  soldPaise: number;
  /** What they would be owed if everything were sold at today's value, before what was already paid out. */
  entitlementPaise: number;
  gainPaise: number;
  /** Entitlement less what was paid out: what you would still pay them. */
  owedPaise: number;
}

export interface Split {
  shared: boolean;
  /** What the shares are measured against: what was put in, or the partners' money when that is more (before it is invested). */
  basisPaise: number;
  myPutInPaise: number;
  mySharePct: number;
  myValuePaise: number;
  mySoldPaise: number;
  myGainPaise: number;
  partners: PartnerSplit[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const upTo = (entries: readonly StakeEntry[], kind: "in" | "out", asOf?: IstDate) => entries.filter((e) => e.kind === kind && (asOf === undefined || e.date <= asOf)).reduce((s, e) => s + e.amountPaise, 0);

/**
 * Splits a holding between you and the people who put money in with you, in proportion to the money each put in. What you put in
 * is what is left of the total put in once their money is taken out of it. Their shares of the worth and of what was sold are
 * rounded down, and you take the remainder, so the pieces always add back to the whole.
 */
export function splitHolding(f: HoldingFacts, stakes: readonly Stake[], asOf?: IstDate): Split {
  const invested = investedPaise(f, asOf);
  const worth = valuePaise(f, asOf);
  const sold = soldPaise(f, asOf);
  const put = stakes.map((s) => ({ stake: s, putIn: upTo(s.entries, "in", asOf) })).filter((p) => p.putIn > 0);
  const total = put.reduce((s, p) => s + p.putIn, 0);
  const whole = { basisPaise: invested, myPutInPaise: invested, mySharePct: 100, myValuePaise: worth, mySoldPaise: sold, myGainPaise: worth + sold - invested };
  if (total <= 0) return { shared: false, ...whole, partners: [] };

  const basis = Math.max(invested, total);
  const partners: PartnerSplit[] = put.map(({ stake, putIn }) => {
    const ratio = putIn / basis;
    const value = Math.floor(worth * ratio);
    const soldShare = Math.floor(sold * ratio);
    const entitlement = value + soldShare;
    const paidOut = upTo(stake.entries, "out", asOf);
    return { contactId: stake.contactId, name: stake.name, putInPaise: putIn, paidOutPaise: paidOut, sharePct: round1(ratio * 100), valuePaise: value, soldPaise: soldShare, entitlementPaise: entitlement, gainPaise: entitlement - putIn, owedPaise: entitlement - paidOut };
  });
  const myPutIn = basis - total;
  const myValue = worth - partners.reduce((s, p) => s + p.valuePaise, 0);
  const mySold = sold - partners.reduce((s, p) => s + p.soldPaise, 0);
  return {
    shared: true,
    basisPaise: basis,
    myPutInPaise: myPutIn,
    mySharePct: round1((myPutIn / basis) * 100),
    myValuePaise: myValue,
    mySoldPaise: mySold,
    myGainPaise: myValue + mySold - myPutIn,
    partners: partners.sort((a, b) => b.putInPaise - a.putInPaise || a.name.localeCompare(b.name)),
  };
}
