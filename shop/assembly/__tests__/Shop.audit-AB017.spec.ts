// =====================================================================
// Audit Bot attack test for the AB-017 fix (SwarmTales fix check, b002091).
// Attack the new max_price check at its edges: exactly the price, one unit
// under it, a client that sends no limit (0), the open-fee multiplier, and
// "nothing was charged": no token call may happen before the refusal.
// Asserts the SAFE behaviour; expected to PASS on b002091.
// Helpers copied from Shop.spec.ts (via Shop.audit-AB002.spec.ts).
// =====================================================================
import { Base58, MockVM, System, authority, chain, Protobuf, token, system_calls } from "@koinos/sdk-as";
import { Shop } from "../Shop";
import { shop } from "../proto/shop";

const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");
const TREASURY = Base58.decode("1N3NuxjKStJwaNXs7im3hkn2f1R2URvcnu");
const FOUNDER = Base58.decode("1FCjNjhaLnEDSUM3RhoVpfzET8mSaQapiF");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const EVIL_APP = Base58.decode("112AujjxBp3etKBgsfu9gwcfAxRYM2ve8c");

const START: u64 = 1700000000;
const ONE_6: u64 = 1000000;
const ANY_PRICE: u64 = u64.MAX_VALUE;

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function callAs(account: Uint8Array): void { MockVM.setCaller(new chain.caller_data(account, chain.privilege.user_mode)); }
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
function balCall(value: u64): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(Protobuf.encode(new token.balance_of_result(value), token.balance_of_result.encode)));
}
// treasury balance, founder balance, two transfers, both balances again, then the Ink mint.
function payAndMint(price: u64): void {
  const fee = <u64>new Shop().get_config(new shop.get_config_arguments()).fee_bps;
  const founderAmount = price * fee / 10000;
  const treasuryAmount = price - founderAmount;
  MockVM.setCallContractResults([balCall(0), balCall(0), okCall(), okCall(), balCall(treasuryAmount), balCall(founderAmount), okCall()]);
}

function configure(): void {
  authorize(SHOP);
  const c = new Shop();
  c.set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, INK, STORIES));
  c.set_ink_amounts(new shop.set_ink_amounts_arguments(15000, 5000, 15000, 45000, 20000, 10000));
  c.set_asset(new shop.set_asset_arguments(USDT, true, 6, "USDT"));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_WRITER_MONTH, USDT, ONE_6 * 5));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_PACK_S, USDT, ONE_6 * 2));
  checkpoint();
}

const TRANSFER_ENTRY: u32 = 670398154;
function tokenCalls(): i32 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let n = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "shop.external_call_event") continue;
    const ev = Protobuf.decode<shop.external_call_event>(events[i].data!, shop.external_call_event.decode);
    if (ev.entry_point == TRANSFER_ENTRY) n++;
  }
  return n;
}
let LIMIT: u64 = 0;
function buyWithLimit(): void {
  authorize(ALICE);
  payAndMint(ONE_6 * 5);
  new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, null, LIMIT));
}
function packWithLimit(): void {
  authorize(ALICE);
  payAndMint(ONE_6 * 2);
  new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT, LIMIT));
}
function openFeeWithLimit(): void {
  authorize(ALICE);
  callAs(STORIES);
  payAndMint(ONE_6 * 10 * 4);
  new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT, 4, LIMIT));
}

describe("AUDIT AB-017: the max_price check at its edges", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    checkpoint();
    configure();
    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_OPEN_SHORT, USDT, ONE_6 * 10));
    checkpoint();
  });

  it("refuses one unit under the price, and a missing limit, before any token call", () => {
    LIMIT = ONE_6 * 5 - 1;
    expect(buyWithLimit).toThrow();
    expect(tokenCalls()).toBe(0, "AB-017: a token transfer ran before the price check");
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    LIMIT = 0;
    expect(buyWithLimit).toThrow();
    expect(tokenCalls()).toBe(0, "AB-017: a token transfer ran before the price check");
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    LIMIT = ONE_6 * 2 - 1;
    expect(packWithLimit).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
  });

  it("accepts exactly the price", () => {
    LIMIT = ONE_6 * 5;
    buyWithLimit();
    checkpoint();
    expect(new Shop().get_membership(new shop.get_membership_arguments(ALICE)).tier).toBe(shop.tier.TIER_WRITER);
  });

  it("compares the open fee after the price multiplier", () => {
    LIMIT = ONE_6 * 10 * 4 - 1;
    expect(openFeeWithLimit).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    LIMIT = ONE_6 * 10 * 4;
    expect(openFeeWithLimit).not.toThrow("AB-017: the open fee at exactly the multiplied price was refused");
  });
});
