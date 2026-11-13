/** The first few lines of a briefing for a glance, taken in the order the sections run (needs you first). */
export function compactLines<T>(sections: { lines: T[] }[], max = 3): { shown: T[]; total: number } {
  const all = sections.flatMap((s) => s.lines);
  return { shown: all.slice(0, max), total: all.length };
}
