// Audit Bot attack test for AB-045 (Swarmtales, branch audit-fixes-2 @ e5255c6).
// Attack (cheap bypass of rule 5 for claims made before the upgrade): a wallet claimed campaign 1
// under the old "one claim ever" code (only promoClaimed holds it). After the upgrade it claims
// campaign 2, which overwrites promoClaimed, and then claims campaign 1 a second time.
// Asserts the SAFE behaviour: FAILS on the current code (proof), PASSES once fixed.
// Everything above the AUDIT section is copied unchanged from shop/assembly/__tests__/Shop.spec.ts.
// =====================================================================
// SwarmTales Shop — tests
//
// These run in the Koinos mock VM on this computer. The mock does not
// execute other contracts, so a stablecoin transfer is checked like this:
//   1. Shop must actually call the token (we preset a success or a failure).
//   2. The event carries the exact bytes Shop sent.
//   3. A small ledger in this file applies those bytes: it refuses a
//      transfer that is larger than the buyer's balance or approval.
// That ledger is the stand-in for a KCS-4 stablecoin.
// =====================================================================

import { Base58, MockVM, Storage, System, authority, chain, Protobuf, token, system_calls } from "@koinos/sdk-as";
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
const EIGHT = Base58.decode("1Jykozr6Y5nZbwWvqSpnJPE1qoPn8PDBnn");
const MALLORY = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");
const ADMIN = Base58.decode("1HJgvngE2GMMy5Lw4YtzomfMCgrkuJsq91");

const START: u64 = 1700000000;
const PERIOD: u64 = 2592000;
const DAY: u64 = 86400;
const TRANSFER_ENTRY: u32 = 670398154;
const MINT_ENTRY: u32 = 3698268091;

const ONE_6: u64 = 1000000;       // $1.00 on a 6-decimal token
const ONE_8: u64 = 100000000;     // $1.00 on an 8-decimal token

// ---------- mock stablecoin ledger ----------

let balKey: string[] = [];
let balVal: u64[] = [];
let alwKey: string[] = [];
let alwVal: u64[] = [];

function resetLedger(): void {
  balKey = [];
  balVal = [];
  alwKey = [];
  alwVal = [];
}

function pair(a: Uint8Array, b: Uint8Array): string {
  return Base58.encode(a) + ":" + Base58.encode(b);
}

function findKey(keys: string[], key: string): i32 {
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] == key) return i;
  }
  return -1;
}

function setBal(asset: Uint8Array, who: Uint8Array, amount: u64): void {
  const key = pair(asset, who);
  const index = findKey(balKey, key);
  if (index < 0) {
    balKey.push(key);
    balVal.push(amount);
  } else {
    balVal[index] = amount;
  }
}

function getBal(asset: Uint8Array, who: Uint8Array): u64 {
  const index = findKey(balKey, pair(asset, who));
  return index < 0 ? 0 : balVal[index];
}

function setAllow(asset: Uint8Array, owner: Uint8Array, spender: Uint8Array, amount: u64): void {
  const key = pair(asset, owner) + ">" + Base58.encode(spender);
  const index = findKey(alwKey, key);
  if (index < 0) {
    alwKey.push(key);
    alwVal.push(amount);
  } else {
    alwVal[index] = amount;
  }
}

function getAllow(asset: Uint8Array, owner: Uint8Array, spender: Uint8Array): u64 {
  const index = findKey(alwKey, pair(asset, owner) + ">" + Base58.encode(spender));
  return index < 0 ? 0 : alwVal[index];
}

// Give the buyer exactly `amount` and approve Shop for that same amount.
function fund(asset: Uint8Array, who: Uint8Array, amount: u64): void {
  setBal(asset, who, amount);
  setAllow(asset, who, SHOP, amount);
}

function applyTransfers(): void {
  const list = calls();
  for (let i = 0; i < list.length; i++) {
    if (list[i].entry_point != TRANSFER_ENTRY) continue;
    const args = Protobuf.decode<token.transfer_arguments>(list[i].payload!, token.transfer_arguments.decode);
    const asset = list[i].contract_id!;
    const from = args.from!;
    const to = args.to!;
    const amount = args.value;

    const allowIndex = findKey(alwKey, pair(asset, from) + ">" + Base58.encode(SHOP));
    expect(allowIndex >= 0).toBe(true);
    expect(alwVal[allowIndex] >= amount).toBe(true);
    alwVal[allowIndex] = alwVal[allowIndex] - amount;

    const fromIndex = findKey(balKey, pair(asset, from));
    expect(fromIndex >= 0).toBe(true);
    expect(balVal[fromIndex] >= amount).toBe(true);
    balVal[fromIndex] = balVal[fromIndex] - amount;

    const toKey = pair(asset, to);
    const toIndex = findKey(balKey, toKey);
    if (toIndex < 0) {
      balKey.push(toKey);
      balVal.push(amount);
    } else {
      balVal[toIndex] = balVal[toIndex] + amount;
    }
  }
}

