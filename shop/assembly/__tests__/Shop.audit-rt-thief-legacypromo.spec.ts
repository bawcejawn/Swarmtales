// Audit Bot red-team (Thief) attack test, SwarmTales branch audit-fixes-2 @ e5255c6.
// RT-THIEF-PROMO: a wallet that claimed campaign A under the old "one claim ever" code
// has only promoClaimed[wallet] = A (no campaignClaimed record). After the upgrade it
// claims a NEW campaign B, which overwrites promoClaimed with B, and then claims A again:
// campaignClaimed(A) is false and promoClaimed (B) != A, so A pays out twice.
// Variant: A is a single-use campaign and the thief holds a second, unused link of A.
// Asserts the SAFE behaviour: FAILS while the attack works.
// Helpers copied from shop/assembly/__tests__/Shop.spec.ts (trimmed). The legacy state is
// written straight into Shop's promoClaimed space (id 5), exactly as the old code stored it.
import { Base58, MockVM, Storage, System, authority, chain, Protobuf, system_calls } from "@koinos/sdk-as";
import { Shop } from "../Shop";
import { shop } from "../proto/shop";
import { LINK_ADDRESSES, promoSig } from "./linkFixtures";

const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const ALICE = Base58.decode("1D7nRvrRgzCg9kYBwhPH3j3Gs6SmsRg3Wq");
const BOB = Base58.decode("1NJrBLUNiGRU66FNu1VmaTNsm8qs7ADXyf");
const CARA = Base58.decode("1NRNShd6oHh1JCxfbnWj47PrgqvqeyK7w1");
const TREASURY = Base58.decode("1N3NuxjKStJwaNXs7im3hkn2f1R2URvcnu");
const FOUNDER = Base58.decode("1FCjNjhaLnEDSUM3RhoVpfzET8mSaQapiF");
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");

const START: u64 = 1700000000;
const DAY: u64 = 86400;
const MINT_ENTRY: u32 = 3698268091;
const PROMO_CLAIMED_SPACE_ID: u32 = 5;

function checkpoint(): void { MockVM.commitTransaction(); }
function authorize(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}
function callAs(account: Uint8Array): void { MockVM.setCaller(new chain.caller_data(account, chain.privilege.user_mode)); }
function setTime(at: u64): void { MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0)); }
function okCall(): system_calls.exit_arguments { return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0))); }
function allowCalls(count: i32): void {
  const list: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) list.push(okCall());
  MockVM.setCallContractResults(list);
}
function same(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null) return false;
  return Base58.encode(a) == Base58.encode(b);
}
function linkKey(key: i32): Uint8Array { return Base58.decode(LINK_ADDRESSES[key]); }
function who(account: Uint8Array): i32 {
  if (same(account, ALICE)) return 0;
  if (same(account, BOB)) return 1;
  if (same(account, CARA)) return 2;
  return 3;
}
function configure(): void {
  authorize(SHOP);
  const c = new Shop();
  c.set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, INK, STORIES));
  c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
  checkpoint();
}
function openShared(key: i32): u64 {
  authorize(SHOP);
  const id = new Shop().create_campaign(new shop.create_campaign_arguments(
    linkKey(key), 1000, 50000, 0, START, START + DAY, false, true
  )).value;
  checkpoint();
  return id;
}
function openSingle(signers: Uint8Array[]): u64 {
  authorize(SHOP);
  const c = new Shop();
  const id = c.create_campaign(new shop.create_campaign_arguments(
    new Uint8Array(0), 1000, 50000, 0, START, START + DAY, true, true
  )).value;
  c.add_single_use_signers(new shop.add_single_use_signers_arguments(id, signers));
  checkpoint();
  return id;
}
function claim(account: Uint8Array, id: u64, key: i32): void {
  authorize(account);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(account, id, null, promoSig(key, <i32>id, who(account))));
}
function claimSingle(account: Uint8Array, id: u64, key: i32): void {
  authorize(account);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(account, id, linkKey(key), promoSig(key, <i32>id, who(account))));
}
// What the pre-October-2026 Shop left behind after a claim: promoClaimed[wallet] = campaign.
function legacyClaimed(account: Uint8Array, id: u64): void {
  const legacy = new Storage.Map<Uint8Array, shop.uint64>(SHOP, PROMO_CLAIMED_SPACE_ID, shop.uint64.decode, shop.uint64.encode, () => new shop.uint64(0));
  legacy.put(account, new shop.uint64(id));
  checkpoint();
}
// Promo Ink minted to `account` (committed transactions only).
function promoMintsTo(account: Uint8Array): u64 {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let total: u64 = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].name != "shop.external_call_event") continue;
    const ev = Protobuf.decode<shop.external_call_event>(events[i].data!, shop.external_call_event.decode);
    if (ev.entry_point != MINT_ENTRY) continue;
    const m = Protobuf.decode<shop.ink_mint_call>(ev.payload!, shop.ink_mint_call.decode);
    if (same(m.to, account)) total += m.value;
  }
  return total;
}

let gId: u64 = 0;
let gKey: i32 = 0;
function againShared(): void { claim(ALICE, gId, gKey); }
function againSingle(): void { claimSingle(ALICE, gId, gKey); }

describe("RT-THIEF promo: a pre-upgrade claim of campaign A is re-opened by claiming campaign B", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    checkpoint();
    configure();
  });

  it("refuses a second claim of a shared campaign after the wallet claims a newer campaign", () => {
    const a = openShared(0);   // id 1
    const b = openShared(1);   // id 2
    legacyClaimed(ALICE, a);
    claim(ALICE, b, 1);        // legitimate: B was never claimed
    checkpoint();
    expect(promoMintsTo(ALICE)).toBe(1000);
    gId = a;
    gKey = 0;
    expect(() => { againShared(); }).toThrow("RT-THIEF promo: legacy claim of campaign A was forgotten after claiming B; A paid out twice");
    MockVM.rollbackTransaction();
    expect(promoMintsTo(ALICE)).toBe(1000, "RT-THIEF promo: wallet got campaign A's Ink a second time");
  });

  it("refuses a second claim of a single-use campaign with another unused link of it", () => {
    const a = openSingle([linkKey(1), linkKey(2)]);   // id 1: two single-use links
    const b = openShared(0);                           // id 2
    legacyClaimed(ALICE, a);                           // ALICE spent link 1 of A before the upgrade
    claim(ALICE, b, 0);
    checkpoint();
    gId = a;
    gKey = 2;                                          // a second, unused link of A
    expect(() => { againSingle(); }).toThrow("RT-THIEF promo: legacy single-use claimer took campaign A again with a second link");
    MockVM.rollbackTransaction();
    expect(promoMintsTo(ALICE)).toBe(1000, "RT-THIEF promo: wallet got campaign A's Ink a second time");
  });
});
