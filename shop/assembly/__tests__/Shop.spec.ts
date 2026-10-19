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
  MockVM.setHeadInfo(new chain.head_info(null, at, 0));
}

function okCall(): system_calls.exit_arguments {
  return new system_calls.exit_arguments(0, new chain.result(new Uint8Array(0)));
}

function allowCalls(count: i32): void {
  const results: system_calls.exit_arguments[] = [];
  for (let i = 0; i < count; i++) results.push(okCall());
  MockVM.setCallContractResults(results);
}

function failOnCall(index: i32): void {
  const results: system_calls.exit_arguments[] = [];
  for (let i = 0; i < index; i++) results.push(okCall());
  results.push(new system_calls.exit_arguments(-1, new chain.result(null, new chain.error_data("rejected"))));
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
let failCode: string = "";
let failCodes: string[] = [];

function failClaim(): void {
  claim(failAccount, failId, failCode);
}

function failAddCodes(): void {
  authorize(SHOP);
  new Shop().add_single_use_codes(new shop.add_single_use_codes_arguments(failId, failCodes));
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
  new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_READER, months, asset));
}

function buyWriter(months: u32): void {
  authorize(ALICE);
  new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_WRITER, months, USDT));
}

function membershipOf(account: Uint8Array): shop.membership {
  return new Shop().get_membership(new shop.get_membership_arguments(account));
}

function openPromo(code: string, amount: u64, budget: u64, daily: u64, start: u64, end: u64): u64 {
  authorize(SHOP);
  const c = new Shop();
  c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
  const id = c.create_campaign(new shop.create_campaign_arguments(
    code, amount, budget, daily, start, end, false, true
  )).value;
  checkpoint();
  return id;
}

function claim(account: Uint8Array, id: u64, code: string): void {
  authorize(account);
  allowCalls(1);
  new Shop().claim_promo(new shop.claim_promo_arguments(account, id, code));
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
    allowCalls(2);
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
    allowCalls(2);
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
    allowCalls(2);
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
    allowCalls(2);
    buyReader(1, USDT);
    checkpoint();
    allowCalls(2);
    buyReader(1, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(START + PERIOD * 2);
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_READER);
  });

  it("floors the founder fee and sends the remainder to treasury", () => {
    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, 199));
    checkpoint();
    fund(USDT, ALICE, 199);
    allowCalls(2);
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
    allowCalls(1);
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
    allowCalls(1);
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
    allowCalls(2);
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
      new Shop().buy_membership(new shop.buy_membership_arguments(ALICE, shop.tier.TIER_READER, 1, USDT));
    }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_NONE);
    expect(getBal(USDT, ALICE)).toBe(ONE_6);
  });

  it("rolls the purchase back when the stablecoin rejects a transfer", () => {
    failOnCall(1);
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
    allowCalls(2);
    buyReader(24, USDT);
    expect(membershipOf(ALICE).paid_until).toBe(START + PERIOD * 24);
    expect(lastPayment().price).toBe(ONE_6 * 24);
  });

  it("lets a reader purchase through with no Ink contract configured", () => {
    authorize(SHOP);
    new Shop().set_addresses(new shop.set_addresses_arguments(TREASURY, FOUNDER, new Uint8Array(0), STORIES));
    checkpoint();
    allowCalls(2);
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
    allowCalls(3);
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
    allowCalls(3);
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
    allowCalls(3);
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
    allowCalls(3);
    buyWriter(1);
    checkpoint();
    allowCalls(2);
    buyWriter(2);
    expect(mints().length).toBe(1);
    const member = membershipOf(ALICE);
    expect(member.months_unclaimed).toBe(2);
    expect(member.paid_until).toBe(START + PERIOD * 3);
    expect(member.ink_per_month).toBe(15000);
  });

  it("will not replace an active Writer with a Reader membership", () => {
    allowCalls(3);
    buyWriter(1);
    checkpoint();
    expect(() => {
      buyReader(1, USDT);
    }).toThrow();
    expect(membershipOf(ALICE).tier).toBe(shop.tier.TIER_WRITER);
  });

  it("drops unclaimed months once the term has ended", () => {
    allowCalls(3);
    buyWriter(2);
    checkpoint();
    setTime(START + PERIOD * 2);
    authorize(ALICE);
    expect(() => {
      new Shop().claim_writer_ink(new shop.claim_writer_ink_arguments(ALICE));
    }).toThrow();
    allowCalls(2);
    buyReader(1, USDT);
    const member = membershipOf(ALICE);
    expect(member.tier).toBe(shop.tier.TIER_READER);
    expect(member.months_unclaimed).toBe(0);
    expect(member.ink_per_month).toBe(0);
  });

  it("sells packs only to active Writers and mints the pack amount", () => {
    authorize(ALICE);
    expect(() => {
      new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT));
    }).toThrow();

    allowCalls(3);
    buyWriter(1);
    checkpoint();
    allowCalls(3);
    authorize(ALICE);
    new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_S, USDT));
    let minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(5000);
    expect(minted.reason).toBe(1);
    expect(minted.memo).toBe("pack:S");
    expect(lastPayment().price).toBe(ONE_6 * 2);
    expect(lastPayment().founder_amount + lastPayment().treasury_amount).toBe(ONE_6 * 2);

    checkpoint();
    allowCalls(3);
    new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_M, USDT));
    minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(15000);
    expect(minted.memo).toBe("pack:M");

    checkpoint();
    allowCalls(3);
    new Shop().buy_pack(new shop.buy_pack_arguments(ALICE, shop.item.ITEM_PACK_L, USDT));
    minted = decodeMint(mints()[mints().length - 1]);
    expect(minted.value).toBe(45000);
    expect(minted.memo).toBe("pack:L");
    expect(lastPayment().price).toBe(ONE_6 * 12);
  });

  it("rolls a Writer purchase back when the Ink mint fails", () => {
    failOnCall(2);
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
      new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_BOOK, USDT));
    }).toThrow();

    callAs(STORIES);
    fund(USDT, ALICE, ONE_6 * 20);
    allowCalls(3);
    new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_BOOK, USDT));
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
    allowCalls(2);
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
    allowCalls(3);
    new Shop().pay_open_fee(new shop.pay_open_fee_arguments(ALICE, shop.story_kind.KIND_SHORT, USDT));
    expect(decodeMint(mints()[0]).memo).toBe("open:short");
    expect(decodeMint(mints()[0]).value).toBe(10000);
    expect(lastPayment().price).toBe(ONE_6 * 10);

    checkpoint();
    allowCalls(2);
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
      new Shop().claim_promo(new shop.claim_promo_arguments(ALICE, 1, "LOOM"));
    }).toThrow();

    authorize(SHOP);
    new Shop().set_price(new shop.set_price_arguments(shop.item.ITEM_READER_MONTH, USDT, ONE_6 * 2));
    new Shop().set_paused(new shop.set_paused_arguments(false));
    checkpoint();

    allowCalls(2);
    buyReader(1, USDT);
    expect(lastPayment().price).toBe(ONE_6 * 2);
  });
});