// ---------- call setup ----------

// A buyer who accepts the current price (AB-017 tests set real limits).
const ANY_PRICE: u64 = u64.MAX_VALUE;

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

// `at` is in seconds. The chain reports head_block_time in milliseconds,
// so the mock does too. This keeps the tests honest about the unit.
function setTime(at: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, at * 1000, 0));
}

function okCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0)));
}

// Exit code 0, but the protobuf bool is false (field 1 = 0).
function falseCall(): system_calls.exit_arguments {
  const encoded = new Uint8Array(2);
  encoded[0] = 8;
  encoded[1] = 0;
  return new system_calls.exit_arguments(0, new chain.result(encoded));
}

function allowCalls(count: i32): void {
  const results: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) results.push(okCall());
  MockVM.setCallContractResults(results);
}

// A balance_of answer from the stablecoin.
function balCall(value: u64): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(
    Protobuf.encode(new token.balance_of_result(value), token.balance_of_result.encode)
  ));
}

function errCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(-1, new chain.result(null, new chain.error_data("rejected")));
}

// What an honest stablecoin answers during one Shop payment, in order:
// treasury balance, founder balance, the transfer(s), then both balances again.
// Shop now checks that each balance rose by exactly its share (fix M1).
function payResults(asset: Uint8Array, price: u64): system_calls.exit_arguments[] {
  const fee = <u64>new Shop().get_config(new shop.get_config_arguments()).fee_bps;
  const founderAmount = price * fee / 10000;
  const treasuryAmount = price - founderAmount;
  const t0 = getBal(asset, TREASURY);
  const f0 = getBal(asset, FOUNDER);
  const out: system_calls.exit_arguments[] = [balCall(t0)];
  if (founderAmount > 0) out.push(balCall(f0));
  out.push(okCall());
  if (founderAmount > 0) out.push(okCall());
  out.push(balCall(t0 + treasuryAmount));
  if (founderAmount > 0) out.push(balCall(f0 + founderAmount));
  return out;
}

// A payment, then `extra` more successful calls (an Ink mint).
function allowPay(asset: Uint8Array, price: u64, extra: i32): void {
  const results = payResults(asset, price);
  for (let i = 0; i < extra; i++) results.push(okCall());
  MockVM.setCallContractResults(results);
}

// Balances read, treasury paid, then the founder transfer fails.
function failFounderTransfer(asset: Uint8Array, price: u64): void {
  MockVM.setCallContractResults([balCall(getBal(asset, TREASURY)), balCall(getBal(asset, FOUNDER)), okCall(), errCall()]);
}

// The payment goes through, then the Ink mint fails.
function payThenFailMint(asset: Uint8Array, price: u64): void {
  const results = payResults(asset, price);
  results.push(errCall());
  MockVM.setCallContractResults(results);
}

function calls(): shop.external_call_event[] {
  // Call payloads are stored in the events, so the list is larger than
  // the default 1024-byte read buffer.
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  const out: shop.external_call_event[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].name == "shop.external_call_event") {
      out.push(Protobuf.decode<shop.external_call_event>(events[i].data!, shop.external_call_event.decode));
    }
  }
  return out;
}

function lastPayment(): shop.payment_event {
  System.setSystemBufferSize(65536);
  const events = MockVM.getEvents();
  let found = false;
  let event = new shop.payment_event();
  for (let i = 0; i < events.length; i++) {
    if (events[i].name == "shop.payment_event") {
      event = Protobuf.decode<shop.payment_event>(events[i].data!, shop.payment_event.decode);
      found = true;
    }
  }
  expect(found).toBe(true);
  return event;
}

function transfers(): shop.external_call_event[] {
  const list = calls();
  const out: shop.external_call_event[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].entry_point == TRANSFER_ENTRY) out.push(list[i]);
  }
  return out;
}

function mints(): shop.external_call_event[] {
  const list = calls();
  const out: shop.external_call_event[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].entry_point == MINT_ENTRY) out.push(list[i]);
  }
  return out;
}

function decodeTransfer(event: shop.external_call_event): token.transfer_arguments {
  return Protobuf.decode<token.transfer_arguments>(event.payload!, token.transfer_arguments.decode);
}

function decodeMint(event: shop.external_call_event): shop.ink_mint_call {
  expect(Base58.encode(event.contract_id!)).toBe(Base58.encode(INK));
  expect(event.entry_point).toBe(MINT_ENTRY);
  return Protobuf.decode<shop.ink_mint_call>(event.payload!, shop.ink_mint_call.decode);
}

function same(a: Uint8Array | null, b: Uint8Array): bool {
  if (a == null) return false;
  return Base58.encode(a) == Base58.encode(b);
}

// expect(() => ...) cannot see variables from the test, so failing calls
// read these instead.
let failAccount: Uint8Array = new Uint8Array(0);
let failId: u64 = 0;
let failKey: i32 = 0;
let failSigners: Uint8Array[] = [];

