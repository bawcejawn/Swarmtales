// =====================================================================
// SwarmTales mana sponsor — tests
//
// The mock VM recovers real secp256k1 signatures, so these tests use
// signatures made by scripts/make-test-fixtures.js over fixed transaction
// ids, with test-only keys (never funded).
// =====================================================================

import { Arrays, Base58, MockVM, Protobuf, authority, chain, protocol } from "@koinos/sdk-as";
import { Sponsor, APPROVE_ENTRY } from "../Sponsor";
import { sponsor } from "../proto/sponsor";
import { F } from "./fixtures";

const SELF = Base58.decode(F.SELF);
const USER = Base58.decode(F.USER);
const OTHER = Base58.decode(F.OTHER);
const INK = Base58.decode("13Qrdvv3cXys9aryjZho6vHxDW3PRgX5pm");
const SHOP = Base58.decode("1MRxjnjFDhZfjtjgpxBNczsMGVEtYqfFyS");
const STORIES = Base58.decode("16adhn5XjJDJzs4oPv3MxnQuRpqv7PCJnt");
const USDT = Base58.decode("148HWBbRXQ82y4s7qjvEe5cCuPL47CW7r6");
const KOIN = Base58.decode("1Jykozr6Y5nZbwWvqSpnJPE1qoPn8PDBnn");
const STRANGER_CONTRACT = Base58.decode("1PJLazQ9eg25WRsBbcgVfc9ng2cR1cRT52");

const MANA: u64 = 100000000;
const DAY_MS: u64 = 86400000;
const T0: u64 = 1700000000000; // a head block time in ms
const BUY_PACK: u32 = 0x12345678; // a Shop entry point on the allow-list
const UNLISTED: u32 = 0x0badf00d; // an entry point that is not on it
const TRANSFER_ENTRY: u32 = 0x27f576ca;

// Closures aren't supported in AssemblyScript; tests build these, then call.
let OPS: protocol.operation[] = [];
let SIGNERS: string[] = [];
let PAYEE: Uint8Array | null = null;
let RC: u64 = 0;
let TX: i32 = 1;

function hex(s: string): Uint8Array {
  return Arrays.fromHexString(s);
}

function sig(name: string, tx: i32): Uint8Array {
  if (tx == 1) {
    if (name == "SELF") return hex(F.SIG_SELF_TX1);
    if (name == "USER") return hex(F.SIG_USER_TX1);
    if (name == "OTHER") return hex(F.SIG_OTHER_TX1);
  } else if (tx == 2) {
    if (name == "SELF") return hex(F.SIG_SELF_TX2);
    if (name == "USER") return hex(F.SIG_USER_TX2);
    if (name == "OTHER") return hex(F.SIG_OTHER_TX2);
  } else {
    if (name == "SELF") return hex(F.SIG_SELF_TX3);
    if (name == "USER") return hex(F.SIG_USER_TX3);
    if (name == "OTHER") return hex(F.SIG_OTHER_TX3);
  }
  throw new Error("no fixture " + name);
}

function txId(tx: i32): Uint8Array {
  return hex(tx == 1 ? F.TX1_ID : tx == 2 ? F.TX2_ID : F.TX3_ID);
}

function call(contract: Uint8Array, entry: u32, args: Uint8Array): protocol.operation {
  return new protocol.operation(null, new protocol.call_contract_operation(contract, entry, args));
}

function approve(token: Uint8Array, owner: Uint8Array, spender: Uint8Array): protocol.operation {
  const a = new sponsor.approve_args(owner, spender, 5000000);
  return call(token, APPROVE_ENTRY, Protobuf.encode(a, sponsor.approve_args.encode));
}

/** Put the transaction built from OPS/SIGNERS/PAYEE/RC/TX in the mock. */
function apply(): void {
  const t = new protocol.transaction();
  t.id = txId(TX);
  t.header = new protocol.transaction_header(null, RC, null, null, SELF, PAYEE);
  t.operations = OPS;
  const sigs: Uint8Array[] = [];
  for (let i = 0; i < SIGNERS.length; i++) sigs.push(sig(SIGNERS[i], TX));
  t.signatures = sigs;
  MockVM.setTransaction(t);
}

function pays(): bool {
  apply();
  return new Sponsor().authorize(new authority.authorize_arguments(authority.authorization_type.transaction_application)).value;
}

