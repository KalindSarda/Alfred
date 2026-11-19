import { and, asc, eq } from "drizzle-orm";
import { NotFoundError } from "../config/errors";
import type { Db } from "../db/client";
import { periodReserves } from "../db/schema";
import { cycleRange, type IstDate } from "../domain/dates";
import type { CreateReserveData, UpdateReserveData } from "../schemas/reserve";
import { newId, nowIso } from "../utils/id";
import { getSettings } from "./settings";

export interface ReserveDto {
  id: string;
  name: string;
  amountPaise: number;
  /** Already moved this period, so no longer held back from what is spendable. */
  moved: boolean;
}

/** The first day of the current period (the person's own month start). */
export async function periodStart(db: Db, userId: string, today: IstDate): Promise<IstDate> {
  return cycleRange(today, (await getSettings(db, userId)).periodStartDay).from;
}

export async function listReserves(db: Db, userId: string, today: IstDate): Promise<ReserveDto[]> {
  const [rows, from] = await Promise.all([db.select().from(periodReserves).where(eq(periodReserves.userId, userId)).orderBy(asc(periodReserves.createdAt), asc(periodReserves.id)), periodStart(db, userId, today)]);
  return rows.map((r) => ({ id: r.id, name: r.name, amountPaise: r.amountPaise, moved: r.doneFor === from }));
}

async function one(db: Db, userId: string, id: string, today: IstDate): Promise<ReserveDto> {
  const found = (await listReserves(db, userId, today)).find((r) => r.id === id);
  if (!found) throw new NotFoundError("Not found");
  return found;
}

export async function createReserve(db: Db, userId: string, input: CreateReserveData, today: IstDate): Promise<ReserveDto> {
  const id = newId();
  await db.insert(periodReserves).values({ id, userId, name: input.name, amountPaise: input.amountPaise, createdAt: nowIso() });
  return one(db, userId, id, today);
}

export async function updateReserve(db: Db, userId: string, id: string, patch: UpdateReserveData, today: IstDate): Promise<ReserveDto> {
  const set = { ...(patch.name !== undefined && { name: patch.name }), ...(patch.amountPaise !== undefined && { amountPaise: patch.amountPaise }) };
  if (Object.keys(set).length > 0) {
    const updated = await db.update(periodReserves).set(set).where(and(eq(periodReserves.id, id), eq(periodReserves.userId, userId))).returning({ id: periodReserves.id });
    if (updated.length === 0) throw new NotFoundError("Not found");
  }
  return one(db, userId, id, today);
}

export async function deleteReserve(db: Db, userId: string, id: string): Promise<void> {
  const removed = await db.delete(periodReserves).where(and(eq(periodReserves.id, id), eq(periodReserves.userId, userId))).returning({ id: periodReserves.id });
  if (removed.length === 0) throw new NotFoundError("Not found");
}

/** Marks it moved for this period (so it stops being held back), or not moved. It comes back by itself next period. */
export async function setMoved(db: Db, userId: string, id: string, moved: boolean, today: IstDate): Promise<ReserveDto> {
  const from = await periodStart(db, userId, today);
  const updated = await db.update(periodReserves).set({ doneFor: moved ? from : null }).where(and(eq(periodReserves.id, id), eq(periodReserves.userId, userId))).returning({ id: periodReserves.id });
  if (updated.length === 0) throw new NotFoundError("Not found");
  return one(db, userId, id, today);
}
