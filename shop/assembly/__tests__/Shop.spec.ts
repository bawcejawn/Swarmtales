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

import { Base58, MockVM, System, authority, chain, Protobuf, token, system_calls } from "@koinos/sdk-as";
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

describe("Shop: starting state", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
  });

  it("starts with the contract address as admin, a 1% fee, and promo off", () => {
    const cfg = new Shop().get_config(new shop.get_config_arguments());
    expect(same(cfg.admin, SHOP)).toBe(true);
    expect(cfg.paused).toBe(false);
    expect(cfg.fee_bps).toBe(100);
    expect(cfg.promo_enabled).toBe(false);
    expect(cfg.writer_ink).toBe(0);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(0);
  });

  it("refuses admin changes from a stranger", () => {
    configure();
    authorize(MALLORY);
    expect(() => {
      new Shop().set_fee_bps(new shop.set_fee_bps_arguments(0));
    }).toThrow();
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(100);
  });

  it("refuses a fee above 5%", () => {
    configure();
    authorize(SHOP);
    expect(() => {
      new Shop().set_fee_bps(new shop.set_fee_bps_arguments(501));
    }).toThrow();
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(100);
  });

  it("accepts a 5% fee and hands admin to a new address", () => {
    configure();
    authorize(SHOP);
    const c = new Shop();
    c.set_fee_bps(new shop.set_fee_bps_arguments(500));
    c.set_admin(new shop.set_admin_arguments(ADMIN));
    checkpoint();
    authorize(ADMIN);
    new Shop().accept_admin(new shop.accept_admin_arguments());
    checkpoint();
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(500);
    expect(same(new Shop().get_config(new shop.get_config_arguments()).admin, ADMIN)).toBe(true);

    authorize(SHOP);
    expect(() => {
      new Shop().set_paused(new shop.set_paused_arguments(true));
    }).toThrow();

    authorize(ADMIN);
    new Shop().set_paused(new shop.set_paused_arguments(true));
    expect(new Shop().get_config(new shop.get_config_arguments()).paused).toBe(true);
  });

  it("records each token's decimals and will not pay the Shop contract itself", () => {
    configure();
    const usdt = new Shop().get_asset(new shop.get_asset_arguments(USDT));
    const eight = new Shop().get_asset(new shop.get_asset_arguments(EIGHT));
    expect(usdt.enabled).toBe(true);
    expect(usdt.decimals).toBe(6);
    expect(usdt.symbol).toBe("USDT");
    expect(eight.decimals).toBe(8);
    expect(eight.symbol).toBe("EIGHT");

    authorize(SHOP);
    expect(() => {
      new Shop().set_addresses(new shop.set_addresses_arguments(SHOP, FOUNDER, INK, STORIES));
    }).toThrow();
  });
});