/** A normal sponsored buy by USER: approve the Shop, then buy. */
function userBuy(tx: i32, rc: u64): void {
  TX = tx;
  RC = rc;
  PAYEE = USER;
  SIGNERS = ["USER"];
  OPS = [approve(USDT, USER, SHOP), call(SHOP, BUY_PACK, new Uint8Array(0))];
}

function setDay(ms: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, ms, 0));
}

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

function asOwner(): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, SELF, true)]);
}

function listed(contract: Uint8Array, entry: u32): sponsor.sponsored_call {
  return new sponsor.sponsored_call(contract, entry);
}

function goodConfig(): sponsor.config {
  return new sponsor.config(true, INK, SHOP, STORIES, [USDT, KOIN], 10 * MANA, 30 * MANA, 100 * MANA,
    [listed(SHOP, BUY_PACK), listed(STORIES, 1), listed(INK, 2)]);
}

/** Called straight from the transaction: no calling contract. */
function direct(): void {
  MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
}

let CFG: sponsor.config = new sponsor.config();

function setConfig(): void {
  asOwner();
  new Sponsor().set_config(new sponsor.set_config_arguments(CFG));
}

function configure(): void {
  CFG = goodConfig();
  setConfig();
  MockVM.commitTransaction();
}

describe("sponsor settings", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SELF);
    direct();
    setDay(T0);
    MockVM.commitTransaction();
  });

  it("starts switched off and pays nothing for users", () => {
    userBuy(1, MANA);
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: switched off");
    expect(new Sponsor().get_config(new sponsor.get_config_arguments()).enabled).toBe(false);
  });

  it("saves settings with the sponsor's own key and emits them", () => {
    configure();
    const cfg = new Sponsor().get_config(new sponsor.get_config_arguments());
    expect(cfg.enabled).toBe(true);
    expect(Arrays.equal(cfg.shop!, SHOP)).toBe(true);
    expect(cfg.tokens.length).toBe(2);
    expect(cfg.max_mana_per_tx).toBe(10 * MANA);
    const events = MockVM.getEvents();
    expect(events[events.length - 1].name).toBe("sponsor.config_event");
  });

  it("refuses settings from anyone else", () => {
    MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, SELF, false)]);
    CFG = goodConfig();
    expect(() => { new Sponsor().set_config(new sponsor.set_config_arguments(CFG)); }).toThrow();
    errorIs("SPONSOR: needs the sponsor account's own key");
  });

  it("refuses caps out of order", () => {
    CFG = goodConfig();
    CFG.max_mana_per_tx = 40 * MANA;
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: caps must be per transaction <= per account per day <= per day");
  });

  it("refuses a daily cap above 1,000 mana", () => {
    CFG = goodConfig();
    CFG.max_mana_per_day = 1001 * MANA;
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: daily cap above 1,000 mana");
  });

  it("refuses switching on with a zero cap", () => {
    CFG = new sponsor.config(true, INK, SHOP, STORIES, [], 0, 0, 0);
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: switched on with a zero cap");
  });

  it("refuses a bad or repeated address", () => {
    CFG = goodConfig();
    CFG.ink = new Uint8Array(25);
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: invalid contract address");
  });

  it("refuses the same contract twice", () => {
    CFG = goodConfig();
    CFG.stories = SHOP;
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: Ink, Shop and Stories must differ");
  });

  it("refuses a token that is a SwarmTales contract", () => {
    CFG = goodConfig();
    CFG.tokens = [USDT, SHOP];
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: a token can't be a SwarmTales contract or the sponsor");
  });

  it("refuses a duplicate token and more than 4", () => {
    CFG = goodConfig();
    CFG.tokens = [USDT, USDT];
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: duplicate token");
  });

  it("refuses more than 4 tokens", () => {
    CFG = goodConfig();
    CFG.tokens = [USDT, KOIN, STRANGER_CONTRACT, OTHER, USER];
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: at most 4 payment tokens");
  });

  it("refuses itself as a SwarmTales contract", () => {
    CFG = goodConfig();
    CFG.ink = SELF;
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: the sponsor can't be a SwarmTales contract");
  });

  it("refuses switching on with no sponsored calls (audit M-A)", () => {
    CFG = goodConfig();
    CFG.calls = [];
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: switched on with no sponsored calls");
    // Switched off, an empty list is fine.
    CFG.enabled = false;
    setConfig();
    expect(new Sponsor().get_config(new sponsor.get_config_arguments()).calls.length).toBe(0);
  });

  it("refuses a sponsored call to anything but Ink, Shop or Stories, a duplicate, and more than 32 (audit M-A)", () => {
    CFG = goodConfig();
    CFG.calls = [listed(USDT, BUY_PACK)];
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: a sponsored call must be to Ink, Shop or Stories");
    CFG.calls = [listed(SHOP, BUY_PACK), listed(SHOP, BUY_PACK)];
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: duplicate sponsored call");
    const many: sponsor.sponsored_call[] = [];
    for (let i: u32 = 0; i < 33; i++) many.push(listed(SHOP, i + 1));
    CFG.calls = many;
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: at most 32 sponsored calls");
  });

  it("refuses settings from contract code inside a transaction the sponsor key signed (audit L-17)", () => {
    MockVM.setCaller(new chain.caller_data(STRANGER_CONTRACT, chain.privilege.user_mode));
    CFG = goodConfig();
    expect(() => { setConfig(); }).toThrow();
    errorIs("SPONSOR: call set_config directly from the transaction, not through another contract");
    expect(new Sponsor().get_config(new sponsor.get_config_arguments()).enabled).toBe(false);
  });

  it("can be switched off", () => {
    configure();
    CFG = goodConfig();
    CFG.enabled = false;
    setConfig();
    MockVM.commitTransaction();
    userBuy(1, MANA);
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: switched off");
  });
});

