// =====================================================================
// SwarmTales multisig — tests
//
// The mock VM recovers real secp256k1 signatures, so these tests use
// signatures made by scripts/make-test-fixtures.js over fixed transaction
// ids, with test-only keys (never funded).
// =====================================================================

import { Arrays, Base58, MockVM, authority, chain, protocol } from "@koinos/sdk-as";
import { Multisig } from "../Multisig";
import { multisig } from "../proto/multisig";
import { F } from "./fixtures";

const SELF = Base58.decode(F.SELF);
const A = Base58.decode(F.A);
const B = Base58.decode(F.B);
const C = Base58.decode(F.C);
const D = Base58.decode(F.D);
const OUTSIDER = Base58.decode(F.OUTSIDER);

// Closures aren't supported in AssemblyScript, so lists built inside a test go here.
let LIST: Uint8Array[] = [];

function hex(s: string): Uint8Array {
  return Arrays.fromHexString(s);
}

function sig(name: string, tx: i32): Uint8Array {
  // Kept as a switch so a typo fails loudly.
  if (tx == 1) {
    if (name == "A") return hex(F.SIG_A_TX1);
    if (name == "B") return hex(F.SIG_B_TX1);
    if (name == "C") return hex(F.SIG_C_TX1);
    if (name == "D") return hex(F.SIG_D_TX1);
    if (name == "SELF") return hex(F.SIG_SELF_TX1);
    if (name == "OUTSIDER") return hex(F.SIG_OUTSIDER_TX1);
  } else if (tx == 2) {
    if (name == "A") return hex(F.SIG_A_TX2);
    if (name == "B") return hex(F.SIG_B_TX2);
    if (name == "C") return hex(F.SIG_C_TX2);
    if (name == "D") return hex(F.SIG_D_TX2);
    if (name == "SELF") return hex(F.SIG_SELF_TX2);
    if (name == "OUTSIDER") return hex(F.SIG_OUTSIDER_TX2);
  } else {
    if (name == "A") return hex(F.SIG_A_TX3);
    if (name == "B") return hex(F.SIG_B_TX3);
    if (name == "C") return hex(F.SIG_C_TX3);
    if (name == "SELF") return hex(F.SIG_SELF_TX3);
  }
  throw new Error("no fixture " + name + " " + tx.toString());
}

function txId(tx: i32): Uint8Array {
  return hex(tx == 1 ? F.TX1_ID : tx == 2 ? F.TX2_ID : F.TX3_ID);
}

/** The transaction now being applied: id `tx`, signed by `names`. */
function signedBy(tx: i32, names: string[]): void {
  const t = new protocol.transaction();
  t.id = txId(tx);
  const sigs: Uint8Array[] = [];
  for (let i = 0; i < names.length; i++) sigs.push(sig(names[i], tx));
  t.signatures = sigs;
  MockVM.setTransaction(t);
}

/** A signature over the WRONG transaction id (TX2's signature on TX1). */
function signedWithStale(tx: i32, names: string[]): void {
  const t = new protocol.transaction();
  t.id = txId(tx);
  const sigs: Uint8Array[] = [];
  for (let i = 0; i < names.length; i++) sigs.push(sig(names[i], tx == 1 ? 2 : 1));
  t.signatures = sigs;
  MockVM.setTransaction(t);
}

function errorIs(message: string): void {
  expect(MockVM.getErrorMessage()).toBe(message);
  MockVM.rollbackTransaction();
}

/**
 * What the chain passes: for a call, which contract asks (Stories here) and
 * who called it (nobody: the operation called Stories straight from the
 * transaction).
 */
function auth(type: authority.authorization_type): bool {
  const call = type == authority.authorization_type.contract_call ? new authority.call_data(OUTSIDER) : null;
  return new Multisig().authorize(new authority.authorize_arguments(type, call)).value;
}

/** Contract code (OUTSIDER) is now running: the next calls come from it. */
function calledByContract(): void {
  MockVM.setCaller(new chain.caller_data(OUTSIDER, chain.privilege.user_mode));
}

function setUp2of3(): void {
  signedBy(1, ["SELF"]);
  new Multisig().setup(new multisig.setup_arguments([A, B, C], 2));
  MockVM.commitTransaction();
}

