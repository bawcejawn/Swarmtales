// Tests for the re-audit of main 98230a7 (docs/AUDIT_2026_10B_PLAN.md), Shop:
//   L-4  the founder's share can't overflow for a high-decimal token
//   L-5  a turned-off token's record (and its prices) can be removed
// (Kept out of Shop.spec.ts: past its current size, as-pect runs there
// started to leak MockVM state between tests.)
import { Base58, MockVM, authority, chain } from "@koinos/sdk-as";
import { Shop, founderShare } from "../Shop";
import { shop } from "../proto/shop";

describe("L-4: the founder's share of a large price", () => {
  it("is exact where price * fee_bps is above 2^64", () => {
    // 1 token of an 18-decimal token is 1e18 base units: at 1% that is 1e20
    // before the division, which overflowed u64 and made purchases revert.
    const ONE_18: u64 = 1000000000000000000;
    expect(founderShare(ONE_18, 100)).toBe(ONE_18 / 100);
    expect(founderShare(ONE_18, 500)).toBe(ONE_18 / 20);
    expect(founderShare(u64.MAX_VALUE, 500)).toBe(u64.MAX_VALUE / 20); // 922337203685477580
    expect(founderShare(u64.MAX_VALUE, 1)).toBe(u64.MAX_VALUE / 10000); // 1844674407370955
  });

  it("rounds down exactly as price * fee / 10000 did wherever that didn't overflow", () => {
    expect(founderShare(12345, 100)).toBe(123);
    expect(founderShare(9999, 500)).toBe(499);
    expect(founderShare(1000000, 100)).toBe(10000);
    expect(founderShare(0, 500)).toBe(0);
    expect(founderShare(1000000, 0)).toBe(0);
  });
});

// ---- L-5: a turned-off token's record can be removed ----

const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const EIGHT = Base58.decode("1Jykozr6Y5nZbwWvqSpnJPE1qoPn8PDBnn");

function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function removeEight(): void {
  new Shop().remove_asset(new shop.remove_asset_arguments(EIGHT));
}

function removeUsdt(): void {
  new Shop().remove_asset(new shop.remove_asset_arguments(USDT));
}

describe("L-5: removing a turned-off token", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    MockVM.setHeadInfo(new chain.head_info(null, 1700000000000, 0));
    MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
    MockVM.commitTransaction();
    authorize(SHOP);
    new Shop().set_asset(new shop.set_asset_arguments(USDT, true, 6, "USDT"));
    new Shop().set_asset(new shop.set_asset_arguments(EIGHT, true, 8, "EIGHT"));
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, EIGHT, 100000000));
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_OPEN_POEM, EIGHT, 30000000));
    MockVM.commitTransaction();
  });

  it("deletes the record and its prices, freeing a slot, and emits an event", () => {
    new Shop().set_asset(new shop.set_asset_arguments(EIGHT, false, 8, "EIGHT"));
    removeEight();
    MockVM.commitTransaction();
    expect(new Shop().get_assets(new shop.get_assets_arguments()).tokens.length).toBe(1);
    expect(new Shop().get_asset(new shop.get_asset_arguments(EIGHT)).symbol).toBe("");
    expect(new Shop().get_price(new shop.get_price_arguments(shop.item.ITEM_READER_MONTH, EIGHT)).value).toBe(0);
    expect(new Shop().get_price(new shop.get_price_arguments(shop.item.ITEM_OPEN_POEM, EIGHT)).value).toBe(0);
    const events = MockVM.getEvents();
    expect(events[events.length - 1].name).toBe("shop.asset_removed_event");
    // Enabling it again starts from no prices.
    new Shop().set_asset(new shop.set_asset_arguments(EIGHT, true, 18, "E18"));
    expect(new Shop().get_price(new shop.get_price_arguments(shop.item.ITEM_READER_MONTH, EIGHT)).value).toBe(0);
  });

  it("refuses an enabled token and a token with no record", () => {
    expect(removeUsdt).toThrow();
    errorIs("SHOP: turn the token off before removing it");
    new Shop().set_asset(new shop.set_asset_arguments(EIGHT, false, 8, "EIGHT"));
    removeEight();
    MockVM.commitTransaction();
    expect(removeEight).toThrow();
    errorIs("SHOP: that token has no record");
  });

  it("refuses anyone but the admin", () => {
    new Shop().set_asset(new shop.set_asset_arguments(EIGHT, false, 8, "EIGHT"));
    MockVM.commitTransaction();
    // Signed by a stranger, not the admin.
    MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, SHOP, false)]);
    expect(removeEight).toThrow();
    errorIs("SHOP: admin authority required");
    expect(new Shop().get_assets(new shop.get_assets_arguments()).tokens.length).toBe(2);
  });
});
