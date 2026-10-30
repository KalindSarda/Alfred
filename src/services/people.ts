import { and, desc, eq, isNull } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../config/errors";
import type { Db } from "../db/client";
import { seedDefaultCategories } from "../db/seed";
import {
  accounts,
  appSettings,
  botPending,
  budgets,
  categories,
  idempotencyKeys,
  invites,
  loginCodes,
  merchantAliases,
  nudgeLog,
  sessions,
  telegramLinkCodes,
  telegramLinks,
  transactions,
  users,
} from "../db/schema";
import { newId } from "../utils/id";
import { nameFromEmail } from "./settings";

export type InviteRow = typeof invites.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export const normalizeInviteEmail = (email: string) => email.trim().toLowerCase();

export async function getUserRow(db: Db, userId: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row;
}

export async function assertOwner(db: Db, userId: string): Promise<void> {
  const user = await getUserRow(db, userId);
  if (!user?.isOwner) throw new ForbiddenError("Only the owner can do that");
}

export async function findPendingInvite(db: Db, email: string): Promise<InviteRow | undefined> {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.email, normalizeInviteEmail(email)), isNull(invites.acceptedAt)))
    .limit(1);
  return row;
}

/**
 * Turns an invite into an account: the user, their settings and the default categories. Safe to repeat, so an
 * attempt that failed half way is completed by the next one.
 */
export async function acceptInvite(db: Db, invite: InviteRow, nowIso: string): Promise<UserRow> {
  await db.insert(users).values({ id: newId(), email: invite.email, createdAt: nowIso }).onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.email, invite.email)).limit(1);
  if (!user) throw new Error("User insert returned no row");
  await db.insert(appSettings).values({ userId: user.id, displayName: invite.name }).onConflictDoNothing();
  await seedDefaultCategories(db, user.id);
  await db.update(invites).set({ acceptedAt: nowIso }).where(eq(invites.id, invite.id));
  return user;
}

export interface InviteDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

/** Creates the invite, or refreshes a pending one so the email can be sent again. */
export async function createInvite(db: Db, ownerId: string, rawEmail: string, nowIso: string, name?: string): Promise<InviteDto> {
  const email = normalizeInviteEmail(rawEmail);
  const [member] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (member) throw new ConflictError("That person already has an account here");

  const [existing] = await db.select().from(invites).where(eq(invites.email, email)).limit(1);
  if (existing) {
    // A used invite whose account no longer exists (deleted) is opened again; a pending one is simply sent again.
    const keep = name ?? existing.name;
    await db.update(invites).set({ acceptedAt: null, createdAt: nowIso, invitedBy: ownerId, name: keep }).where(eq(invites.id, existing.id));
    return { id: existing.id, email, name: keep, createdAt: nowIso };
  }
  const id = newId();
  await db.insert(invites).values({ id, email, name: name ?? null, invitedBy: ownerId, createdAt: nowIso });
  return { id, email, name: name ?? null, createdAt: nowIso };
}

export async function withdrawInvite(db: Db, inviteId: string): Promise<void> {
  const removed = await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });
  if (removed.length === 0) throw new NotFoundError("No pending invitation found");
}

export interface MemberDto {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
  disabled: boolean;
  createdAt: string;
}

export interface PeopleDto {
  members: MemberDto[];
  invites: InviteDto[];
}

export async function listPeople(db: Db): Promise<PeopleDto> {
  const [memberRows, inviteRows] = await Promise.all([
    db
      .select({ user: users, displayName: appSettings.displayName })
      .from(users)
      .leftJoin(appSettings, eq(appSettings.userId, users.id))
      .orderBy(desc(users.isOwner), users.createdAt),
    db.select().from(invites).where(isNull(invites.acceptedAt)).orderBy(desc(invites.createdAt)),
  ]);
  return {
    members: memberRows.map(({ user, displayName }) => ({
      id: user.id,
      email: user.email,
      name: displayName ?? nameFromEmail(user.email),
      isOwner: user.isOwner,
      disabled: user.disabledAt !== null,
      createdAt: user.createdAt,
    })),
    invites: inviteRows.map((i) => ({ id: i.id, email: i.email, name: i.name, createdAt: i.createdAt })),
  };
}

async function memberFor(db: Db, ownerId: string, targetId: string): Promise<UserRow> {
  const target = await getUserRow(db, targetId);
  if (!target) throw new NotFoundError("Person not found");
  if (target.id === ownerId || target.isOwner) throw new ConflictError("The owner cannot be removed");
  return target;
}

/** Cuts off sign-in and every open session at once. Their records are kept, and access can be restored. */
export async function disableMember(db: Db, ownerId: string, targetId: string, nowIso: string): Promise<void> {
  await memberFor(db, ownerId, targetId);
  await db.batch([
    db.update(users).set({ disabledAt: nowIso }).where(eq(users.id, targetId)),
    db.delete(sessions).where(eq(sessions.userId, targetId)),
    db.delete(loginCodes).where(eq(loginCodes.userId, targetId)),
  ]);
}

export async function enableMember(db: Db, ownerId: string, targetId: string): Promise<void> {
  await memberFor(db, ownerId, targetId);
  await db.update(users).set({ disabledAt: null }).where(eq(users.id, targetId));
}

/** Removes a person and every row they own, in one atomic batch. The invitation record stays, so the address cannot be quietly recreated. */
async function eraseUser(db: Db, targetId: string): Promise<void> {
  await db.batch([
    db.delete(nudgeLog).where(eq(nudgeLog.userId, targetId)),
    db.delete(budgets).where(eq(budgets.userId, targetId)),
    db.delete(merchantAliases).where(eq(merchantAliases.userId, targetId)),
    db.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, targetId)),
    db.delete(botPending).where(eq(botPending.userId, targetId)),
    db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, targetId)),
    db.delete(telegramLinks).where(eq(telegramLinks.userId, targetId)),
    db.delete(loginCodes).where(eq(loginCodes.userId, targetId)),
    db.delete(sessions).where(eq(sessions.userId, targetId)),
    db.delete(transactions).where(eq(transactions.userId, targetId)),
    db.delete(accounts).where(eq(accounts.userId, targetId)),
    db.delete(categories).where(eq(categories.userId, targetId)),
    db.delete(appSettings).where(eq(appSettings.userId, targetId)),
    db.delete(users).where(eq(users.id, targetId)),
  ]);
}

/** Permanently removes a person and everything they own. Only for someone whose access was already removed. */
export async function deleteMember(db: Db, ownerId: string, targetId: string): Promise<void> {
  const target = await memberFor(db, ownerId, targetId);
  if (!target.disabledAt) throw new ConflictError("Remove their access first, then delete their data");
  await eraseUser(db, targetId);
}

/** People can delete their own account. They confirm by typing their email; the owner's account cannot be deleted here. */
export async function deleteOwnAccount(db: Db, userId: string, typedEmail: string): Promise<void> {
  const user = await getUserRow(db, userId);
  if (!user) throw new NotFoundError("Account not found");
  if (user.isOwner) throw new ConflictError("The owner's account cannot be deleted from the app");
  if (normalizeInviteEmail(typedEmail) !== user.email) {
    throw new ValidationError("Request validation failed", [{ path: "email", message: "That is not the email address on this account" }]);
  }
  await eraseUser(db, userId);
}