function failClaim(): void {
  claim(failAccount, failId, failKey);
}

function failAddSigners(): void {
  authorize(SHOP);
  new Shop().add_single_use_signers(new shop.add_single_use_signers_arguments(failId, failSigners));
}

function failShrinkBudget(): void {
  authorize(SHOP);
  new Shop().set_campaign_limits(new shop.set_campaign_limits_arguments(failId, 500, 0, START + 50));
}

function configure(): void {
  authorize(SHOP);
  const c = new Shop();
  c.set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, INK, STORIES));
  c.set_ink_amounts(new shop.set_ink_amounts_arguments(15000, 5000, 15000, 45000, 20000, 10000));
  c.set_asset(new shop.set_asset_arguments(USDT, true, 6, "USDT"));
  c.set_asset(new shop.set_asset_arguments(EIGHT, true, 8, "EIGHT"));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, ONE_6));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_WRITER_MONTH, USDT, ONE_6 * 5));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_PACK_S, USDT, ONE_6 * 2));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_PACK_M, USDT, ONE_6 * 5));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_PACK_L, USDT, ONE_6 * 12));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_OPEN_BOOK, USDT, ONE_6 * 20));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_OPEN_SHORT, USDT, ONE_6 * 10));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_CLOSE_BOOK, USDT, ONE_6 * 5));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_CLOSE_SHORT, USDT, ONE_6 * 2));
  c.set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, EIGHT, ONE_8));
  checkpoint();
}

function buyReader(months: u32, asset: Uint8Array): void {
  authorize(ALICE);
  new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_READER, months, asset, null, ANY_PRICE));
}

function buyWriter(months: u32): void {
  authorize(ALICE);
  new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, months, USDT, null, ANY_PRICE));
}

function membershipOf(account: Uint8Array): shop.membership {
  return new Shop().get_membership(new shop.get_membership_arguments(account));
}

// ---------- signed promo links (fix H3) ----------
// Link keys 0..3 and their signatures come from linkFixtures.ts, which
// scripts/gen-link-fixtures.mjs makes with koilib, the same library the
// website uses. Only the key's public ADDRESS is ever given to Shop.

function linkKey(key: i32): Uint8Array {
  return Base58.decode(LINK_ADDRESSES[key]);
}

function who(account: Uint8Array): i32 {
  if (same(account, ALICE)) return 0;
  if (same(account, BOB)) return 1;
  if (same(account, CARA)) return 2;
  return 3;
}

function openPromo(key: i32, amount: u64, budget: u64, daily: u64, start: u64, end: u64): u64 {
  authorize(SHOP);
  const c = new Shop();
  c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
  const id = c.create_campaign(new shop.create_campaign_arguments(
    linkKey(key), amount, budget, daily, start, end, false, true
  )).value;
  checkpoint();
  return id;
}

// A shared-campaign claim: the wallet presents the link key's signature over its own address.
function claim(account: Uint8Array, id: u64, key: i32): void {
  authorize(account);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(account, id, null, promoSig(key, <i32>id, who(account))));
}

// A single-use claim also names which link key it is spending.
function claimSingle(account: Uint8Array, id: u64, key: i32): void {
  authorize(account);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(account, id, linkKey(key), promoSig(key, <i32>id, who(account))));
}

let replayAccount: Uint8Array = new Uint8Array(0);
let replaySig: Uint8Array = new Uint8Array(0);
let replaySigner: Uint8Array | null = null;

function replay(): void {
  authorize(replayAccount);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(replayAccount, failId, replaySigner, replaySig));
}

// ---------- tests ----------
// ---------- AUDIT AB-045 ----------

describe("AUDIT AB-045: a pre-upgrade promo claim can be repeated after claiming another campaign", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("refuses a second claim of the campaign a wallet claimed before the upgrade", () => {
    const first = openPromo(0, 1000, 5000, 0, START, START + DAY);
    const second = openPromo(1, 1000, 5000, 0, START, START + DAY);
    // The old code recorded a claim only here (space 5: account -> campaign id).
    new Storage.Map<Uint8Array, shop.uint64>(SHOP, 5, shop.uint64.decode, shop.uint64.encode, () => new shop.uint64(0))
      .put(ALICE, new shop.uint64(first));
    checkpoint();
    // The upgrade notes promise this is refused, and it is, at first:
    failAccount = ALICE; failId = first; failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    MockVM.rollbackTransaction();
    // A new campaign is fine (rule 5).
    claim(ALICE, second, 1);
    checkpoint();
    // Now campaign 1 again.
    expect(() => { failClaim(); }).toThrow("AB-045: the wallet claimed its pre-upgrade campaign a second time");
    MockVM.rollbackTransaction();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(first)).budget_used).toBe(0,
      "AB-045: campaign 1 paid the same wallet again");
  });
});
