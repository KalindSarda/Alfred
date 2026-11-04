import { describe, expect, it } from "vitest";
import { followUpDue, type FollowUpState, nextFollowUpDate, outstandingPaise, repayReminderStage } from "../../src/domain/debts";

const lent = (over: Partial<FollowUpState> = {}): FollowUpState => ({
  date: "2026-10-01",
  dueDate: null,
  lastFollowupOn: null,
  direction: "lent",
  status: "open",
  followUpStopped: false,
  trusted: false,
  ...over,
});

describe("outstandingPaise", () => {
  it("is what is left, never below zero", () => {
    expect(outstandingPaise(5_000_00, 2_000_00)).toBe(3_000_00);
    expect(outstandingPaise(5_000_00, 5_000_00)).toBe(0);
    expect(outstandingPaise(5_000_00, 6_000_00)).toBe(0);
  });
});

describe("nextFollowUpDate", () => {
  it("is the due date when there is one", () => {
    expect(nextFollowUpDate(lent({ dueDate: "2026-11-10" }))).toBe("2026-11-10");
  });

  it("is 30 days after it was lent when there is no due date", () => {
    expect(nextFollowUpDate(lent())).toBe("2026-10-31");
  });

  it("is 14 days after the last ask once asked", () => {
    expect(nextFollowUpDate(lent({ dueDate: "2026-11-10", lastFollowupOn: "2026-11-10" }))).toBe("2026-11-24");
    expect(nextFollowUpDate(lent({ lastFollowupOn: "2026-12-30" }))).toBe("2027-01-13");
  });
});

describe("followUpDue", () => {
  it("asks once the day has come, and on later days until asked", () => {
    expect(followUpDue(lent({ dueDate: "2026-11-10" }), "2026-11-09")).toBe(false);
    expect(followUpDue(lent({ dueDate: "2026-11-10" }), "2026-11-10")).toBe(true);
    expect(followUpDue(lent({ dueDate: "2026-11-10" }), "2026-12-25")).toBe(true);
  });

  it("does not ask again until the repeat interval has passed", () => {
    const d = lent({ dueDate: "2026-11-10", lastFollowupOn: "2026-11-10" });
    expect(followUpDue(d, "2026-11-23")).toBe(false);
    expect(followUpDue(d, "2026-11-24")).toBe(true);
  });

  it("never asks about a trusted person, a stopped loan, a settled one, or money borrowed", () => {
    const base = { dueDate: "2026-11-10" };
    expect(followUpDue(lent({ ...base, trusted: true }), "2027-01-01")).toBe(false);
    expect(followUpDue(lent({ ...base, followUpStopped: true }), "2027-01-01")).toBe(false);
    expect(followUpDue(lent({ ...base, status: "settled" }), "2027-01-01")).toBe(false);
    expect(followUpDue(lent({ ...base, direction: "borrowed" }), "2027-01-01")).toBe(false);
  });
});

describe("repayReminderStage", () => {
  it("reminds the day before, then on the day", () => {
    expect(repayReminderStage("2026-11-10", 0, "2026-11-08")).toBeNull();
    expect(repayReminderStage("2026-11-10", 0, "2026-11-09")).toBe(1);
    expect(repayReminderStage("2026-11-10", 1, "2026-11-09")).toBeNull();
    expect(repayReminderStage("2026-11-10", 1, "2026-11-10")).toBe(2);
    expect(repayReminderStage("2026-11-10", 2, "2026-11-12")).toBeNull();
  });

  it("sends only the later message when both days were missed", () => {
    expect(repayReminderStage("2026-11-10", 0, "2026-11-14")).toBe(2);
  });

  it("is silent without a due date", () => {
    expect(repayReminderStage(null, 0, "2026-11-10")).toBeNull();
  });
});
