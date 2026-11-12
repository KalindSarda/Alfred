import { describe, expect, it } from "vitest";
import { dueDatesBetween, nextDue, type PolicyFacts, protectionGaps } from "../../src/domain/protection";

const health = (coverPaise: number, source: PolicyFacts["source"] = "personal", status: PolicyFacts["status"] = "active"): PolicyFacts => ({ kind: "health", source, coverPaise, status });
const term = (coverPaise: number): PolicyFacts => ({ kind: "term", source: "personal", coverPaise, status: "active" });
const known = { dependants: "no" as const, employerHealth: "yes" as const };
const keys = (gaps: ReturnType<typeof protectionGaps>) => gaps.map((g) => g.key);

describe("premium and renewal dates", () => {
  it("keeps a future date, and steps a past one forward by the frequency", () => {
    expect(nextDue("2026-11-20", "yearly", "2026-10-27")).toBe("2026-11-20");
    expect(nextDue("2025-11-20", "yearly", "2026-10-27")).toBe("2026-11-20");
    expect(nextDue("2026-01-15", "quarterly", "2026-10-27")).toBe("2027-01-15");
    expect(nextDue("2026-10-27", "monthly", "2026-10-27")).toBe("2026-10-27");
  });

  it("keeps the day of the month through short months", () => {
    expect(nextDue("2026-01-31", "monthly", "2026-02-01")).toBe("2026-02-28");
    expect(nextDue("2026-01-31", "monthly", "2026-03-01")).toBe("2026-03-31");
  });

  it("lists every date in a window, the end excluded", () => {
    expect(dueDatesBetween("2026-10-30", "monthly", "2026-10-27", "2026-12-31")).toEqual(["2026-10-30", "2026-11-30", "2026-12-30"]);
    expect(dueDatesBetween("2026-10-30", "monthly", "2026-10-27", "2026-11-30")).toEqual(["2026-10-30"]);
    expect(dueDatesBetween("2025-12-01", "yearly", "2026-10-27", "2026-12-01")).toEqual([]);
  });
});

describe("protectionGaps", () => {
  it("flags no personal health cover, and says work cover ends with the job", () => {
    const gaps = protectionGaps([], known, null);
    expect(gaps[0]).toMatchObject({ key: "health_missing", severity: "high" });
    expect(gaps[0]?.detail).toContain("Cover through work usually ends with the job");
    expect(protectionGaps([], { ...known, employerHealth: "no" }, null)[0]?.detail).not.toContain("through work");
  });

  it("does not count cover through work, or a lapsed policy, as personal cover", () => {
    expect(keys(protectionGaps([health(10_00_000_00, "employer")], known, null))).toContain("health_missing");
    expect(keys(protectionGaps([health(10_00_000_00, "personal", "lapsed")], known, null))).toContain("health_missing");
  });

  it("is quiet when health cover is enough, and flags a small one as a rule of thumb", () => {
    expect(protectionGaps([health(10_00_000_00)], known, null)).toEqual([]);
    const low = protectionGaps([health(3_00_000_00)], known, null);
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ key: "health_low", severity: "medium" });
    expect(low[0]?.detail).toContain("rule of thumb");
  });

  it("asks for term cover only when someone depends on you", () => {
    const personal = [health(10_00_000_00)];
    expect(keys(protectionGaps(personal, { ...known, dependants: "no" }, null))).toEqual([]);
    expect(protectionGaps(personal, { ...known, dependants: "yes" }, null)[0]).toMatchObject({ key: "term_missing", severity: "high" });
    expect(protectionGaps(personal, { ...known, dependants: "partly" }, null)[0]).toMatchObject({ key: "term_missing", severity: "medium" });
  });

  it("compares term cover with yearly income at the lower end of the usual range", () => {
    const base = [health(10_00_000_00)];
    const yes = { ...known, dependants: "yes" as const };
    expect(keys(protectionGaps([...base, term(50_00_000_00)], yes, 12_00_000_00))).toEqual(["term_low"]);
    expect(protectionGaps([...base, term(1_20_00_000_00)], yes, 12_00_000_00)).toEqual([]);
    // No income known yet: nothing to compare against.
    expect(protectionGaps([...base, term(10_00_000_00)], yes, null)).toEqual([]);
  });

  it("says when the two answers are still open", () => {
    const gaps = protectionGaps([health(10_00_000_00)], { dependants: "unknown", employerHealth: "unknown" }, null);
    expect(gaps).toEqual([expect.objectContaining({ key: "questions", severity: "info" })]);
  });
});
