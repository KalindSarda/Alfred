import { describe, expect, it } from "vitest";
import { cardCycle } from "../../src/domain/cards";

const HDFC = { statementDay: 23, dueDay: 12 };
const AMAZON = { statementDay: 12, dueDay: 30 };
const ONECARD = { statementDay: 20, dueDay: 7 };

describe("cardCycle: HDFC Millennia (statement 23, due 12 next month)", () => {
  it("mid-cycle", () => {
    const c = cardCycle(HDFC, "2026-10-26");
    expect(c.lastStatementDate).toBe("2026-10-23");
    expect(c.nextStatementDate).toBe("2026-11-23");
    expect(c.openWindow).toEqual({ from: "2026-10-24", to: "2026-10-26" });
    expect(c.lastStatementDueDate).toBe("2026-11-12");
    expect(c.nextDueDate).toBe("2026-11-12");
  });

  it("before the statement day, the previous month's statement is the latest", () => {
    const c = cardCycle(HDFC, "2026-10-05");
    expect(c.lastStatementDate).toBe("2026-09-23");
    expect(c.lastStatementDueDate).toBe("2026-10-12");
    expect(c.nextDueDate).toBe("2026-10-12");
  });

  it("on the statement day the statement already includes today", () => {
    const c = cardCycle(HDFC, "2026-10-23");
    expect(c.lastStatementDate).toBe("2026-10-23");
    expect(c.openWindow.from).toBe("2026-10-24");
  });

  it("on the due day it is still the next due date", () => {
    expect(cardCycle(HDFC, "2026-10-12").nextDueDate).toBe("2026-10-12");
  });

  it("after the due day, the due date moves to the following statement", () => {
    expect(cardCycle(HDFC, "2026-10-13").nextDueDate).toBe("2026-11-12");
  });
});

describe("cardCycle: Amazon Pay ICICI (statement 12, due 30 same month)", () => {
  it("due date is in the same month as the statement", () => {
    const c = cardCycle(AMAZON, "2026-10-26");
    expect(c.lastStatementDate).toBe("2026-10-12");
    expect(c.lastStatementDueDate).toBe("2026-10-30");
    expect(c.nextDueDate).toBe("2026-10-30");
  });

  it("clamps a 30th due date in February", () => {
    const c = cardCycle(AMAZON, "2027-02-20");
    expect(c.lastStatementDate).toBe("2027-02-12");
    expect(c.lastStatementDueDate).toBe("2027-02-28");
  });

  it("clamps in a leap year", () => {
    expect(cardCycle(AMAZON, "2028-02-20").lastStatementDueDate).toBe("2028-02-29");
  });
});

describe("cardCycle: OneCard (statement 20, due 7 next month)", () => {
  it("handles the year rollover", () => {
    const c = cardCycle(ONECARD, "2026-12-25");
    expect(c.lastStatementDate).toBe("2026-12-20");
    expect(c.lastStatementDueDate).toBe("2027-01-07");
    expect(c.nextStatementDate).toBe("2027-01-20");
    expect(c.nextDueDate).toBe("2027-01-07");
  });

  it("early January belongs to the December statement", () => {
    const c = cardCycle(ONECARD, "2027-01-03");
    expect(c.lastStatementDate).toBe("2026-12-20");
    expect(c.nextDueDate).toBe("2027-01-07");
  });
});

describe("statement day that does not exist", () => {
  it("a 31st statement day clamps to the month end", () => {
    const card = { statementDay: 31, dueDay: 15 };
    const c = cardCycle(card, "2027-02-28");
    expect(c.lastStatementDate).toBe("2027-02-28");
    expect(c.nextStatementDate).toBe("2027-03-31");
    expect(c.lastStatementDueDate).toBe("2027-03-15");
  });

  it("due day equal to statement day falls in the next month", () => {
    const c = cardCycle({ statementDay: 10, dueDay: 10 }, "2026-10-15");
    expect(c.lastStatementDueDate).toBe("2026-11-10");
  });
});
