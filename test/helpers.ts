import { env } from "cloudflare:workers";
import { getDb } from "../src/db/client";
import { insertAccount, type AccountRow } from "../src/db/accounts";
import { listCategories } from "../src/db/categories";
import { seedDefaultCategories } from "../src/db/seed";
import { users } from "../src/db/schema";
import { newId, nowIso } from "../src/utils/id";

export const db = getDb(env.DB);

export async function createUser(email = `${newId().toLowerCase()}@example.com`): Promise<string> {
  const id = newId();
  await db.insert(users).values({ id, email, createdAt: nowIso() });
  await seedDefaultCategories(db, id);
  return id;
}

export interface Fixture {
  userId: string;
  hdfc: AccountRow;
  sbi: AccountRow;
  reserve: AccountRow;
  millennia: AccountRow;
  category: (kind: "expense" | "income", name: string) => Promise<string>;
}

/** A user with three banks and the HDFC Millennia card, mirroring the seed data in the requirements. */
export async function createFixture(): Promise<Fixture> {
  const userId = await createUser();
  const hdfc = await insertAccount(db, userId, { kind: "bank", name: "HDFC Bank", openingBalancePaise: 10_000_00 });
  const sbi = await insertAccount(db, userId, { kind: "bank", name: "SBI", openingBalancePaise: 5_000_00 });
  const reserve = await insertAccount(db, userId, {
    kind: "bank",
    name: "Bank of Baroda",
    openingBalancePaise: 50_000_00,
    countsTowardSafeToSpend: false,
  });
  const millennia = await insertAccount(db, userId, {
    kind: "card",
    name: "HDFC Millennia",
    creditLimitPaise: 2_00_000_00,
    statementDay: 23,
    dueDay: 12,
  });
  const category = async (kind: "expense" | "income", name: string): Promise<string> => {
    const all = await listCategories(db, userId);
    const found = all.find((c) => c.kind === kind && c.name === name);
    if (!found) throw new Error(`Missing category ${kind}/${name}`);
    return found.id;
  };
  return { userId, hdfc, sbi, reserve, millennia, category };
}
