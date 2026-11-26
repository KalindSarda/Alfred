import type { Db } from "./client";

/**
 * A short-lived read cache for the scheduled jobs, so the same rows are not fetched again and again inside one person's
 * work (a salary plan or a monthly review reads the account list, the ledger and the holds a dozen times through the
 * views it is built from). Workers Free allows 50 D1 queries per invocation, so repeats matter.
 *
 * It is off unless a job opens a scope with `withReadCache`, and a scope must only wrap work that READS: anything
 * that writes ledger rows has to run outside it, or later reads would be stale. Web requests never open a scope, so
 * their behaviour is unchanged. Arrays and Maps are copied on the way out so a caller that sorts in place cannot
 * disturb the next reader.
 */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Runs `fn` with reads on `db` cached until it finishes. A scope already open is reused. */
export async function withReadCache<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  if (scopes.has(db)) return fn();
  scopes.set(db, new Map());
  try {
    return await fn();
  } finally {
    scopes.delete(db);
  }
}

function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.slice() as T;
  if (value instanceof Map) return new Map(value) as T;
  return value;
}

/** `load()` once per `key` inside an open scope; plain `load()` outside one. */
export async function cachedRead<T>(db: Db, key: string, load: () => Promise<T>): Promise<T> {
  const scope = scopes.get(db);
  if (!scope) return load();
  let hit = scope.get(key) as Promise<T> | undefined;
  if (!hit) {
    // Wrapped so a drizzle query (which runs again on every .then) is run once and its rows are what is kept.
    hit = (async () => load())();
    scope.set(key, hit);
    // A failed read is not kept, so a retry inside the same scope asks again.
    hit.catch(() => scope.delete(key));
  }
  return copy(await hit);
}

/**
 * Wraps a read function `(db, ...args)` so that, inside a `withReadCache` scope, the same call is answered once. The
 * arguments (everything after `db`) make up the key, so they must be plain values.
 */
export function memoDb<A extends unknown[], R>(name: string, fn: (db: Db, ...args: A) => Promise<R>): (db: Db, ...args: A) => Promise<R> {
  return (db, ...args) => cachedRead(db, `${name}:${JSON.stringify(args)}`, () => fn(db, ...args));
}