describe("sponsor pays", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SELF);
    direct();
    setDay(T0);
    MockVM.commitTransaction();
    configure();
  });

  // ---- audit M-A: only the listed entry points are sponsored ----

  it("refuses a call to an entry point that is not on the allow-list", () => {
    TX = 1; RC = MANA; PAYEE = USER; SIGNERS = ["USER"];
    OPS = [call(SHOP, UNLISTED, new Uint8Array(0))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: this call is not sponsored");
    expect(new Sponsor().get_total_usage(new sponsor.get_total_usage_arguments()).used).toBe(0);
  });

  it("refuses a listed entry point on another SwarmTales contract", () => {
    TX = 1; RC = MANA; PAYEE = USER; SIGNERS = ["USER"];
    OPS = [call(STORIES, BUY_PACK, new Uint8Array(0))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: this call is not sponsored");
  });

  it("refuses the whole transaction when one of its calls is not listed", () => {
    TX = 1; RC = MANA; PAYEE = USER; SIGNERS = ["USER"];
    OPS = [call(SHOP, BUY_PACK, new Uint8Array(0)), call(INK, UNLISTED, new Uint8Array(0))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: this call is not sponsored");
  });

  it("pays a user's buy and counts it", () => {
    userBuy(1, 5 * MANA);
    expect(pays()).toBe(true);
    const mine = new Sponsor().get_usage(new sponsor.get_usage_arguments(USER));
    expect(mine.used).toBe(5 * MANA);
    expect(mine.day).toBe(T0 / DAY_MS);
    expect(new Sponsor().get_total_usage(new sponsor.get_total_usage_arguments()).used).toBe(5 * MANA);
  });

  it("pays calls to Ink and Stories", () => {
    TX = 1; RC = MANA; PAYEE = USER; SIGNERS = ["USER"];
    OPS = [call(STORIES, 1, new Uint8Array(0)), call(INK, 2, new Uint8Array(0))];
    expect(pays()).toBe(true);
  });

  it("pays the owner's own transactions without counting them", () => {
    TX = 1; RC = 500 * MANA; PAYEE = null; SIGNERS = ["SELF"];
    OPS = [call(KOIN, TRANSFER_ENTRY, new Uint8Array(0))];
    expect(pays()).toBe(true);
    expect(new Sponsor().get_total_usage(new sponsor.get_total_usage_arguments()).used).toBe(0);
  });

  it("answers no for any other kind of authority", () => {
    userBuy(1, MANA);
    apply();
    expect(new Sponsor().authorize(new authority.authorize_arguments(authority.authorization_type.contract_call)).value).toBe(false);
    expect(new Sponsor().authorize(new authority.authorize_arguments(authority.authorization_type.contract_upload)).value).toBe(false);
  });

  it("needs the user named as payee", () => {
    userBuy(1, MANA);
    PAYEE = null;
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: the transaction must name the user as payee");
  });

  it("needs the payee's own signature", () => {
    userBuy(1, MANA);
    SIGNERS = ["OTHER"];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: the payee must sign");
  });

  it("ignores a payee signature made for another transaction", () => {
    userBuy(1, MANA);
    apply();
    const t = new protocol.transaction();
    t.id = txId(1);
    t.header = new protocol.transaction_header(null, MANA, null, null, SELF, USER);
    t.operations = OPS;
    t.signatures = [sig("USER", 2)];
    MockVM.setTransaction(t);
    expect(() => {
      new Sponsor().authorize(new authority.authorize_arguments(authority.authorization_type.transaction_application));
    }).toThrow();
    errorIs("SPONSOR: the payee must sign");
  });

  it("refuses the sponsor as payee", () => {
    userBuy(1, MANA);
    PAYEE = SELF;
    SIGNERS = ["USER"];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: the sponsor can't be the payee");
  });

  it("refuses a call to any other contract", () => {
    userBuy(1, MANA);
    OPS = [call(SHOP, BUY_PACK, new Uint8Array(0)), call(STRANGER_CONTRACT, 1, new Uint8Array(0))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: only SwarmTales calls are sponsored");
  });

  it("refuses a token transfer", () => {
    userBuy(1, MANA);
    OPS = [call(USDT, TRANSFER_ENTRY, new Uint8Array(0))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: only approve is sponsored on a payment token");
  });

  it("refuses an approve for anyone but the Shop", () => {
    userBuy(1, MANA);
    OPS = [approve(USDT, USER, STORIES)];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: approve must name the Shop as spender");
  });

  it("refuses an approve of someone else's tokens", () => {
    userBuy(1, MANA);
    OPS = [approve(USDT, OTHER, SHOP)];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: approve must be for the payee's own tokens");
  });

  it("refuses an approve on a token that isn't listed", () => {
    userBuy(1, MANA);
    OPS = [approve(STRANGER_CONTRACT, USER, SHOP)];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: only SwarmTales calls are sponsored");
  });

  it("refuses an upload", () => {
    userBuy(1, MANA);
    OPS = [new protocol.operation(new protocol.upload_contract_operation(USER, new Uint8Array(4)))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: only contract calls are sponsored");
  });

  it("refuses no operations and more than 10", () => {
    userBuy(1, MANA);
    OPS = [];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: 1 to 10 operations");
  });

  it("refuses 11 operations", () => {
    userBuy(1, MANA);
    OPS = [];
    for (let i = 0; i < 11; i++) OPS.push(call(SHOP, BUY_PACK, new Uint8Array(0)));
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: 1 to 10 operations");
  });

  it("refuses a mana limit above the per-transaction cap, or zero", () => {
    userBuy(1, 10 * MANA + 1);
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: mana limit above the per-transaction cap");
  });

  it("refuses a zero mana limit", () => {
    userBuy(1, 0);
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: mana limit above the per-transaction cap");
  });

  it("stops at the per-account daily cap and starts again the next day", () => {
    userBuy(1, 10 * MANA);
    expect(pays()).toBe(true);
    MockVM.commitTransaction();
    userBuy(2, 10 * MANA);
    expect(pays()).toBe(true);
    MockVM.commitTransaction();
    userBuy(3, 10 * MANA);
    expect(pays()).toBe(true);
    MockVM.commitTransaction();
    userBuy(1, MANA);
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: this account's daily sponsored mana is used up");
    setDay(T0 + DAY_MS);
    MockVM.commitTransaction();
    userBuy(1, MANA);
    expect(pays()).toBe(true);
    expect(new Sponsor().get_usage(new sponsor.get_usage_arguments(USER)).used).toBe(MANA);
  });

  it("stops at the daily cap for everyone", () => {
    CFG = goodConfig();
    CFG.max_mana_per_day = 35 * MANA;
    setConfig();
    MockVM.commitTransaction();
    for (let i = 1; i <= 3; i++) {
      userBuy(i, 10 * MANA);
      expect(pays()).toBe(true);
      MockVM.commitTransaction();
    }
    TX = 1; RC = 10 * MANA; PAYEE = OTHER; SIGNERS = ["OTHER"];
    OPS = [call(STORIES, 1, new Uint8Array(0))];
    expect(() => { pays(); }).toThrow();
    errorIs("SPONSOR: today's sponsored mana is used up");
    RC = 5 * MANA;
    expect(pays()).toBe(true);
    expect(new Sponsor().get_total_usage(new sponsor.get_total_usage_arguments()).used).toBe(35 * MANA);
  });
});
