import { describe, expect, it } from "vitest";
import { dayNumber, pickUsers } from "../../src/domain/userWindow";

const people = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(2, "0")}`);

describe("pickUsers", () => {
  it("takes everyone when there are no more people than the cap", () => {
    expect(pickUsers(["b", "a"], "2026-12-01", 3)).toEqual({ chosen: ["a", "b"], deferred: 0 });
    expect(pickUsers([], "2026-12-01", 2)).toEqual({ chosen: [], deferred: 0 });
  });

  it("takes at most the cap, and says how many were left", () => {
    const w = pickUsers(people(7), "2026-12-01", 3);
    expect(w.chosen).toHaveLength(3);
    expect(w.deferred).toBe(4);
  });

  it("gives the same answer for the same day whatever order the people come in", () => {
    const a = pickUsers(people(6), "2026-12-05", 2).chosen;
    const b = pickUsers([...people(6)].reverse(), "2026-12-05", 2).chosen;
    expect(b).toEqual(a);
  });

  it("moves along each day so that nobody is left out for good", () => {
    const n = 7;
    const cap = 2;
    const turns = new Map<string, number>();
    const first = dayNumber("2026-12-01");
    const days = Math.ceil(n / cap);
    for (let d = 0; d < days; d++) {
      const day = new Date((first + d) * 86_400_000).toISOString().slice(0, 10);
      for (const id of pickUsers(people(n), day, cap).chosen) turns.set(id, (turns.get(id) ?? 0) + 1);
    }
    // Within ceil(n / cap) days everyone has had at least one turn.
    expect([...turns.keys()].sort()).toEqual(people(n));
  });

  it("moves along each run, not each day, for a weekly job", () => {
    const n = 7; // a multiple of 7 would never move if the window stepped daily and the job ran weekly
    const seen = new Set<string>();
    for (let week = 0; week < n; week++) {
      const day = new Date((dayNumber("2026-11-28") + week * 7) * 86_400_000).toISOString().slice(0, 10);
      for (const id of pickUsers(people(n), day, 1, 7).chosen) seen.add(id);
    }
    expect(seen.size).toBe(n);
  });

  it("takes nobody for a cap below one, and reports them all as left", () => {
    expect(pickUsers(people(3), "2026-12-01", 0)).toEqual({ chosen: [], deferred: 3 });
  });
});