describe("Shop: stablecoin payments", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("splits a $1 reader month 99/1 on a 6-decimal token", () => {
    fund(USDT, ALICE, ONE_6);
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    applyTransfers();

    const pay = lastPayment();
    expect(pay.item).toBe(shop.item.ITEM_READER_MONTH);
    expect(pay.price).toBe(ONE_6);
    expect(pay.founder_amount).toBe(10000);
    expect(pay.treasury_amount).toBe(990000);
    expect(pay.treasury_amount + pay.founder_amount).toBe(pay.price);
    expect(pay.fee_bps).toBe(100);
    expect(pay.ink_amount).toBe(0);
    expect(same(pay.treasury, TREASURY)).toBe(true);
    expect(same(pay.founder, FOUNDER)).toBe(true);

    const legs = transfers();
    expect(legs.length).toBe(2);
    const first = decodeTransfer(legs[0]);
    const second = decodeTransfer(legs[1]);
    expect(same(legs[0].contract_id, USDT)).toBe(true);
    expect(same(first.from, ALICE)).toBe(true);
    expect(same(first.to, TREASURY)).toBe(true);
    expect(first.value).toBe(990000);
    expect(same(second.to, FOUNDER)).toBe(true);
    expect(second.value).toBe(10000);
    expect(mints().length).toBe(0);

    expect(getBal(USDT, ALICE)).toBe(0);
    expect(getBal(USDT, TREASURY)).toBe(990000);
    expect(getBal(USDT, FOUNDER)).toBe(10000);
    expect(getAllow(USDT, ALICE, SHOP)).toBe(0);

    const member = membershipOf(ALICE);
    expect(member.tier).toBe(shop.tier.TIER_READER);
    expect(member.paid_until).toBe(START + PERIOD);
  });

  it("uses the 8-decimal price, not the 6-decimal one", () => {
    fund(EIGHT, ALICE, ONE_8);
    allowPay(EIGHT, ONE_8, 0);
    buyReader(1, EIGHT);
    applyTransfers();

    const pay = lastPayment();
    expect(pay.price).toBe(ONE_8);
    expect(pay.founder_amount).toBe(1000000);
    expect(pay.treasury_amount).toBe(99000000);
    expect(pay.treasury_amount + pay.founder_amount).toBe(ONE_8);
    expect(getBal(EIGHT, TREASURY)).toBe(99000000);
    expect(getBal(EIGHT, FOUNDER)).toBe(1000000);
    expect(getBal(USDT, TREASURY)).toBe(0);
  });

  it("gives a 3-month reader purchase one charge and stacks the time", () => {
    fund(USDT, ALICE, ONE_6 * 3);
    allowPay(USDT, ONE_6 * 3, 0);
    buyReader(3, USDT);
    applyTransfers();

    const pay = lastPayment();
    expect(pay.price).toBe(ONE_6 * 3);
    expect(pay.founder_amount).toBe(30000);
    expect(pay.treasury_amount).toBe(2970000);
    expect(pay.treasury_amount + pay.founder_amount).toBe(pay.price);
    expect(membershipOf(ALICE).paid_until).toBe(START + PERIOD * 3);
    expect(getBal(USDT, ALICE)).toBe(0);
  });

  it("extends a reader from the current end, not from today", () => {
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    checkpoint();
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(START + PERIOD * 2);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_READER);
  });

  it("floors the founder fee and sends the remainder to treasury", () => {
    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 199));
    checkpoint();
    fund(USDT, ALICE, 199);
    allowPay(USDT, 199, 0);
    buyReader(1, USDT);
    applyTransfers();
    const pay = lastPayment();
    expect(pay.founder_amount).toBe(1);
    expect(pay.treasury_amount).toBe(198);
    expect(getBal(USDT, FOUNDER)).toBe(1);
    expect(getBal(USDT, TREASURY)).toBe(198);
  });

  it("skips the founder transfer when the fee rounds down to zero", () => {
    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 50));
    checkpoint();
    fund(USDT, ALICE, 50);
    allowPay(USDT, 50, 0);
    buyReader(1, USDT);
    applyTransfers();
    const pay = lastPayment();
    expect(pay.founder_amount).toBe(0);
    expect(pay.treasury_amount).toBe(50);
    expect(transfers().length).toBe(1);
    expect(decodeTransfer(transfers()[0]).value).toBe(50);
    expect(getBal(USDT, TREASURY)).toBe(50);
    expect(getBal(USDT, FOUNDER)).toBe(0);
  });

  it("sends the whole price to treasury when the fee is zero", () => {
    authorize(SHOP);
    new Shop().set_fee_bps(new shop.set_fee_bps_arguments(0));
    checkpoint();
    fund(USDT, ALICE, ONE_6);
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    applyTransfers();
    const pay = lastPayment();
    expect(pay.fee_bps).toBe(0);
    expect(pay.founder_amount).toBe(0);
    expect(pay.treasury_amount).toBe(ONE_6);
    expect(transfers().length).toBe(1);
    expect(getBal(USDT, TREASURY)).toBe(ONE_6);
  });

  it("applies a 5% fee with the same floor split", () => {
    authorize(SHOP);
    const c = new Shop();
    c.set_fee_bps(new shop.set_fee_bps_arguments(500));
    c.set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 10000));
    checkpoint();
    fund(USDT, ALICE, 10000);
    allowPay(USDT, 10000, 0);
    buyReader(1, USDT);
    applyTransfers();
    const pay = lastPayment();
    expect(pay.founder_amount).toBe(500);
    expect(pay.treasury_amount).toBe(9500);
    expect(getBal(USDT, FOUNDER)).toBe(500);
    expect(getBal(USDT, TREASURY)).toBe(9500);
  });

  it("does not let someone else spend a buyer's approval", () => {
    fund(USDT, ALICE, ONE_6);
    authorize(MALLORY);
    expect(() => {
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_READER, 1, USDT, null, ANY_PRICE));
    }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
    expect(getBal(USDT, ALICE)).toBe(ONE_6);
  });

  it("rolls the purchase back when the stablecoin rejects a transfer", () => {
    failFounderTransfer(USDT, ONE_6);
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();
    expect(membershipOf(ALICE).paid_until).toBe(0);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
  });

  it("refuses a disabled asset, an unset price, and more than 24 months", () => {
    authorize(SHOP);
    new Shop().set_asset(new shop.set_asset_arguments(USDT, false, 6, "USDT"));
    checkpoint();
    authorize(ALICE);
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();

    authorize(SHOP);
    new Shop().set_asset(new shop.set_asset_arguments(USDT, true, 6, "USDT"));
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 0));
    checkpoint();
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();

    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, ONE_6));
    checkpoint();
    expect(() => {
      buyReader(0, USDT);
    }).toThrow();
    expect(() => {
      buyReader(25, USDT);
    }).toThrow();
    allowPay(USDT, ONE_6 * 24, 0);
    buyReader(24, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(START + PERIOD * 24);
    expect(lastPayment().price).toBe(ONE_6 * 24);
  });

  it("lets a reader purchase through with no Ink contract configured", () => {
    authorize(SHOP);
    new Shop().set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, new Uint8Array(0), STORIES));
    checkpoint();
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    expect(mints().length).toBe(0);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_READER);
  });
});