describe("Shop: promo codes", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SHOP);
    setTime(START);
    callAs(new Uint8Array(0));
    resetLedger();
    checkpoint();
    configure();
  });

  it("mints promo Ink once and records the campaign on the wallet", () => {
    const id = openPromo("LOOM-SPRING", 1000, 3000, 0, START, START + DAY);
    claim(ALICE, id, "LOOM-SPRING");
    const minted = decodeMint(mints()[0]);
    expect(minted.value).toBe(1000);
    expect(minted.reason).toBe(4);
    expect(minted.memo).toBe("campaign:1");
    expect(same(minted.to, ALICE)).toBe(true);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(id);

    const row = new Shop().get_campaign(new shop.get_campaign_arguments(id));
    expect(row.budget_used).toBe(1000);
    expect(row.code_hash!.length).toBe(32);
    checkpoint();

    failAccount = ALICE;
    failId = id;
    failCode = "LOOM-SPRING";
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(1000);
  });

  it("rejects a wrong code and still accepts the right one", () => {
    const id = openPromo("LOOM-SPRING", 1000, 3000, 0, START, START + DAY);
    failAccount = ALICE;
    failId = id;
    failCode = "LOOM-SUMMER";
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(0);
    claim(ALICE, id, "LOOM-SPRING");
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(id);
  });

  it("stops a claim that no longer fits in the budget", () => {
    const id = openPromo("LOOM", 1000, 2500, 2000, START, START + DAY * 3);
    claim(ALICE, id, "LOOM");
    checkpoint();
    claim(BOB, id, "LOOM");
    checkpoint();
    failAccount = CARA;
    failId = id;
    failCode = "LOOM";
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(CARA)).value).toBe(0);

    setTime(START + DAY);
    checkpoint();
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
  });

  it("lets a later day through when only the daily cap was hit", () => {
    const id = openPromo("LOOM", 1000, 5000, 1000, START, START + DAY * 3);
    claim(ALICE, id, "LOOM");
    checkpoint();
    failAccount = BOB;
    failId = id;
    failCode = "LOOM";
    expect(() => { failClaim(); }).toThrow();
    setTime(START + DAY);
    checkpoint();
    claim(BOB, id, "LOOM");
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).used_today).toBe(1000);
  });

  it("rejects a campaign that is off, not started, or finished", () => {
    authorize(SHOP);
    const c = new Shop();
    c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
    const id = c.create_campaign(new shop.create_campaign_arguments(
      "LOOM", 1000, 5000, 0, START + 10, START + 100, false, false
    )).value;
    checkpoint();
    failAccount = ALICE;
    failId = id;
    failCode = "LOOM";
    expect(() => { failClaim(); }).toThrow();

    authorize(SHOP);
    new Shop().set_campaign_enabled(new shop.set_campaign_enabled_arguments(id, true));
    checkpoint();
    expect(() => { failClaim(); }).toThrow();

    setTime(START + 10);
    checkpoint();
    claim(ALICE, id, "LOOM");
    checkpoint();

    setTime(START + 100);
    failAccount = BOB;
    failId = id;
    failCode = "LOOM";
    expect(() => { failClaim(); }).toThrow();
  });

  it("lets the admin extend the end and raise the budget, but not below what was used", () => {
    const id = openPromo("LOOM", 1000, 1000, 0, START, START + 50);
    claim(ALICE, id, "LOOM");
    checkpoint();
    failId = id;
    expect(() => { failShrinkBudget(); }).toThrow();
    new Shop().set_campaign_limits(new shop.set_campaign_limits_arguments(id, 2000, 0, START + 200));
    checkpoint();
    setTime(START + 80);
    claim(BOB, id, "LOOM");
    expect(new Shop().get_campaign(new shop.get_campaign_arguments(id)).budget_used).toBe(2000);
  });

  it("does nothing while the global promo switch is off", () => {
    authorize(SHOP);
    const id = new Shop().create_campaign(new shop.create_campaign_arguments(
      "LOOM", 1000, 5000, 0, START, START + DAY, false, true
    )).value;
    checkpoint();
    failAccount = ALICE;
    failId = id;
    failCode = "LOOM";
    expect(() => { failClaim(); }).toThrow();
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(0);
  });

  it("allows one promo claim per wallet across every campaign", () => {
    const first = openPromo("ONE", 1000, 5000, 0, START, START + DAY);
    authorize(SHOP);
    const second = new Shop().create_campaign(new shop.create_campaign_arguments(
      "TWO", 1000, 5000, 0, START, START + DAY, false, true
    )).value;
    checkpoint();
    claim(ALICE, first, "ONE");
    checkpoint();
    failAccount = ALICE;
    failId = second;
    failCode = "TWO";
    expect(() => { failClaim(); }).toThrow();
    claim(BOB, second, "TWO");
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(ALICE)).value).toBe(first);
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(BOB)).value).toBe(second);
  });

  it("spends a single-use code once and still blocks a second campaign for that wallet", () => {
    authorize(SHOP);
    const c = new Shop();
    c.set_promo_enabled(new shop.set_promo_enabled_arguments(true));
    const id = c.create_campaign(new shop.create_campaign_arguments(
      "", 1000, 5000, 0, START, START + DAY, true, true
    )).value;
    const codes: string[] = ["CODE-A", "CODE-B"];
    c.add_single_use_codes(new shop.add_single_use_codes_arguments(id, codes));
    checkpoint();

    claim(ALICE, id, "CODE-A");
    checkpoint();
    failAccount = BOB;
    failId = id;
    failCode = "CODE-A";
    expect(() => { failClaim(); }).toThrow();
    failAccount = ALICE;
    failCode = "CODE-B";
    expect(() => { failClaim(); }).toThrow();
    claim(BOB, id, "CODE-B");
    expect(new Shop().get_promo_claimed(new shop.get_promo_claimed_arguments(BOB)).value).toBe(id);

    failId = id;
    failCodes = codes;
    expect(() => { failAddCodes(); }).toThrow();
  });

  it("refuses single-use codes on a shared campaign", () => {
    const id = openPromo("LOOM", 1000, 5000, 0, START, START + DAY);
    const extra: string[] = ["EXTRA"];
    failId = id;
    failCodes = extra;
    expect(() => { failAddCodes(); }).toThrow();
  });
});
