// =====================================================================
// Red-team (Insider) attack test, SwarmTales fix check @ e5255c6.
// Attack: the Shop admin re-points Shop's Ink address (set_addresses,
// Shop.ts ~553) at a contract it wrote. Every buy_membership, buy_pack,
// claim_writer_ink and pay_open_fee then calls that contract (the Ink
// "mint") inside the BUYER's own signed transaction. Koinos authorizes a
// plain wallet by its signature on the transaction, so the fake Ink can
// transfer the buyer's remaining stablecoin / KOIN anywhere (any token that
// falls back to checkAuthority when the caller has no allowance), and the
// buyer gets no real Ink for the payment either.
// Claim: docs/ADMIN_POWERS.md "The Shop admin cannot ... send the stablecoin
// anywhere except the buyer's own payment to the treasury and founder."
// Stories just made its Ink address set-once for a similar reason (AB-037).
// Asserts the SAFE behaviour: once Ink is set, the Shop admin can still
// rotate treasury/founder (KEY_CUSTODY section 6) but cannot change Ink.
// FAILS on the current code.
// Helpers below are copied (trimmed) from shop/assembly/__tests__/Shop.spec.ts.
// Copy into shop/assembly/__tests__/.
// =====================================================================
import { Base58, MockVM, authority, chain } from "@koinos/sdk-as";
import { Shop } from "../Shop";
import { shop } from "../proto/shop";

const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const TREASURY = Base58.decode("1N3NuxjKStJwaNXs7im3hkn2f1R2URvcnu");
const FOUNDER = Base58.decode("1FCjNjhaLnEDSUM3RhoVpfzET8mSaQapiF");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const EVIL_INK = Base58.decode("1Htyn9WgqXQcxjCWSBtGzX5bUkSWAbocvM") // audit: was "112Au...", which decodes to 24 bytes and was refused as an invalid address;
const START: u64 = 1700000000;

function checkpoint(): void {
  MockVM.commitTransaction();
}
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([
    new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true),
  ]);
}
function callAs(account: Uint8Array): void {
  MockVM.setCaller(new chain.caller_data(account, chain.privilege.user_mode));
}
function setTime(at: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0));
}
function same(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null) return false;
  return Base58.encode(a) == Base58.encode(b);
}
function wire(): void {
  authorize(SHOP);
  new Shop().set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, INK, STORIES));
  checkpoint();
}
function swapInk(): void {
  authorize(SHOP);
  new Shop().set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, EVIL_INK, STORIES));
}
function cfg(): shop.config {
  return new Shop().get_config(new shop.get_config_arguments());
}

describe("RT-INS ink swap: the Shop admin re-points Ink at a drainer", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    checkpoint();
    wire();
  });

  it("refuses to change Shop's Ink address once it is set", () => {
    expect(swapInk).toThrow(
      "RT-INS inkswap: the Shop admin re-pointed Ink; the new 'Ink' runs inside every buyer's signed purchase");
    MockVM.rollbackTransaction();
    expect(same(cfg().ink, INK)).toBe(true, "RT-INS inkswap: purchases now call a contract the admin wrote");
  });

  it("still lets the admin move treasury and founder (legitimate use, KEY_CUSTODY section 6)", () => {
    authorize(SHOP);
    new Shop().set_addresses(new shop.set_addresses_arguments(CARA, MALLORY, INK, STORIES));
    checkpoint();
    expect(same(cfg().treasury, CARA)).toBe(true);
    expect(same(cfg().founder, MALLORY)).toBe(true);
    expect(same(cfg().ink, INK)).toBe(true);
  });
});