describe("Shop: writer ink and packs", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("mints the first Writer month now and saves the rest", () => {
    fund(USDT, ALICE, ONE_6 * 10);
    allowPay(USDT, ONE_6 * 10, 1);
    buyWriter(2);
    applyTransfers();

    const pay = lastPayment();
    expect(pay.item).toBe(shop.item.ITEM_WRITER_MONTH);
    expect(pay.price).toBe(ONE_6 * 10);
    expect(pay.ink_amount).toBe(15000);
    expect(pay.ink_reason).toBe(2);
    expect(pay.founder_amount).toBe(100000);
    expect(pay.treasury_amount).toBe(9900000);
    expect(pay.treasury_amount + pay.founder_amount).toBe(pay.price);

    const minted = decodeMint(mints()[0]);
    expect(minted.value).toBe(15000);
    expect(minted.reason).toBe(2);
    expect(minted.memo).toBe("writer:month");
    expect(same(minted.to, ALICE)).toBe(true);

    const member = membershipOf(ALICE);
    expect(member.tier).toBe(shop.tier.TIER_WRITER);
    expect(member.months_unclaimed).toBe(1);
    expect(member.next_claim_at).toBe(START + PERIOD);
    expect(member.paid_until).toBe(START + PERIOD * 2);
    expect(member.ink_per_month).toBe(15000);
    expect(getBal(USDT, ALICE)).toBe(0);
  });

  it("claims the saved month when it is due, and not before", () => {
    allowPay(USDT, ONE_6 * 10, 1);
    buyWriter(2);
    checkpoint();

    authorize(ALICE);
    expect(() => {
      new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    }).toThrow();
    expect(membershipOf(ALICE).months_unclaimed).toBe(1);

    setTime(START + PERIOD);
    allowCalls(1);
    new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    const minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(15000);
    expect(minted.reason).toBe(2);
    expect(membershipOf(ALICE).months_unclaimed).toBe(0);

    checkpoint();
    expect(() => {
      new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    }).toThrow();
  });

  it("keeps the Ink rate from the purchase when the catalog changes", () => {
    allowPay(USDT, ONE_6 * 10, 1);
    buyWriter(2);
    checkpoint();
    authorize(SHOP);
    new Shop().set_ink_amounts(new shop.set_ink_amounts_arguments(1, 5000, 15000, 45000, 20000, 10000));
    checkpoint();
    setTime(START + PERIOD);
    authorize(ALICE);
    allowCalls(1);
    new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    expect(decodeMint(mints()[mints().length - 1]).value).toBe(15000);
  });

  it("does not mint again when an active Writer buys more months", () => {
    allowPay(USDT, ONE_6 * 5, 1);
    buyWriter(1);
    checkpoint();
    allowPay(USDT, ONE_6 * 10, 0);
    buyWriter(2);
    expect(mints().length).toBe(1);
    const member = membershipOf(ALICE);
    expect(member.months_unclaimed).toBe(2);
    expect(member.paid_until).toBe(START + PERIOD * 3);
    expect(member.ink_per_month).toBe(15000);
  });

  it("will not replace an active Writer with a Reader membership", () => {
    allowPay(USDT, ONE_6 * 5, 1);
    buyWriter(1);
    checkpoint();
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_WRITER);
  });

  it("drops unclaimed months once the term has ended", () => {
    allowPay(USDT, ONE_6 * 10, 1);
    buyWriter(2);
    checkpoint();
    setTime(START + PERIOD * 2);
    authorize(ALICE);
    expect(() => {
      new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    }).toThrow();
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    const member = membershipOf(ALICE);
    expect(member.tier).toBe(shop.tier.TIER_READER);
    expect(member.months_unclaimed).toBe(0);
    expect(member.ink_per_month).toBe(0);
  });

  it("sells packs only to active Writers and mints the pack amount", () => {
    authorize(ALICE);
    expect(() => {
      new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT, ANY_PRICE));
    }).toThrow();

    allowPay(USDT, ONE_6 * 5, 1);
    buyWriter(1);
    checkpoint();
    allowPay(USDT, ONE_6 * 2, 1);
    authorize(ALICE);
    new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT, ANY_PRICE));
    let minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(5000);
    expect(minted.reason).toBe(1);
    expect(minted.memo).toBe("pack:S");
    expect(lastPayment().price).toBe(ONE_6 * 2);
    expect(lastPayment().founder_amount + lastPayment().treasury_amount).toBe(ONE_6 * 2);

    checkpoint();
    allowPay(USDT, ONE_6 * 5, 1);
    new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_M, USDT, ANY_PRICE));
    minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(15000);
    expect(minted.memo).toBe("pack:M");

    checkpoint();
    allowPay(USDT, ONE_6 * 12, 1);
    new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_L, USDT, ANY_PRICE));
    minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(45000);
    expect(minted.memo).toBe("pack:L");
    expect(lastPayment().price).toBe(ONE_6 * 12);
  });

  it("rolls a Writer purchase back when the Ink mint fails", () => {
    payThenFailMint(USDT, ONE_6 * 5);
    expect(() => {
      buyWriter(1);
    }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
    expect(membershipOf(ALICE).months_unclaimed).toBe(0);
  });
});

describe("Shop: story fees", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("collects a book open fee only when Stories calls, and mints starter Ink", () => {
    authorize(ALICE);
    expect(() => {
      new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_BOOK, USDT, 0, ANY_PRICE));
    }).toThrow();

    callAs(STORIES);
    fund(USDT, ALICE, ONE_6 * 20);
    allowPay(USDT, ONE_6 * 20, 1);
    new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_BOOK, USDT, 0, ANY_PRICE));
    applyTransfers();

    const pay = lastPayment();
    expect(pay.item).toBe(shop.item.ITEM_OPEN_BOOK);
    expect(pay.price).toBe(ONE_6 * 20);
    expect(pay.ink_amount).toBe(20000);
    expect(pay.founder_amount).toBe(200000);
    expect(pay.treasury_amount + pay.founder_amount).toBe(pay.price);
    const minted = decodeMint(mints()[0]);
    expect(minted.value).toBe(20000);
    expect(minted.reason).toBe(3);
    expect(minted.memo).toBe("open:book");
    expect(same(minted.to, ALICE)).toBe(true);
    expect(getBal(USDT, ALICE)).toBe(0);
  });

  it("collects the short-story close fee with no Ink", () => {
    authorize(ALICE);
    callAs(MALLORY);
    expect(() => {
      new Shop().pay_close_fee(new shop.pay_close_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT));
    }).toThrow();

    callAs(STORIES);
    fund(USDT, ALICE, ONE_6 * 2);
    allowPay(USDT, ONE_6 * 2, 0);
    new Shop().pay_close_fee(new shop.pay_close_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT));
    applyTransfers();
    const pay = lastPayment();
    expect(pay.item).toBe(shop.item.ITEM_CLOSE_SHORT);
    expect(pay.price).toBe(ONE_6 * 2);
    expect(pay.ink_amount).toBe(0);
    expect(mints().length).toBe(0);
    expect(getBal(USDT, TREASURY)).toBe(1980000);
    expect(getBal(USDT, FOUNDER)).toBe(20000);
  });

  it("mints short-story starter Ink and the book close fee separately", () => {
    authorize(ALICE);
    callAs(STORIES);
    allowPay(USDT, ONE_6 * 10, 1);
    new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT, 0, ANY_PRICE));
    expect(decodeMint(mints()[0]).memo).toBe("open:short");
    expect(decodeMint(mints()[0]).value).toBe(10000);
    expect(lastPayment().price).toBe(ONE_6 * 10);

    checkpoint();
    allowPay(USDT, ONE_6 * 5, 0);
    new Shop().pay_close_fee(new shop.pay_close_fee_arguments(ALICE, shop.story_kind.KIND_BOOK, USDT));
    expect(lastPayment().item).toBe(shop.item.ITEM_CLOSE_BOOK);
    expect(lastPayment().price).toBe(ONE_6 * 5);
  });
});

describe("Shop: pause", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("blocks purchases and claims, and still lets the admin change a price", () => {
    authorize(SHOP);
    new Shop().set_paused(new shop.set_paused_arguments(true));
    checkpoint();

    authorize(ALICE);
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();
    allowCalls(3);
    expect(() => {
      buyWriter(1);
    }).toThrow();
    expect(() => {
      new Shop().claim_promo(new shop.claim_promo_arguments(ALICE, 1, null, promoSig(0, 1, 0)));
    }).toThrow();

    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, ONE_6 * 2));
    new Shop().set_paused(new shop.set_paused_arguments(false));
    checkpoint();

    allowPay(USDT, ONE_6 * 2, 0);
    buyReader(1, USDT);
    expect(lastPayment().price).toBe(ONE_6 * 2);
  });
});

