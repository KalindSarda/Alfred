import { describe, expect, it } from "vitest";
import { explainStatementGap, feeWithGstInRupees } from "../../src/domain/statementGap";

describe("feeWithGstInRupees", () => {
  it("finds a whole-rupee fee whose total with 18% GST is the gap", () => {
    expect(feeWithGstInRupees(35_282)).toBe(29_900);
    expect(feeWithGstInRupees(11_800_00)).toBe(10_000_00);
  });

  it("does not guess when the gap is not such a total, or the fee would be tiny", () => {
    expect(feeWithGstInRupees(35_300)).toBeNull();
    expect(feeWithGstInRupees(1_180)).toBeNull();
  });
});

describe("explainStatementGap", () => {
  it("matches when the figures agree", () => {
    expect(explainStatementGap(20_000_00, 20_000_00, 0)).toMatchObject({ kind: "matches", differencePaise: 0, bookAs: null });
  });

  it("recognises a fee with GST, the way the Millennia statement showed one", () => {
    const g = explainStatementGap(20_000_00, 20_000_00 + 35_282, 0);
    expect(g).toMatchObject({ kind: "fee_gst", differencePaise: 35_282, bookAs: "fee" });
    expect(g.reason).toContain("exactly ₹299 plus 18% GST");
  });

  it("recognises interest when last month was left unpaid, and only then", () => {
    const g = explainStatementGap(30_000_00, 30_000_00 + 1_234_56, 40_000_00);
    expect(g).toMatchObject({ kind: "interest", bookAs: "fee" });
    expect(g.reason).toContain("about 3.1% of that");
    expect(explainStatementGap(30_000_00, 30_000_00 + 1_234_56, 0).kind).toBe("unrecorded");
  });

  it("says a higher figure it cannot name is probably a missing purchase", () => {
    expect(explainStatementGap(20_000_00, 21_111_11, 0)).toMatchObject({ kind: "unrecorded", bookAs: "spending", differencePaise: 1_111_11 });
  });

  it("says a lower figure may be a missing credit", () => {
    const g = explainStatementGap(20_000_00, 19_500_00, 0);
    expect(g).toMatchObject({ kind: "credit", bookAs: "credit", differencePaise: -500_00 });
    expect(g.reason).toContain("₹500 lower");
  });
});
