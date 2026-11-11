import { describe, expect, it } from "vitest";
import { type FloatCard, floatOn, rankCards } from "../../src/domain/cardFloat";

// HDFC style: statement on the 23rd, due on the 12th of the next month. Amazon style: statement on the 12th, due on the 30th.
const hdfc = { statementDay: 23, dueDay: 12 };
const amazon = { statementDay: 12, dueDay: 30 };

describe("floatOn", () => {
  it("is longest the day after the statement and shortest on the day itself", () => {
    expect(floatOn(hdfc, "2026-11-24")).toEqual({ statementDate: "2026-12-23", dueDate: "2027-01-12", days: 49 });
    expect(floatOn(hdfc, "2026-11-23")).toEqual({ statementDate: "2026-11-23", dueDate: "2026-12-12", days: 19 });
    expect(floatOn(hdfc, "2026-11-22")).toEqual({ statementDate: "2026-11-23", dueDate: "2026-12-12", days: 20 });
  });

  it("works when the due day is in the same month as the statement", () => {
    expect(floatOn(amazon, "2026-11-13")).toEqual({ statementDate: "2026-12-12", dueDate: "2026-12-30", days: 47 });
    expect(floatOn(amazon, "2026-11-12")).toEqual({ statementDate: "2026-11-12", dueDate: "2026-11-30", days: 18 });
  });

  it("clamps a statement day to a short month", () => {
    expect(floatOn({ statementDay: 31, dueDay: 15 }, "2027-02-10").statementDate).toBe("2027-02-28");
  });
});

const card = (id: string, name: string, c: { statementDay: number; dueDay: number }, availableCreditPaise = 1_00_000_00): FloatCard => ({ id, name, ...c, availableCreditPaise, utilizationPct: 10 });

describe("rankCards", () => {
  it("puts the longest float first", () => {
    const ranked = rankCards([card("a", "Amazon", amazon), card("h", "HDFC", hdfc)], "2026-11-24", 20_000_00);
    expect(ranked.map((r) => [r.name, r.days])).toEqual([["HDFC", 49], ["Amazon", 36]]);
  });

  it("puts a card that cannot take the amount last, however long its float", () => {
    const ranked = rankCards([card("h", "HDFC", hdfc, 5_000_00), card("a", "Amazon", amazon)], "2026-11-24", 20_000_00);
    expect(ranked.map((r) => [r.name, r.fits])).toEqual([["Amazon", true], ["HDFC", false]]);
  });

  it("says when a day's wait is worth it, and not otherwise", () => {
    const [near] = rankCards([card("h", "HDFC", hdfc)], "2026-11-20", 1_000_00);
    expect(near).toMatchObject({ days: 22, waitDate: "2026-11-24", waitDays: 49 });
    const [far] = rankCards([card("h", "HDFC", hdfc)], "2026-11-05", 1_000_00);
    expect(far!.waitDate).toBeNull();
    const [onDay] = rankCards([card("h", "HDFC", hdfc)], "2026-11-23", 1_000_00);
    expect(onDay!.waitDate).toBeNull();
  });

  it("breaks a tie with the card that has more credit left", () => {
    const ranked = rankCards([card("x", "A", hdfc, 10_000_00), card("y", "B", hdfc, 90_000_00)], "2026-11-24", 1_000_00);
    expect(ranked.map((r) => r.name)).toEqual(["B", "A"]);
  });
});