describe("Shop: signed promo links", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("mints promo Ink once and stores only the link key's public address", () => {
    const id = openPromo(0, 1000, 3000, 0, START, START + DAY);
    const row = new Shop().get_campaign(new shop.get_campaign_arguments(id));
    expect(same(row.link_signer, linkKey(0))).toBe(true);

    claim(ALICE, id, 0);
    const minted = decodeMint(mints()[0]);
    expect(minted.value).toBe(1000);
    expect(minted.reason).toBe(4);
    expect(minted.memo).toBe("campaign:1");
    expect(same(minted.to, ALICE)).toBe(true);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(id);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(1000);
    checkpoint();

    failAccount = ALICE;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(1000);
  });

  it("rejects a link signed by the wrong key and still accepts the right one", () => {
    const id = openPromo(0, 1000, 3000, 0, START, START + DAY);
    failAccount = ALICE;
    failId = id;
    failKey = 1;
    expect(() => { failClaim(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: promo link rejected");
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(0);
    claim(ALICE, id, 0);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(id);
  });

  it("will not let a copied signature claim for a different wallet (front-running)", () => {
    const id = openPromo(0, 1000, 3000, 0, START, START + DAY);
    // Mallory watches the mempool and copies Alice's signature into her own claim.
    failId = id;
    replayAccount = MALLORY;
    replaySigner = null;
    replaySig = promoSig(0, <i32>id, 0);
    expect(() => { replay(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: promo link rejected");
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(MALLORY)).value).toBe(0);
    // Alice's own claim still works.
    claim(ALICE, id, 0);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(id);
  });

  it("will not accept a signature made for another campaign, or a malformed signature", () => {
    const first = openPromo(0, 1000, 3000, 0, START, START + DAY);
    const second = openPromo(0, 1000, 3000, 0, START, START + DAY);
    expect(second).toBe(2);
    failId = second;
    replayAccount = ALICE;
    replaySigner = null;
    replaySig = promoSig(0, <i32>first, 0);
    expect(() => { replay(); }).toThrow();
    replaySig = new Uint8Array(64);
    expect(() => { replay(); }).toThrow();
    replaySig = new Uint8Array(0);
    expect(() => { replay(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(0);
  });

  it("stops a claim that no longer fits in the budget", () => {
    const id = openPromo(0, 1000, 2500, 2000, START, START + DAY * 3);
    claim(ALICE, id, 0);
    checkpoint();
    claim(BOB, id, 0);
    checkpoint();
    failAccount = CARA;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(CARA)).value).toBe(0);

    setTime(START + DAY);
    checkpoint();
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
  });

  it("lets a later day through when only the daily cap was hit", () => {
    const id = openPromo(0, 1000, 5000, 1000, START, START + DAY * 3);
    claim(ALICE, id, 0);
    checkpoint();
    failAccount = BOB;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    setTime(START + DAY);
    checkpoint();
    claim(BOB, id, 0);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).used_today).toBe(1000);
  });

  it("rejects a campaign that is off, not started, or finished", () => {
    authorize(SHOP);
    const c = new Shop();
    c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
    const id = c.create_campaign(new shop.create_campaign_arguments(
      linkKey(0), 1000, 5000, 0, START + 10, START + 100, false, false
    )).value;
    checkpoint();
    failAccount = ALICE;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();

    authorize(SHOP);
    new Shop().set_campaign_enabled(new shop.set_campaign_enabled_arguments(id, true));
    checkpoint();
    expect(() => { failClaim(); }).toThrow();

    setTime(START + 10);
    checkpoint();
    claim(ALICE, id, 0);
    checkpoint();

    setTime(START + 100);
    failAccount = BOB;
    expect(() => { failClaim(); }).toThrow();
  });

  it("lets the admin extend the end and raise the budget, but not below what was used", () => {
    const id = openPromo(0, 1000, 1000, 0, START, START + 50);
    claim(ALICE, id, 0);
    checkpoint();
    failId = id;
    expect(() => { failShrinkBudget(); }).toThrow();
    authorize(SHOP);
    new Shop().set_campaign_limits(new shop.set_campaign_limits_arguments(id, 2000, 0, START + 200));
    checkpoint();
    setTime(START + 80);
    claim(BOB, id, 0);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
  });

  it("does nothing while the global promo switch is off", () => {
    authorize(SHOP);
    const id = new Shop().create_campaign(new shop.create_campaign_arguments(
      linkKey(0), 1000, 5000, 0, START, START + DAY, false, true
    )).value;
    checkpoint();
    failAccount = ALICE;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(0);
  });

  // Changed in October 2026: one claim per wallet per campaign (it was one ever).
  it("allows one promo claim per wallet per campaign; a second campaign works", () => {
    const first = openPromo(0, 1000, 5000, 0, START, START + DAY);
    const second = openPromo(1, 1000, 5000, 0, START, START + DAY);
    claim(ALICE, first, 0);
    checkpoint();
    failAccount = ALICE;
    failId = first;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: this wallet has already claimed this promo");
    MockVM.rollbackTransaction();
    claim(ALICE, second, 1);
    checkpoint();
    claim(BOB, second, 1);
    checkpoint();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(second);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(BOB)).value).toBe(second);
    expect(new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(first, ALICE)).value).toBe(true);
    expect(new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(second, ALICE)).value).toBe(true);
    expect(new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(first, BOB)).value).toBe(false);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(second)).budget_used).toBe(2000);
  });

  it("refuses an ended campaign and a campaign that was switched off; the others keep working", () => {
    const ended = openPromo(0, 1000, 5000, 0, START, START + 100);
    const off = openPromo(1, 1000, 5000, 0, START, START + DAY);
    const open = openPromo(2, 1000, 5000, 0, START, START + DAY);
    authorize(SHOP);
    new Shop().set_campaign_enabled(new shop.set_campaign_enabled_arguments(off, false));
    checkpoint();
    setTime(START + 100);
    failAccount = ALICE; failId = ended; failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: campaign has ended");
    MockVM.rollbackTransaction();
    failId = off; failKey = 1;
    expect(() => { failClaim(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: campaign is disabled");
    MockVM.rollbackTransaction();
    claim(ALICE, open, 2);
    checkpoint();
    expect(new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(ended, ALICE)).value).toBe(false);
    expect(new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(off, ALICE)).value).toBe(false);
    expect(new Shop().get_campaign_claimed(new shop.get_campaign_claimed_arguments(open, ALICE)).value).toBe(true);
    // The global switch stops every campaign.
    authorize(SHOP);
    new Shop().set_promo_enabled(new shop.set_promo_enabled_arguments(false));
    checkpoint();
    failAccount = BOB; failId = open; failKey = 2;
    expect(() => { failClaim(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: promo is off");
  });

  it("refuses a shared campaign without a link key, and a single-use campaign with one", () => {
    authorize(SHOP);
    expect(() => {
      new Shop().create_campaign(new shop.create_campaign_arguments(new Uint8Array(0), 1000, 5000, 0, START, START + DAY, false, true));
    }).toThrow();
    expect(() => {
      new Shop().create_campaign(new shop.create_campaign_arguments(Base58.decode(LINK_ADDRESSES[0]), 1000, 5000, 0, START, START + DAY, true, true));
    }).toThrow();
  });

  it("spends each single-use link once, and still blocks a second claim by that wallet", () => {
    authorize(SHOP);
    const c = new Shop();
    c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
    const id = c.create_campaign(new shop.create_campaign_arguments(
      new Uint8Array(0), 1000, 5000, 0, START, START + DAY, true, true
    )).value;
    const signers: Uint8Array[] = [linkKey(1), linkKey(2)];
    c.add_single_use_signers(new shop.add_single_use_signers_arguments(id, signers));
    checkpoint();
    expect(new Shop().get_single_use_status(new shop.get_single_use_status_arguments(id, linkKey(1))).value).toBe(1);
    expect(new Shop().get_single_use_status(new shop.get_single_use_status_arguments(id, linkKey(3))).value).toBe(0);

    claimSingle(ALICE, id, 1);
    checkpoint();
    expect(new Shop().get_single_use_status(new shop.get_single_use_status_arguments(id, linkKey(1))).value).toBe(2);

    // Bob holds the same link (it was forwarded): already spent.
    failId = id;
    replayAccount = BOB;
    replaySigner = linkKey(1);
    replaySig = promoSig(1, <i32>id, 1);
    expect(() => { replay(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: promo link already used");

    // Alice tries a second link of the same campaign: one claim per wallet per campaign.
    replayAccount = ALICE;
    replaySigner = linkKey(2);
    replaySig = promoSig(2, <i32>id, 0);
    expect(() => { replay(); }).toThrow();

    // A key that was never added is refused.
    replayAccount = BOB;
    replaySigner = linkKey(3);
    replaySig = promoSig(3, <i32>id, 1);
    expect(() => { replay(); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: promo link rejected");

    // Naming a real key but signing with another one is refused.
    replaySigner = linkKey(2);
    replaySig = promoSig(3, <i32>id, 1);
    expect(() => { replay(); }).toThrow();

    claimSingle(BOB, id, 2);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(BOB)).value).toBe(id);

    failSigners = signers;
    expect(() => { failAddSigners(); }).toThrow();
  });

  it("refuses single-use link keys on a shared campaign", () => {
    const id = openPromo(0, 1000, 5000, 0, START, START + DAY);
    const extra: Uint8Array[] = [linkKey(3)];
    failId = id;
    failSigners = extra;
    expect(() => { failAddSigners(); }).toThrow();
  });
});

// 1700000000 is 80000 seconds into a UTC day, so the next day starts 6400 seconds later.
const NEXT_DAY: u64 = 1700006400;

function setHeadMs(ms: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, ms, 0));
}

describe("Shop: reads, splits, and exact times", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("returns empty reads for a missing, empty, or unknown address", () => {
    const c = new Shop();
    const missing = c.get_asset(new shop.get_asset_arguments(null));
    expect(missing.enabled).toBe(false);
    expect(missing.decimals).toBe(0);
    expect(missing.symbol).toBe("");
    const empty = c.get_asset(new shop.get_asset_arguments(new Uint8Array(0)));
    expect(empty.enabled).toBe(false);
    const unknown = c.get_asset(new shop.get_asset_arguments(MALLORY));
    expect(unknown.enabled).toBe(false);
    expect(unknown.symbol).toBe("");

    expect(c.get_price(new shop.get_price_arguments(shop.item.ITEM_READER_MONTH, USDT)).value).toBe(ONE_6);
    expect(c.get_price(new shop.get_price_arguments(shop.item.ITEM_READER_MONTH, null)).value).toBe(0);
    expect(c.get_price(new shop.get_price_arguments(shop.item.ITEM_READER_MONTH, new Uint8Array(24))).value).toBe(0);

    const noAccount = c.get_membership(new shop.get_membership_arguments(null));
    expect(noAccount.tier).toBe(shop.tier.TIER_NONE);
    expect(noAccount.paid_until).toBe(0);
    const shortAccount = c.get_membership(new shop.get_membership_arguments(new Uint8Array(0)));
    expect(shortAccount.tier).toBe(shop.tier.TIER_NONE);

    const zeroCampaign = c.get_campaign(new shop.get_campaign_arguments(0));
    expect(zeroCampaign.amount).toBe(0);
    expect(zeroCampaign.enabled).toBe(false);
    const unknownCampaign = c.get_campaign(new shop.get_campaign_arguments(99));
    expect(unknownCampaign.amount).toBe(0);
    expect(unknownCampaign.budget_total).toBe(0);

    expect(c.get_promo_claimed(new shop.get_promo_claimed_arguments(null)).value).toBe(0);
    expect(c.get_promo_claimed(new shop.get_promo_claimed_arguments(new Uint8Array(0))).value).toBe(0);
  });

  it("refuses a missing symbol, which is stored as an empty string", () => {
    authorize(SHOP);
    expect(() => {
      new Shop().set_asset(new shop.set_asset_arguments(USDT, true, 6, null));
    }).toThrow();
  });

  it("refuses admin methods from someone who is not the admin", () => {
    authorize(MALLORY);
    expect(() => {
      new Shop().set_asset(new shop.set_asset_arguments(USDT, false, 6, "USDT"));
    }).toThrow();
    expect(() => {
      new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 1));
    }).toThrow();
    expect(() => {
      new Shop().set_addresses(new shop.set_addresses_arguments(MALLORY, MALLORY, INK, STORIES));
    }).toThrow();
    expect(() => {
      new Shop().set_fee_bps(new shop.set_fee_bps_arguments(0));
    }).toThrow();
    expect(() => {
      new Shop().set_admin(new shop.set_admin_arguments(MALLORY));
    }).toThrow();
    expect(() => {
      new Shop().set_ink_amounts(new shop.set_ink_amounts_arguments(1, 1, 1, 1, 1, 1));
    }).toThrow();
    expect(() => {
      new Shop().set_promo_enabled(new shop.set_promo_enabled_arguments(true));
    }).toThrow();
    expect(() => {
      new Shop().create_campaign(new shop.create_campaign_arguments(linkKey(0), 1, 1, 0, START, START + 10, false, true));
    }).toThrow();
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(100);
    expect(new Shop().get_asset(new shop.get_asset_arguments(USDT)).enabled).toBe(true);
  });

  it("splits a 1 base unit price and an odd price so the two legs equal the price", () => {
    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 1));
    checkpoint();
    fund(USDT, ALICE, 1);
    allowPay(USDT, 1, 0);
    buyReader(1, USDT);
    applyTransfers();
    let pay = lastPayment();
    expect(pay.price).toBe(1);
    expect(pay.founder_amount).toBe(0);
    expect(pay.treasury_amount).toBe(1);
    expect(pay.treasury_amount + pay.founder_amount).toBe(pay.price);
    expect(transfers().length).toBe(1);

    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 101));
    checkpoint();
    fund(USDT, ALICE, 101);
    allowPay(USDT, 101, 0);
    buyReader(1, USDT);
    pay = lastPayment();
    expect(pay.founder_amount).toBe(1);
    expect(pay.treasury_amount).toBe(100);
    expect(pay.treasury_amount + pay.founder_amount).toBe(101);
  });

  it("accepts a fee of exactly 0 and exactly 5 percent, and refuses one basis point more", () => {
    authorize(SHOP);
    new Shop().set_fee_bps(new shop.set_fee_bps_arguments(0));
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(0);
    new Shop().set_fee_bps(new shop.set_fee_bps_arguments(500));
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(500);
    checkpoint();
    expect(() => {
      new Shop().set_fee_bps(new shop.set_fee_bps_arguments(501));
    }).toThrow();
    expect(new Shop().get_config(new shop.get_config_arguments()).fee_bps).toBe(500);
  });

  it("rolls the purchase back when the token returns false without an error code", () => {
    fund(USDT, ALICE, ONE_6);
    MockVM.setCallContractResults([balCall(0), balCall(0), falseCall()]);
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: stablecoin transfer failed");
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
    expect(membershipOf(ALICE).paid_until).toBe(0);
    expect(getBal(USDT, ALICE)).toBe(ONE_6);
    expect(getBal(USDT, TREASURY)).toBe(0);
  });

  it("refuses an unknown asset and a purchase signed by someone else", () => {
    authorize(ALICE);
    expect(() => {
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_READER, 1, MALLORY, null, ANY_PRICE));
    }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);

    fund(USDT, ALICE, ONE_6);
    authorize(BOB);
    expect(() => {
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_READER, 1, USDT, null, ANY_PRICE));
    }).toThrow();
    expect(membershipOf(ALICE).paid_until).toBe(0);
    expect(getBal(USDT, ALICE)).toBe(ONE_6);
  });

  it("extends a reader before expiry, starts over at the exact expiry second, and lets a reader become a writer", () => {
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    const end = START + PERIOD;
    expect(membershipOf(ALICE).paid_until).toBe(end);

    setTime(end - 1);
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(end + PERIOD);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_READER);

    setTime(end + PERIOD);
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(end + PERIOD + PERIOD);

    setTime(end + PERIOD + PERIOD + 1);
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(end + PERIOD + PERIOD + 1 + PERIOD);

    allowPay(USDT, ONE_6 * 5, 1);
    buyWriter(1);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_WRITER);
    expect(mints().length).toBe(1);
  });

  it("pays Writer Ink at the exact period and not one millisecond earlier", () => {
    allowPay(USDT, ONE_6 * 10, 1);
    buyWriter(2);
    const due = START + PERIOD;
    expect(membershipOf(ALICE).next_claim_at).toBe(due);
    checkpoint();

    setHeadMs(due * 1000 - 1);
    authorize(ALICE);
    expect(() => {
      new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    }).toThrow();
    expect(membershipOf(ALICE).months_unclaimed).toBe(1);

    setHeadMs(due * 1000);
    allowCalls(1);
    new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    expect(membershipOf(ALICE).months_unclaimed).toBe(0);
    expect(decodeMint(mints()[mints().length - 1]).value).toBe(15000);
  });

  it("resets the daily cap on the exact next day and stops when the budget is exactly spent", () => {
    const id = openPromo(0, 1000, 2000, 1000, START, START + DAY * 3);
    claim(ALICE, id, 0);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).used_today).toBe(1000);
    checkpoint();

    setHeadMs((NEXT_DAY - 1) * 1000);
    failAccount = BOB;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(1000);

    setHeadMs(NEXT_DAY * 1000);
    checkpoint();
    claim(BOB, id, 0);
    const row = new Shop().get_campaign(new shop.get_campaign_arguments(id));
    expect(row.used_today).toBe(1000);
    expect(row.budget_used).toBe(2000);
    checkpoint();

    setTime(NEXT_DAY + DAY);
    failAccount = CARA;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(CARA)).value).toBe(0);
  });

  it("opens a campaign on its start second and closes it on its end second", () => {
    authorize(SHOP);
    const c = new Shop();
    c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
    const id = c.create_campaign(new shop.create_campaign_arguments(
      linkKey(0), 1000, 5000, 0, START + 10, START + 20, false, true
    )).value;
    checkpoint();

    setHeadMs((START + 10) * 1000 - 1);
    failAccount = ALICE;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();

    setHeadMs((START + 10) * 1000);
    checkpoint();
    claim(ALICE, id, 0);
    checkpoint();

    setHeadMs((START + 20) * 1000 - 1);
    claim(BOB, id, 0);
    checkpoint();

    setHeadMs((START + 20) * 1000);
    failAccount = CARA;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(CARA)).value).toBe(0);
  });

  it("accepts a daily cap that covers one claim and refuses a smaller one", () => {
    const id = openPromo(0, 1000, 5000, 0, START, START + DAY);
    failId = id;
    expect(() => { failTightCap(); }).toThrow();
    authorize(SHOP);
    new Shop().set_campaign_limits(new shop.set_campaign_limits_arguments(id, 5000, 1000, START + DAY));
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).daily_cap).toBe(1000);
  });
});