describe("multisig", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(SELF);
    // Called straight from the transaction: no calling contract.
    MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
    MockVM.commitTransaction(); // so a rollback after an error keeps the contract id
  });

  it("authorizes nothing before setup, even the account's own key", () => {
    signedBy(1, ["SELF", "A", "B", "C"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
    expect(auth(authority.authorization_type.transaction_application)).toBe(false);
    expect(auth(authority.authorization_type.contract_upload)).toBe(false);
    const cfg = new Multisig().get_config(new multisig.get_config_arguments());
    expect(cfg.threshold).toBe(0);
    expect(cfg.signers.length).toBe(0);
  });

  it("sets up once with the account's own key and emits the signers", () => {
    setUp2of3();
    const cfg = new Multisig().get_config(new multisig.get_config_arguments());
    expect(cfg.threshold).toBe(2);
    expect(cfg.signers.length).toBe(3);
    expect(Arrays.equal(cfg.signers[0], A)).toBe(true);
    expect(Arrays.equal(cfg.signers[2], C)).toBe(true);
    const events = MockVM.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("multisig.signers_event");
    expect(events[0].impacted.length).toBe(3);
  });

  it("refuses setup without the account's own key", () => {
    signedBy(1, ["A", "B", "C"]);
    expect(() => {
      new Multisig().setup(new multisig.setup_arguments([A, B, C], 2));
    }).toThrow();
    errorIs("MULTISIG: setup must be signed by this account's own key");
  });

  it("refuses a second setup, even with the account's own key", () => {
    setUp2of3();
    signedBy(2, ["SELF"]);
    expect(() => {
      new Multisig().setup(new multisig.setup_arguments([A, B, OUTSIDER], 2));
    }).toThrow();
    errorIs("MULTISIG: already set up");
    expect(new Multisig().get_config(new multisig.get_config_arguments()).signers.length).toBe(3);
  });

  it("needs 2 to 10 signers", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A], 1)); }).toThrow();
    errorIs("MULTISIG: use 3 to 10 signers");
  });

  it("refuses 2 signers (2 of 2 would lock with one lost key)", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, B], 2)); }).toThrow();
    errorIs("MULTISIG: use 3 to 10 signers");
  });

  it("refuses 11 signers", () => {
    signedBy(1, ["SELF"]);
    LIST = [A, B, C, D, OUTSIDER, A, B, C, D, OUTSIDER, A];
    expect(() => { new Multisig().setup(new multisig.setup_arguments(LIST, 2)); }).toThrow();
    errorIs("MULTISIG: use 3 to 10 signers");
  });

  it("refuses a threshold of 1", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, B, C], 1)); }).toThrow();
    errorIs("MULTISIG: threshold must be at least 2 and less than the number of signers");
  });

  it("refuses a threshold above the number of signers", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, B, C], 4)); }).toThrow();
    errorIs("MULTISIG: threshold must be at least 2 and less than the number of signers");
  });

  it("refuses a duplicate signer", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, B, A], 2)); }).toThrow();
    errorIs("MULTISIG: duplicate signer");
  });

  it("refuses itself as a signer", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, SELF, C], 2)); }).toThrow();
    errorIs("MULTISIG: the multisig can't be its own signer");
  });

  it("refuses a blank address", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, new Uint8Array(25), C], 2)); }).toThrow();
    errorIs("MULTISIG: invalid signer address");
  });

  it("refuses a short address", () => {
    signedBy(1, ["SELF"]);
    expect(() => { new Multisig().setup(new multisig.setup_arguments([A, new Uint8Array(20), C], 2)); }).toThrow();
    errorIs("MULTISIG: invalid signer address");
  });

  it("refuses an address with a typo (bad checksum)", () => {
    signedBy(1, ["SELF"]);
    const bad = Base58.decode(F.D);
    bad[24] = bad[24] ^ 1;
    LIST = [A, bad, C];
    expect(() => { new Multisig().setup(new multisig.setup_arguments(LIST, 2)); }).toThrow();
    errorIs("MULTISIG: invalid signer address");
    expect(new Multisig().get_config(new multisig.get_config_arguments()).threshold).toBe(0);
  });

  it("authorizes calls, paying and uploads with 2 of 3 signers", () => {
    setUp2of3();
    signedBy(2, ["A", "C"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(true);
    expect(auth(authority.authorization_type.transaction_application)).toBe(true);
    expect(auth(authority.authorization_type.contract_upload)).toBe(true);
    signedBy(2, ["B", "C", "A"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(true);
  });

  it("refuses one signer, the account's own key, and outsiders", () => {
    setUp2of3();
    signedBy(2, ["A"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
    expect(auth(authority.authorization_type.transaction_application)).toBe(false);
    expect(auth(authority.authorization_type.contract_upload)).toBe(false);
    signedBy(2, ["SELF", "A"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
    signedBy(2, ["A", "OUTSIDER", "D"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
    signedBy(2, []);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
  });

  it("counts a signer once even if their signature is repeated", () => {
    setUp2of3();
    signedBy(2, ["A", "A", "A"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
  });

  it("ignores signatures made for another transaction", () => {
    setUp2of3();
    signedWithStale(1, ["A", "B"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
  });

  it("ignores signatures that aren't 65 bytes", () => {
    setUp2of3();
    const t = new protocol.transaction();
    t.id = txId(2);
    t.signatures = [sig("A", 2), new Uint8Array(64), new Uint8Array(0)];
    MockVM.setTransaction(t);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
  });

  it("replaces a lost signer with two of the others and the new signer", () => {
    setUp2of3();
    signedBy(2, ["A", "B", "D"]);
    new Multisig().set_signers(new multisig.set_signers_arguments([A, B, D], 2));
    MockVM.commitTransaction();
    signedBy(3, ["A", "C"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
    // D's fixture exists only for TX1/TX2; A+B still work.
    signedBy(3, ["A", "B"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(true);
    const cfg = new Multisig().get_config(new multisig.get_config_arguments());
    expect(Arrays.equal(cfg.signers[2], D)).toBe(true);
    const events = MockVM.getEvents();
    expect(events[events.length - 1].name).toBe("multisig.signers_event");
  });

  it("refuses set_signers with one signer or the account's own key", () => {
    setUp2of3();
    signedBy(2, ["A", "SELF"]);
    expect(() => {
      new Multisig().set_signers(new multisig.set_signers_arguments([A, OUTSIDER], 2));
    }).toThrow();
    errorIs("MULTISIG: not enough signers signed");
    expect(new Multisig().get_config(new multisig.get_config_arguments()).signers.length).toBe(3);
  });

  it("refuses set_signers before setup", () => {
    signedBy(1, ["SELF", "A", "B"]);
    expect(() => {
      new Multisig().set_signers(new multisig.set_signers_arguments([A, B], 2));
    }).toThrow();
    errorIs("MULTISIG: not set up");
  });

  it("set_signers applies the same list rules", () => {
    setUp2of3();
    signedBy(2, ["A", "B"]);
    expect(() => {
      new Multisig().set_signers(new multisig.set_signers_arguments([A, B, C], 1));
    }).toThrow();
    errorIs("MULTISIG: threshold must be at least 2 and less than the number of signers");
    expect(new Multisig().get_config(new multisig.get_config_arguments()).threshold).toBe(2);
  });

  it("refuses a threshold equal to the number of signers (3 of 3)", () => {
    setUp2of3();
    signedBy(2, ["A", "B"]);
    expect(() => {
      new Multisig().set_signers(new multisig.set_signers_arguments([A, B, C], 3));
    }).toThrow();
    errorIs("MULTISIG: threshold must be at least 2 and less than the number of signers");
    expect(new Multisig().get_config(new multisig.get_config_arguments()).threshold).toBe(2);
  });

  it("can raise the threshold to 3 of 4, with the new signer signing", () => {
    setUp2of3();
    signedBy(2, ["A", "B", "D"]);
    new Multisig().set_signers(new multisig.set_signers_arguments([A, B, C, D], 3));
    MockVM.commitTransaction();
    signedBy(3, ["A", "B"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(false);
    signedBy(3, ["A", "B", "C"]);
    expect(auth(authority.authorization_type.contract_call)).toBe(true);
  });

  // ---- audit L-16: a new signer proves they hold the key ----

  it("refuses set_signers when a new signer has not signed", () => {
    setUp2of3();
    signedBy(2, ["A", "B", "C"]);
    expect(() => {
      new Multisig().set_signers(new multisig.set_signers_arguments([A, B, D], 2));
    }).toThrow();
    errorIs("MULTISIG: every new signer must sign");
    expect(Arrays.equal(new Multisig().get_config(new multisig.get_config_arguments()).signers[2], C)).toBe(true);
  });

  it("does not need the removed signer to sign", () => {
    setUp2of3();
    signedBy(2, ["A", "D", "B"]);
    LIST = [A, D, B];
    new Multisig().set_signers(new multisig.set_signers_arguments(LIST, 2));
    expect(new Multisig().get_config(new multisig.get_config_arguments()).signers.length).toBe(3);
  });

  // ---- audit H-1: only a request straight from the transaction counts ----

  it("refuses a call request from a contract that another contract called", () => {
    setUp2of3();
    signedBy(2, ["A", "B", "C"]);
    const call = new authority.call_data(OUTSIDER, 0, D);
    const args = new authority.authorize_arguments(authority.authorization_type.contract_call, call);
    expect(new Multisig().authorize(args).value).toBe(false);
    // The same request from a contract called by the transaction itself is fine.
    const direct = new authority.authorize_arguments(authority.authorization_type.contract_call, new authority.call_data(OUTSIDER));
    expect(new Multisig().authorize(direct).value).toBe(true);
  });

  it("refuses a call request that says nothing about the call", () => {
    setUp2of3();
    signedBy(2, ["A", "B", "C"]);
    const args = new authority.authorize_arguments(authority.authorization_type.contract_call);
    expect(new Multisig().authorize(args).value).toBe(false);
  });

  it("refuses set_signers called by another contract, even with every signature", () => {
    setUp2of3();
    signedBy(2, ["A", "B", "C", "OUTSIDER"]);
    calledByContract();
    LIST = [A, B, OUTSIDER];
    expect(() => {
      new Multisig().set_signers(new multisig.set_signers_arguments(LIST, 2));
    }).toThrow();
    errorIs("MULTISIG: call the multisig directly from the transaction, not through another contract");
    expect(Arrays.equal(new Multisig().get_config(new multisig.get_config_arguments()).signers[2], C)).toBe(true);
  });

  it("refuses setup called by another contract", () => {
    signedBy(1, ["SELF"]);
    calledByContract();
    expect(() => {
      new Multisig().setup(new multisig.setup_arguments([A, B, C], 2));
    }).toThrow();
    errorIs("MULTISIG: call the multisig directly from the transaction, not through another contract");
    expect(new Multisig().get_config(new multisig.get_config_arguments()).threshold).toBe(0);
  });
});
