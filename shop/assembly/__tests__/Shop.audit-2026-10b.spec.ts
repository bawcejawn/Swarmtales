// Tests for the re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md), Shop:
//   L-4  the founder's share can't overflow for a high-decimal token
// (Kept out of Shop.spec.ts: past its current size, as-pect runs there
// started to leak MockVM state between tests.)
import { founderShare } from "../Shop";

describe("L-4: the founder's share of a large price", () => {
  it("is exact where price * fee_bps is above 2^64", () => {
    // 1 token of an 18-decimal token is 1e18 base units: at 1% that is 1e20
    // before the division, which overflowed u64 and made purchases revert.
    const ONE_18: u64 = 1000000000000000000;
    expect(founderShare(ONE_18, 100)).toBe(ONE_18 / 100);
    expect(founderShare(ONE_18, 500)).toBe(ONE_18 / 20);
    expect(founderShare(u64.MAX_VALUE, 500)).toBe(922337203685477580);
    expect(founderShare(u64.MAX_VALUE, 1)).toBe(1844674407370955);
  });

  it("rounds down exactly as price * fee / 10000 did wherever that didn't overflow", () => {
    expect(founderShare(12345, 100)).toBe(123);
    expect(founderShare(9999, 500)).toBe(499);
    expect(founderShare(1000000, 100)).toBe(10000);
    expect(founderShare(0, 500)).toBe(0);
    expect(founderShare(1000000, 0)).toBe(0);
  });
});