function failTightCap(): void {
  authorize(SHOP);
  new Shop().set_campaign_limits(new shop.set_campaign_limits_arguments(failId, 5000, 999, START + DAY));
}

// =====================================================================
// Security fixes H1 (direct calls only) and M1 (check the money arrived)
// =====================================================================

// MALLORY here stands for a contract: some other app that a user signed
// a transaction for, which then calls Shop in that user's name.
function viaOtherContract(): void {
  callAs(MALLORY);
}

function directly(): void {
  callAs(new Uint8Array(0));
}

describe("Shop: only direct calls (fix H1)", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    directly();
    resetLedger();
    checkpoint();
    configure();
  });

  it("refuses a purchase that arrives through another contract, even though the buyer signed", () => {
    fund(USDT, ALICE, ONE_6);
    allowPay(USDT, ONE_6, 0);
    viaOtherContract();
    expect(() => { buyReader(1, USDT); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: call SwarmTales directly from your wallet, not through another contract");
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
    expect(transfers().length).toBe(0);

    // The same purchase sent directly by Alice works.
    directly();
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_READER);
  });

  it("refuses packs, Writer claims and promo claims through another contract", () => {
    allowPay(USDT, ONE_6 * 10, 1);
    buyWriter(2);
    checkpoint();
    const id = openPromo(0, 1000, 5000, 0, START, START + DAY);

    viaOtherContract();
    authorize(ALICE);
    expect(() => {
      new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT, ANY_PRICE));
    }).toThrow();
    setTime(START + PERIOD);
    expect(() => {
      new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    }).toThrow();
    failAccount = BOB;
    failId = id;
    failKey = 0;
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(BOB)).value).toBe(0);
    expect(membershipOf(ALICE).months_unclaimed).toBe(1);
  });

  it("refuses admin changes through another contract, even with the admin's signature", () => {
    viaOtherContract();
    authorize(SHOP);
    expect(() => { new Shop().set_fee_bps(new shop.set_fee_bps_arguments(500)); }).toThrow();
    expect(() => { new Shop().set_addresses(new shop.set_addresses_arguments(MALLORY, MALLORY, INK, STORIES)); }).toThrow();
    expect(() => { new Shop().set_admin(new shop.set_admin_arguments(MALLORY)); }).toThrow();
    expect(() => {
      new Shop().create_campaign(new shop.create_campaign_arguments(linkKey(0), 1000000, 1000000, 0, START, START + DAY, false, true));
    }).toThrow();
    directly();
    const cfg = new Shop().get_config(new shop.get_config_arguments());
    expect(cfg.fee_bps).toBe(100);
    expect(same(cfg.treasury, TREASURY)).toBe(true);
    expect(same(cfg.admin, SHOP)).toBe(true);
  });

  it("still lets Stories, and only Stories, collect story fees", () => {
    callAs(STORIES);
    authorize(ALICE);
    allowPay(USDT, ONE_6 * 2, 0);
    new Shop().pay_close_fee(new shop.pay_close_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT));
    expect(lastPayment().item).toBe(shop.item.ITEM_CLOSE_SHORT);
  });
});

