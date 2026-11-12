import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { botPending } from "../db/schema";
import { randomString } from "../utils/crypto";
import type { ParsedEntry } from "./parser";

export const PENDING_TTL_MS = 15 * 60 * 1000;

export interface PendingEntry {
  /** "text" entries (typed without a command) wait for a confirming tap; commands record as soon as they are complete. */
  mode: "command" | "text";
  entry: ParsedEntry;
  /** "hold": the amount is being blocked for an application (/ipo). "lent" and "borrowed": a loan (/lent, /borrowed). Never spent. */
  kind?: "hold" | "lent" | "borrowed";
  /** A loan that went through cash or is not tracked in an account. */
  cash?: boolean;
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function createPending(db: Db, userId: string, chatId: string, payload: PendingEntry, nowMs: number): Promise<string> {
  const id = randomString(10, "abcdefghijkmnpqrstuvwxyz23456789");
  await db.insert(botPending).values({
    id,
    userId,
    chatId,
    payload: JSON.stringify(payload),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
  return id;
}

/** Only the owner, in the same chat, and only while it is still fresh. */
export async function getPending(db: Db, userId: string, chatId: string, id: string, nowMs: number): Promise<PendingEntry | null> {
  const [row] = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.id, id), eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))))
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as PendingEntry & { emiFix?: unknown; loanFix?: unknown; unitsFix?: unknown; balanceFix?: unknown; balanceProposal?: unknown; statementFix?: unknown; statementProposal?: unknown; transferProposal?: unknown };
    return parsed.emiFix || parsed.loanFix || parsed.unitsFix || parsed.balanceFix || parsed.balanceProposal || parsed.statementFix || parsed.statementProposal || parsed.transferProposal ? null : parsed;
  } catch {
    return null;
  }
}

