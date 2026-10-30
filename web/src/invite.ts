/** The address an invitation link is for, from "#invite=name%40example.com"; null when absent or not an email. */
export function inviteEmailFromHash(hash: string): string | null {
  const match = /^#invite=([^&]*)/.exec(hash);
  if (!match?.[1]) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