describe("Shop: the money must actually arrive (fix M1)", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    directly();
    resetLedger();
    checkpoint();
    configure();
  });

  it("refuses a token that says 'done' but moves nothing", () => {
    // Before: 0 and 0. Two empty (success) transfer replies. After: still 0 and 0.
    MockVM.setCallContractResults([balCall(0), balCall(0), okCall(), okCall(), balCall(0), balCall(0)]);
    expect(() => { buyReader(1, USDT); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: stablecoin payment did not arrive");
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
  });

  it("refuses a short payment, such as a token that skims a transfer fee", () => {
    MockVM.setCallContractResults([balCall(0), balCall(0), okCall(), okCall(), balCall(989999), balCall(10000)]);
    expect(() => { buyReader(1, USDT); }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: stablecoin payment did not arrive");
  });

  it("refuses when the founder's share does not arrive", () => {
    MockVM.setCallContractResults([balCall(0), balCall(0), okCall(), okCall(), balCall(990000), balCall(0)]);
    expect(() => { buyReader(1, USDT); }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
  });

  it("refuses when a balance cannot be read", () => {
    MockVM.setCallContractResults([errCall()]);
    expect(() => { buyReader(1, USDT); }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
    expect(transfers().length).toBe(0);
  });

  it("accepts the whole price at one wallet when treasury and founder are the same", () => {
    authorize(SHOP);
    new Shop().set_addresses(new shop.set_addresses_arguments(TREASURY, TREASURY, INK, STORIES));
    checkpoint();
    // One balance read before, two transfers, one read after: +$1.00 in total.
    MockVM.setCallContractResults([balCall(500), okCall(), okCall(), balCall(500 + ONE_6)]);
    buyReader(1, USDT);
    const pay = lastPayment();
    expect(pay.treasury_amount).toBe(990000);
    expect(pay.founder_amount).toBe(10000);
    expect(transfers().length).toBe(2);
  });

  it("asks the token for the treasury and founder balances, by the KCS-4 balance_of entry point", () => {
    allowPay(USDT, ONE_6, 0);
    buyReader(1, USDT);
    // The payment went through; the honest-token replies matched exactly.
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_READER);
  });
});

describe("Shop: gifted memberships and the open-price multiplier", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("lets Alice pay a Writer month for Bob: Bob gets the membership and the Ink", () => {
    allowPay(USDT, ONE_6 * 5, 1);
    authorize(ALICE);
    new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, BOB, ANY_PRICE));
    expect(membershipOf(BOB).tier).toBe(shop.tier.TIER_WRITER);
    expect(membershipOf(ALICE).tier).toBe(0);
    expect(same(decodeMint(mints()[0]).to, BOB)).toBe(true);
    expect(decodeMint(mints()[0]).value).toBe(15000);
    expect(same(lastPayment().payer, ALICE)).toBe(true);
    expect(getBal(USDT, ALICE)).toBe(0);
  });

  it("still needs the payer's signature, not the beneficiary's", () => {
    allowPay(USDT, ONE_6 * 5, 1);
    authorize(BOB);
    expect(() => {
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, BOB, ANY_PRICE));
    }).toThrow();
    expect(membershipOf(BOB).tier).toBe(0);
  });

  it("multiplies the open price by what Stories sends, and mints the normal starter Ink", () => {
    authorize(ALICE);
    callAs(STORIES);
    allowPay(USDT, ONE_6 * 10 * 4, 1);
    new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT, 4, ANY_PRICE));
    expect(lastPayment().price).toBe(ONE_6 * 40);
    expect(decodeMint(mints()[0]).value).toBe(10000);
  });

  it("treats 0 and 1 as the normal price and refuses more than 1024", () => {
    authorize(ALICE);
    callAs(STORIES);
    allowPay(USDT, ONE_6 * 10, 1);
    new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT, 0, ANY_PRICE));
    expect(lastPayment().price).toBe(ONE_6 * 10);
    checkpoint();
    expect(() => {
      authorize(ALICE);
      callAs(STORIES);
      allowPay(USDT, ONE_6 * 10 * 2048, 1);
      new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT, 2048, ANY_PRICE));
    }).toThrow();
  });
});

