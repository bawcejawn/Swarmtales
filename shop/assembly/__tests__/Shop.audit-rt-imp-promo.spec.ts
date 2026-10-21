// Audit Bot red-team (Impersonator) attack test RT-IMP-PROMO (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack: with one claim per wallet PER CAMPAIGN (rule 5), try to reuse a promo signature across
// campaigns and wallets:
//   1. Bob's valid signature for campaign 1 presented for campaign 2 (both shared);
//   2. a signature by campaign 1's link key over campaign 2's digest (wrong key for campaign 2);
//   3. Mallory presents Bob's signature with account = herself, or account = Bob with her own authority;
//   4. a single-use link key of campaign 3 spent in campaign 4 (a different single-use campaign);
//   5. through another contract with Bob's authority;
//   6. get_campaign_claimed reports per campaign and per wallet only.
// Asserts the SAFE behaviour; expected to PASS (all blocked).
// Copy into shop/assembly/__tests__/ (imports ../Shop, ../proto/shop, ./linkFixtures).
// Setup copied (trimmed) from shop/assembly/__tests__/Shop.spec.ts.
// linkFixtures: promoSig(key 0..3, campaign 1..3, who 0 ALICE 1 BOB 2 CARA 3 MALLORY).
import { Base58, MockVM, authority, chain, system_calls } from "@koinos/sdk-as";
import { Shop } from "../Shop";
import { shop } from "../proto/shop";
import { LINK_ADDRESSES, promoSig } from "./linkFixtures";

const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const TREASURY = Base58.decode("1N3NuxjKStJwaNXs7im3hkn2f1R2URvcnu");
const FOUNDER = Base58.decode("1FCjNjhaLnEDSUM3RhoVpfzET8mSaQapiF");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const EVIL_APP = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");
const START: u64 = 1700000000;
const DAY: u64 = 86400;

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function callAs(account: Uint8Array): void { MockVM.setCaller(new chain.caller_data(account, chain.privilege.user_mode)); }
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))));
  MockVM.setCallContractResults(list);
}
function linkKey(key: i32): Uint8Array { return Base58.decode(LINK_ADDRESSES[key]); }

function reset(): void {
  MockVM.reset();
  MockVM.setContractId(SHOP);
  setTime(START);
  callAs(new Uint8Array(0));
  checkpoint();
  authorize(SHOP);
  const c = new Shop();
  c.set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, INK, STORIES));
  c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
  checkpoint();
}
function shared(key: i32): u64 {
  authorize(SHOP);
  const id = new Shop().create_campaign(new shop.create_campaign_arguments(linkKey(key), 100, 10000, 0, START, START + DAY, false, true)).value;
  checkpoint();
  return id;
}
function single(key: i32): u64 {
  authorize(SHOP);
  const c = new Shop();
  const id = c.create_campaign(new shop.create_campaign_arguments(new Uint8Array(0), 100, 10000, 0, START, START + DAY, true, true)).value;
  c.add_single_use_signers(new shop.add_single_use_signers_arguments(id, [linkKey(key)]));
  checkpoint();
  return id;
}
function claimed(id: u64, who: Uint8Array): bool {
  return new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(id, who)).value;
}

let gAccount: Uint8Array = new Uint8Array(0);
let gSigner: Uint8Array = new Uint8Array(0);
let gId: u64 = 0;
let gLink: Uint8Array | null = null;
let gSig: Uint8Array = new Uint8Array(0);
function claimCall(): void {
  authorize(gSigner);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(gAccount, gId, gLink, gSig));
}
function claimViaApp(): void {
  callAs(EVIL_APP);
  claimCall();
}
function refused(fn: () => void, message: string): void {
  expect(fn).toThrow(message);
  MockVM.rollbackTransaction();
  callAs(new Uint8Array(0));
}
function prep(account: Uint8Array, signer: Uint8Array, id: u64, link: Uint8Array | null, sig: Uint8Array): void {
  gAccount = account; gSigner = signer; gId = id; gLink = link; gSig = sig;
}

describe("RT-IMP-PROMO: a promo signature works for one wallet in one campaign only", () => {
  beforeEach(() => { reset(); });

  it("refuses a campaign-1 signature (or the campaign-1 key) in campaign 2", () => {
    const one = shared(0);          // campaign 1, link key 0
    const two = shared(1);          // campaign 2, link key 1
    prep(BOB, BOB, one, null, promoSig(0, 1, 1));
    claimCall();
    checkpoint();
    prep(BOB, BOB, two, null, promoSig(0, 1, 1));
    refused(claimCall, "RT-IMP-PROMO: Bob's campaign-1 signature claimed campaign 2");
    prep(BOB, BOB, two, null, promoSig(0, 2, 1));
    refused(claimCall, "RT-IMP-PROMO: campaign 1's link key signed a claim for campaign 2");
    expect(claimed(one, BOB)).toBe(true);
    expect(claimed(two, BOB)).toBe(false, "RT-IMP-PROMO: campaign 2 shows Bob as claimed");
    // Bob's real campaign-2 link still works: one claim per wallet per campaign.
    prep(BOB, BOB, two, null, promoSig(1, 2, 1));
    claimCall();
    checkpoint();
    expect(claimed(two, BOB)).toBe(true);
  });

  it("refuses Bob's signature for Mallory, and Bob's account under Mallory's authority", () => {
    const one = shared(0);
    prep(MALLORY, MALLORY, one, null, promoSig(0, 1, 1));
    refused(claimCall, "RT-IMP-PROMO: Mallory claimed with the signature made for Bob");
    prep(BOB, MALLORY, one, null, promoSig(0, 1, 1));
    refused(claimCall, "RT-IMP-PROMO: Mallory claimed in Bob's name");
    prep(BOB, BOB, one, null, promoSig(0, 1, 1));
    refused(claimViaApp, "RT-IMP-PROMO: an app contract claimed with Bob's authority");
    expect(claimed(one, BOB)).toBe(false);
    expect(claimed(one, MALLORY)).toBe(false);
    expect(claimed(one, ALICE)).toBe(false);
  });

  it("refuses a single-use link key from one campaign in another single-use campaign", () => {
    shared(0); shared(0);           // campaigns 1 and 2 (fill the ids)
    const three = single(2);        // campaign 3, single-use key 2
    const four = single(3);         // campaign 4, single-use key 3
    // Key 2 is a real single-use key, but of campaign 3: it signs a valid digest only for 3.
    prep(BOB, BOB, four, linkKey(2), promoSig(2, 3, 1));
    refused(claimCall, "RT-IMP-PROMO: campaign 3's single-use key claimed campaign 4");
    // Bob uses it where it belongs; it is spent for everyone after that.
    prep(BOB, BOB, three, linkKey(2), promoSig(2, 3, 1));
    claimCall();
    checkpoint();
    prep(MALLORY, MALLORY, three, linkKey(2), promoSig(2, 3, 3));
    refused(claimCall, "RT-IMP-PROMO: a spent single-use link was claimed again by another wallet");
    expect(claimed(three, BOB)).toBe(true);
    expect(claimed(four, BOB)).toBe(false);
    expect(claimed(three, MALLORY)).toBe(false);
  });
});