/** Waiting for the amount the statement shows for one EMI entry (the person tapped "Different amount"). */
export async function createEmiFix(db: Db, userId: string, chatId: string, txnId: string, nowMs: number): Promise<void> {
  await db.insert(botPending).values({
    id: randomString(10, "abcdefghijkmnpqrstuvwxyz23456789"),
    userId,
    chatId,
    payload: JSON.stringify({ emiFix: { txnId } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
}

/** Waiting for the amount the bank took for one loan instalment (the person tapped "Different amount"). */
export async function createLoanFix(db: Db, userId: string, chatId: string, loanId: string, on: string, nowMs: number): Promise<void> {
  await db.insert(botPending).values({
    id: randomString(10, "abcdefghijkmnpqrstuvwxyz23456789"),
    userId,
    chatId,
    payload: JSON.stringify({ loanFix: { loanId, on } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
}

/** Waiting for the quantity a purchase into a holding bought (the person tapped "Tell me"). */
export async function createUnitsFix(db: Db, userId: string, chatId: string, txnId: string, nowMs: number): Promise<void> {
  await db.insert(botPending).values({
    id: randomString(10, "abcdefghijkmnpqrstuvwxyz23456789"),
    userId,
    chatId,
    payload: JSON.stringify({ unitsFix: { txnId } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
}

/** Waiting for the balance the bank shows for one account (the person tapped "Different" on the weekly check). */
export async function createBalanceFix(db: Db, userId: string, chatId: string, accountId: string, nowMs: number): Promise<void> {
  await db.insert(botPending).values({
    id: randomString(10, "abcdefghijkmnpqrstuvwxyz23456789"),
    userId,
    chatId,
    payload: JSON.stringify({ balanceFix: { accountId } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
}

/** A typed bank balance waiting for the person to say what to do about the gap. Returns the id the buttons carry. */
export async function createBalanceProposal(db: Db, userId: string, chatId: string, accountId: string, typedPaise: number, nowMs: number): Promise<string> {
  const id = randomString(10, "abcdefghijkmnpqrstuvwxyz23456789");
  await db.insert(botPending).values({
    id,
    userId,
    chatId,
    payload: JSON.stringify({ balanceProposal: { accountId, typedPaise } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
  return id;
}

/** Only the owner, in the same chat, and only while it is fresh. */
export async function getBalanceProposal(db: Db, userId: string, chatId: string, id: string, nowMs: number): Promise<{ accountId: string; typedPaise: number } | null> {
  const [row] = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.id, id), eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))))
    .limit(1);
  if (!row) return null;
  try {
    const p = (JSON.parse(row.payload) as { balanceProposal?: { accountId?: unknown; typedPaise?: unknown } }).balanceProposal;
    return typeof p?.accountId === "string" && typeof p.typedPaise === "number" ? { accountId: p.accountId, typedPaise: p.typedPaise } : null;
  } catch {
    return null;
  }
}

/** A suggested move into the emergency fund, waiting for the person to say they have made it. Returns the id the buttons carry. */
export async function createTransferProposal(db: Db, userId: string, chatId: string, fromId: string, toId: string, amountPaise: number, nowMs: number): Promise<string> {
  const id = randomString(10, "abcdefghijkmnpqrstuvwxyz23456789");
  await db.insert(botPending).values({
    id,
    userId,
    chatId,
    payload: JSON.stringify({ transferProposal: { fromId, toId, amountPaise } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
  return id;
}

/** Only the owner, in the same chat, and only while it is fresh. */
export async function getTransferProposal(db: Db, userId: string, chatId: string, id: string, nowMs: number): Promise<{ fromId: string; toId: string; amountPaise: number } | null> {
  const [row] = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.id, id), eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))))
    .limit(1);
  if (!row) return null;
  try {
    const p = (JSON.parse(row.payload) as { transferProposal?: { fromId?: unknown; toId?: unknown; amountPaise?: unknown } }).transferProposal;
    return typeof p?.fromId === "string" && typeof p.toId === "string" && typeof p.amountPaise === "number" ? { fromId: p.fromId, toId: p.toId, amountPaise: p.amountPaise } : null;
  } catch {
    return null;
  }
}

/** Waiting for the total the statement shows (the person tapped "Different" on a statement question). */
export async function createStatementFix(db: Db, userId: string, chatId: string, cardId: string, statementDate: string, nowMs: number): Promise<void> {
  await db.insert(botPending).values({
    id: randomString(10, "abcdefghijkmnpqrstuvwxyz23456789"),
    userId,
    chatId,
    payload: JSON.stringify({ statementFix: { cardId, statementDate } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
}

/** A typed statement total waiting for the person to say what to do about the gap. Returns the id the buttons carry. */
export async function createStatementProposal(db: Db, userId: string, chatId: string, cardId: string, billedPaise: number, nowMs: number): Promise<string> {
  const id = randomString(10, "abcdefghijkmnpqrstuvwxyz23456789");
  await db.insert(botPending).values({
    id,
    userId,
    chatId,
    payload: JSON.stringify({ statementProposal: { cardId, billedPaise } }),
    expiresAt: iso(nowMs + PENDING_TTL_MS),
    createdAt: iso(nowMs),
  });
  return id;
}

/** Only the owner, in the same chat, and only while it is fresh. */
export async function getStatementProposal(db: Db, userId: string, chatId: string, id: string, nowMs: number): Promise<{ cardId: string; billedPaise: number } | null> {
  const [row] = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.id, id), eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))))
    .limit(1);
  if (!row) return null;
  try {
    const p = (JSON.parse(row.payload) as { statementProposal?: { cardId?: unknown; billedPaise?: unknown } }).statementProposal;
    return typeof p?.cardId === "string" && typeof p.billedPaise === "number" ? { cardId: p.cardId, billedPaise: p.billedPaise } : null;
  } catch {
    return null;
  }
}

/** What a number typed next is for: an EMI entry's amount, a loan instalment's amount, or a purchase's quantity. */
export type AmountFix = { kind: "emi"; txnId: string } | { kind: "loan"; loanId: string; on: string } | { kind: "units"; txnId: string } | { kind: "balance"; accountId: string } | { kind: "statement"; cardId: string; statementDate: string };

/** The latest fresh amount-wait for this person and chat, removed so it is used once; null when there is none. */
export async function takeAmountFix(db: Db, userId: string, chatId: string, nowMs: number): Promise<AmountFix | null> {
  const rows = await db
    .select()
    .from(botPending)
    .where(and(eq(botPending.userId, userId), eq(botPending.chatId, chatId), gt(botPending.expiresAt, iso(nowMs))));
  let found: { id: string; fix: AmountFix; createdAt: string } | null = null;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as { emiFix?: { txnId?: unknown }; loanFix?: { loanId?: unknown; on?: unknown }; unitsFix?: { txnId?: unknown }; balanceFix?: { accountId?: unknown }; statementFix?: { cardId?: unknown; statementDate?: unknown } };
      let fix: AmountFix | null = null;
      if (typeof parsed.emiFix?.txnId === "string") fix = { kind: "emi", txnId: parsed.emiFix.txnId };
      else if (typeof parsed.loanFix?.loanId === "string" && typeof parsed.loanFix.on === "string") fix = { kind: "loan", loanId: parsed.loanFix.loanId, on: parsed.loanFix.on };
      else if (typeof parsed.unitsFix?.txnId === "string") fix = { kind: "units", txnId: parsed.unitsFix.txnId };
      else if (typeof parsed.balanceFix?.accountId === "string") fix = { kind: "balance", accountId: parsed.balanceFix.accountId };
      else if (typeof parsed.statementFix?.cardId === "string" && typeof parsed.statementFix.statementDate === "string") fix = { kind: "statement", cardId: parsed.statementFix.cardId, statementDate: parsed.statementFix.statementDate };
      if (fix && (!found || row.createdAt > found.createdAt)) found = { id: row.id, fix, createdAt: row.createdAt };
    } catch {
      // Not ours; ignore.
    }
  }
  if (!found) return null;
  await db.delete(botPending).where(eq(botPending.id, found.id));
  return found.fix;
}

export async function updatePending(db: Db, id: string, payload: PendingEntry): Promise<void> {
  await db.update(botPending).set({ payload: JSON.stringify(payload) }).where(eq(botPending.id, id));
}

export async function deletePending(db: Db, id: string): Promise<void> {
  await db.delete(botPending).where(eq(botPending.id, id));
}

export async function purgeExpiredPending(db: Db, nowMs: number): Promise<void> {
  await db.delete(botPending).where(lt(botPending.expiresAt, iso(nowMs)));
}
