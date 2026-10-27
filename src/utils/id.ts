const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32. Sortable by creation time. */
export function newId(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = "";
  for (const byte of bytes) random += ENCODING[byte % 32];
  return time + random;
}

export function nowIso(): string {
  return new Date().toISOString();
}
