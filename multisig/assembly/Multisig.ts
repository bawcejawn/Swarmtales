import { System, Storage, Protobuf, Crypto, Arrays, authority, value } from "@koinos/sdk-as";
import { multisig } from "./proto/multisig";

/**
 * SwarmTales multisig wallet. See assembly/proto/multisig.proto for the rules.
 *
 * Uploaded onto a fresh account with all three authority overrides on. The
 * deploy tool sends the upload and `setup` in ONE transaction, so there is
 * no moment where the account exists without signers.
 */

const CONFIG_SPACE = 0;

export const MIN_SIGNERS = 2;
export const MAX_SIGNERS = 10;
const ADDRESS_LENGTH = 25;
const SIGNATURE_LENGTH = 65;

export class Multisig {
  contractId: Uint8Array = System.getContractId();

  config: Storage.Obj<multisig.config> = new Storage.Obj(
    this.contractId,
    CONFIG_SPACE,
    multisig.config.decode,
    multisig.config.encode,
    () => new multisig.config()
  );

  /**
   * Called by the chain only. Before setup nothing is authorized. After
   * setup every kind of authority (calls, paying for a transaction,
   * replacing this code) needs `threshold` distinct current signers.
   */
  authorize(args: authority.authorize_arguments): authority.authorize_result {
    const cfg = this.config.get()!;
    if (cfg.threshold == 0) return new authority.authorize_result(false);
    if (
      args.type != authority.authorization_type.contract_call &&
      args.type != authority.authorization_type.transaction_application &&
      args.type != authority.authorization_type.contract_upload
    ) {
      return new authority.authorize_result(false);
    }
    return new authority.authorize_result(countSigners(cfg.signers) >= cfg.threshold);
  }

  get_config(args: multisig.get_config_arguments): multisig.config {
    return this.config.get()!;
  }

  /**
   * First signers. Once only, and only with this account's own key on the
   * transaction (checked from the signatures directly, because the account's
   * call authority is already handed to `authorize`).
   */
  setup(args: multisig.setup_arguments): multisig.empty_object {
    const cfg = this.config.get()!;
    System.require(cfg.threshold == 0, "MULTISIG: already set up");
    System.require(signedBy(this.contractId), "MULTISIG: setup must be signed by this account's own key");
    this.save(args.signers, args.threshold);
    return new multisig.empty_object();
  }

  /**
   * New signers or threshold. Needs the current quorum. With two of three
   * signers, this replaces a lost or leaked third one.
   */
  set_signers(args: multisig.set_signers_arguments): multisig.empty_object {
    const cfg = this.config.get()!;
    System.require(cfg.threshold > 0, "MULTISIG: not set up");
    System.require(countSigners(cfg.signers) >= cfg.threshold, "MULTISIG: not enough signers signed");
    this.save(args.signers, args.threshold);
    return new multisig.empty_object();
  }

  private save(signers: Uint8Array[], threshold: u32): void {
    validate(signers, threshold, this.contractId);
    const cfg = new multisig.config(signers, threshold);
    this.config.put(cfg);
    const ev = new multisig.signers_event(signers, threshold);
    System.event("multisig.signers_event", Protobuf.encode(ev, multisig.signers_event.encode), signers);
  }
}

/** The rules for a signer list. Exported for the tests. */
export function validate(signers: Uint8Array[], threshold: u32, self: Uint8Array): void {
  const n = signers.length;
  System.require(n >= MIN_SIGNERS && n <= MAX_SIGNERS, "MULTISIG: use 2 to 10 signers");
  System.require(threshold >= 2 && threshold <= <u32>n, "MULTISIG: threshold must be at least 2 and at most the number of signers");
  for (let i = 0; i < n; i++) {
    const s = signers[i];
    System.require(isAddress(s), "MULTISIG: invalid signer address");
    System.require(!Arrays.equal(s, self), "MULTISIG: the multisig can't be its own signer");
    for (let j = 0; j < i; j++) {
      System.require(!Arrays.equal(s, signers[j]), "MULTISIG: duplicate signer");
    }
  }
}

/** A Koinos address: version 0, 20-byte hash, 4-byte double-sha256 checksum. */
function isAddress(a: Uint8Array): bool {
  if (a.length != ADDRESS_LENGTH || a[0] != 0) return false;
  const once = System.hash(Crypto.multicodec.sha2_256, a.subarray(0, 21));
  if (!once) return false;
  const twice = System.hash(Crypto.multicodec.sha2_256, once.subarray(2));
  if (!twice) return false;
  // System.hash returns a multihash: 2 prefix bytes, then the digest.
  for (let i = 0; i < 4; i++) {
    if (twice[2 + i] != a[21 + i]) return false;
  }
  return true;
}

/** Addresses recovered from this transaction's signatures. */
function signatureAddresses(): Uint8Array[] {
  const out: Uint8Array[] = [];
  const field = System.getTransactionField("signatures");
  if (!field || !field.message_value) return out;
  const list = Protobuf.decode<value.list_type>(field.message_value!.value!, value.list_type.decode);
  const id = System.getTransactionField("id");
  if (!id) return out;
  if (!id.bytes_value) return out;
  const txId = id.bytes_value!;
  for (let i = 0; i < list.values.length; i++) {
    const raw = list.values[i].bytes_value;
    if (!raw || raw.length != SIGNATURE_LENGTH) continue;
    // The chain throws on a signature it can't recover a key from, which
    // fails the whole transaction, so there is no "skip it" case here.
    out.push(Crypto.addressFromPublicKey(System.recoverPublicKey(raw, txId)!));
  }
  return out;
}

/** How many DISTINCT addresses in `signers` signed this transaction. */
export function countSigners(signers: Uint8Array[]): u32 {
  const signed = signatureAddresses();
  let count: u32 = 0;
  for (let i = 0; i < signers.length; i++) {
    for (let j = 0; j < signed.length; j++) {
      if (Arrays.equal(signers[i], signed[j])) {
        count++;
        break;
      }
    }
  }
  return count;
}

function signedBy(account: Uint8Array): bool {
  const signed = signatureAddresses();
  for (let j = 0; j < signed.length; j++) {
    if (Arrays.equal(account, signed[j])) return true;
  }
  return false;
}