describe("Shop: two-step admin handover (AB-016)", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
  });

  it("set_admin alone does not move admin: a typo cannot strand it", () => {
    configure();
    authorize(SHOP);
    new Shop().set_admin(new shop.set_admin_arguments(ADMIN));
    checkpoint();
    expect(same(new Shop().get_config(new shop.get_config_arguments()).admin, ADMIN)).toBe(false);
    authorize(SHOP);
    new Shop().set_paused(new shop.set_paused_arguments(true));
    checkpoint();
    expect(new Shop().get_config(new shop.get_config_arguments()).paused).toBe(true);
  });

  it("only the proposed address can accept, directly; proposing the admin again cancels", () => {
    configure();
    authorize(SHOP);
    new Shop().set_admin(new shop.set_admin_arguments(ADMIN));
    checkpoint();
    expect(same(new Shop().get_config(new shop.get_config_arguments()).pending_admin, ADMIN)).toBe(true);
    expect(() => { authorize(MALLORY); new Shop().accept_admin(new shop.accept_admin_arguments()); }).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    expect(() => { authorize(ADMIN); callAs(MALLORY); new Shop().accept_admin(new shop.accept_admin_arguments()); }).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    callAs(new Uint8Array(0));
    authorize(SHOP);
    new Shop().set_admin(new shop.set_admin_arguments(SHOP));   // cancel
    checkpoint();
    expect(new Shop().get_config(new shop.get_config_arguments()).pending_admin).toBeNull();
    expect(() => { authorize(ADMIN); new Shop().accept_admin(new shop.accept_admin_arguments()); }).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    authorize(SHOP);
    new Shop().set_admin(new shop.set_admin_arguments(ADMIN));
    checkpoint();
    authorize(ADMIN);
    new Shop().accept_admin(new shop.accept_admin_arguments());
    checkpoint();
    expect(same(new Shop().get_config(new shop.get_config_arguments()).admin, ADMIN)).toBe(true);
  });
});

