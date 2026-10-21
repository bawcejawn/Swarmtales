// =====================================================================
// Audit Bot attack test for AB-002 (SwarmTales fix check, commit b002091).
//
// Attack: a third-party contract calls a Shop entry point (in a user's or
// the admin's name), Shop writes its reentrancy lock, then refuses the
// call. Could the lock survive and freeze Shop?
//
// Koinos rule (koinos-chain host_api.cpp / system_calls.cpp, read for this
// audit): System.require exits with code 1 (reversion). In user mode a
// callee's reversion is always rethrown to the caller, which cannot catch
// it, and apply_transaction never commits the transaction's state node.
// So the whole transaction's writes, the lock included, are thrown away.
// MockVM models that with rollbackTransaction() after the throw.
//
// Asserts the SAFE behaviour: after any refused call through another
// contract, a normal direct purchase still works. Expected to PASS on
// both 3335a2a and b002091 (AB-002 is a false positive).
// Helpers are copied unchanged from shop/assembly/__tests__/Shop.spec.ts.
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

describe("AUDIT AB-002: a refused call through another contract cannot freeze Shop", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    checkpoint();
    configure();
  });

  it("refuses buy_membership, buy_pack and set_paused via an app contract, then still sells directly", () => {
    authorize(ALICE);
    callAs(EVIL_APP);
    expect(() => {
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, null, ANY_PRICE));
    }).toThrow();
    // The chain discards the whole reverted transaction (see header).
    MockVM.rollbackTransaction(); MockVM.commitTransaction();

    expect(() => {
      new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT, ANY_PRICE));
    }).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();

    authorize(SHOP);
    expect(() => { new Shop().set_paused(new shop.set_paused_arguments(true)); }).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();

    callAs(new Uint8Array(0));
    authorize(ALICE);
    payAndMint(ONE_6 * 5);
    new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, null, ONE_6 * 5));
    checkpoint();
    expect(new Shop().get_membership(new shop.get_membership_arguments(ALICE)).tier).toBe(shop.tier.TIER_WRITER, "AB-002: Shop stopped selling after a refused contract call");
  });
});