describe("Shop: purchases carry the buyer's price limit (AB-017)", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
  });

  it("refuses a purchase that does not say the most the buyer will pay", () => {
    configure();
    checkpoint();
    authorize(ALICE);
    MockVM.setCallContractResults(payResults(USDT, ONE_6 * 5));
    expect(() => {
      // No max_price: the buyer never said what they agreed to pay.
      const noLimit = new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT);
      new Shop().buy_membership(noLimit);
    }).toThrow();
  });

  it("charges the price the buyer saw, and refuses once the admin raises it above that", () => {
    configure();
    checkpoint();
    // Alice sees 5 USDT for a Writer month and signs with that limit.
    authorize(ALICE);
    MockVM.setCallContractResults(payResults(USDT, ONE_6 * 5));
    new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, null, ONE_6 * 5));
    checkpoint();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_WRITER);

    // The admin raises the price before her next purchase lands.
    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_WRITER_MONTH, USDT, ONE_6 * 9));
    checkpoint();
    authorize(ALICE);
    MockVM.setCallContractResults(payResults(USDT, ONE_6 * 9));
    expect(() => {
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, null, ONE_6 * 5));
    }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: the price is 9000000, more than the most you agreed to pay. Nothing was charged.");
  });

  it("applies the limit to packs and to the open fee, after the price multiplier", () => {
    configure();
    authorize(ALICE);
    MockVM.setCallContractResults(payResults(USDT, ONE_6 * 5));
    new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, 1, USDT, null, ANY_PRICE));
    checkpoint();
    authorize(ALICE);
    expect(() => {
      new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT, ONE_6 * 2 - 1));
    }).toThrow();
    MockVM.rollbackTransaction(); MockVM.commitTransaction();
    // The open fee is 10 USDT; with a multiplier of 2 it is 20.
    authorize(ALICE);
    callAs(STORIES);
    expect(() => {
      new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT, 2, ONE_6 * 10));
    }).toThrow();
    expect(MockVM.getErrorMessage()).toBe("SHOP: the price is 20000000, more than the most you agreed to pay. Nothing was charged.");
  });
});
