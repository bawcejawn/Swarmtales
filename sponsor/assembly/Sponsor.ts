import { System, Storage, Protobuf, Crypto, Arrays, authority, value, protocol } from "@koinos/sdk-as";
import { sponsor } from "./proto/sponsor";

/**
 * SwarmTales mana sponsor. See assembly/proto/sponsor.proto for the rules.
 *
 * Uploaded onto a fresh account with ONLY the transaction-application
 * override on. Settings and moving KOIN out use the account's own key, as
 * for any wallet.
 */

const CONFIG_SPACE = 0;
const ACCOUNT_USAGE_SPACE = 1;
const TOTAL_USAGE_SPACE = 2;

const ADDRESS_LENGTH = 25;
const SIGNATURE_LENGTH = 65;
const MAX_TOKENS = 4;
const MAX_CALLS = 32;
const MAX_OPERATIONS = 10;
const MS_PER_DAY: u64 = 86400000;
/** KCS-4 approve entry point. */
export const APPROVE_ENTRY: u32 = 0x74e21680;
/** No cap may be above this (1,000 mana), so a typo can't open the tap. */
export const CAP_LIMIT: u64 = 100000000000;

export class Sponsor {
  contractId: Uint8Array = System.getContractId();

  config: Storage.Obj<sponsor.config> = new Storage.Obj(
    this.contractId,
    CONFIG_SPACE,
    sponsor.config.decode,
    sponsor.config.encode,
    () => new sponsor.config()
  );

  accountUsage: Storage.Map<Uint8Array, sponsor.usage> = new Storage.Map(
    this.contractId,
    ACCOUNT_USAGE_SPACE,
    sponsor.usage.decode,
    sponsor.usage.encode,
    () => new sponsor.usage()
  );

  totalUsage: Storage.Obj<sponsor.usage> = new Storage.Obj(
    this.contractId,
    TOTAL_USAGE_SPACE,
    sponsor.usage.decode,
    sponsor.usage.encode,
    () => new sponsor.usage()
  );

  /**
   * Called by the chain when a transaction names this account as payer.
   * Fails with a "SPONSOR: ..." message (so the site can tell and fall back
   * to the user's own mana) instead of returning false.
   */
  authorize(args: authority.authorize_arguments): authority.authorize_result {
    if (args.type != authority.authorization_type.transaction_application) {
      return new authority.authorize_result(false);
    }
    const signed = signatureAddresses();
    // The owner's own transactions (settings, top-ups, moving KOIN out).
    if (contains(signed, this.contractId)) return new authority.authorize_result(true);

    const cfg = this.config.get()!;
    System.require(cfg.enabled, "SPONSOR: switched off");

    const rcField = System.getTransactionField("header.rc_limit");
    const rcLimit: u64 = rcField ? rcField.uint64_value : 0;
    System.require(rcLimit > 0 && rcLimit <= cfg.max_mana_per_tx, "SPONSOR: mana limit above the per-transaction cap");

    const payeeField = System.getTransactionField("header.payee");
    const payee = payeeField && payeeField.bytes_value ? payeeField.bytes_value! : new Uint8Array(0);
    System.require(payee.length == ADDRESS_LENGTH, "SPONSOR: the transaction must name the user as payee");
    System.require(!Arrays.equal(payee, this.contractId), "SPONSOR: the sponsor can't be the payee");
    System.require(contains(signed, payee), "SPONSOR: the payee must sign");

    const tx = System.getTransaction();
    const ops = tx.operations;
    System.require(ops.length > 0 && ops.length <= MAX_OPERATIONS, "SPONSOR: 1 to 10 operations");
    for (let i = 0; i < ops.length; i++) {
      checkOperation(ops[i], cfg, payee);
    }

    const day = System.getHeadInfo().head_block_time / MS_PER_DAY;

    const mine = this.accountUsage.get(payee)!;
    const mineUsed: u64 = mine.day == day ? mine.used : 0;
    System.require(
      mineUsed <= cfg.max_mana_per_account_day && rcLimit <= cfg.max_mana_per_account_day - mineUsed,
      "SPONSOR: this account's daily sponsored mana is used up"
    );
    const all = this.totalUsage.get()!;
    const allUsed: u64 = all.day == day ? all.used : 0;
    System.require(
      allUsed <= cfg.max_mana_per_day && rcLimit <= cfg.max_mana_per_day - allUsed,
      "SPONSOR: today's sponsored mana is used up"
    );
    this.accountUsage.put(payee, new sponsor.usage(day, mineUsed + rcLimit));
    this.totalUsage.put(new sponsor.usage(day, allUsed + rcLimit));
    return new authority.authorize_result(true);
  }

  get_config(args: sponsor.get_config_arguments): sponsor.config {
    return this.config.get()!;
  }

  get_usage(args: sponsor.get_usage_arguments): sponsor.usage {
    System.require(args.account != null, "SPONSOR: account missing");
    return this.accountUsage.get(args.account!)!;
  }

  get_total_usage(args: sponsor.get_total_usage_arguments): sponsor.usage {
    return this.totalUsage.get()!;
  }

  set_config(args: sponsor.set_config_arguments): sponsor.empty_object {
    // Straight from the transaction: no contract code running inside a
    // transaction the sponsor key signed may change the settings (audit L-17).
    const caller = System.getCaller().caller;
    System.require(caller == null || caller.length == 0, "SPONSOR: call set_config directly from the transaction, not through another contract");
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, this.contractId),
      "SPONSOR: needs the sponsor account's own key"
    );
    System.require(args.config != null, "SPONSOR: config missing");
    const cfg = args.config!;
    System.require(isAddress(cfg.ink) && isAddress(cfg.shop) && isAddress(cfg.stories), "SPONSOR: invalid contract address");
    System.require(
      !Arrays.equal(cfg.ink, cfg.shop) && !Arrays.equal(cfg.ink, cfg.stories) && !Arrays.equal(cfg.shop, cfg.stories),
      "SPONSOR: Ink, Shop and Stories must differ"
    );
    System.require(cfg.tokens.length <= MAX_TOKENS, "SPONSOR: at most 4 payment tokens");
    for (let i = 0; i < cfg.tokens.length; i++) {
      const t = cfg.tokens[i];
      System.require(isAddress(t), "SPONSOR: invalid token address");
      System.require(
        !Arrays.equal(t, cfg.ink!) && !Arrays.equal(t, cfg.shop!) && !Arrays.equal(t, cfg.stories!) && !Arrays.equal(t, this.contractId),
        "SPONSOR: a token can't be a SwarmTales contract or the sponsor"
      );
      for (let j = 0; j < i; j++) System.require(!Arrays.equal(t, cfg.tokens[j]), "SPONSOR: duplicate token");
    }
    System.require(
      !Arrays.equal(cfg.ink!, this.contractId) && !Arrays.equal(cfg.shop!, this.contractId) && !Arrays.equal(cfg.stories!, this.contractId),
      "SPONSOR: the sponsor can't be a SwarmTales contract"
    );
    System.require(
      cfg.max_mana_per_tx <= cfg.max_mana_per_account_day && cfg.max_mana_per_account_day <= cfg.max_mana_per_day,
      "SPONSOR: caps must be per transaction <= per account per day <= per day"
    );
    System.require(cfg.max_mana_per_day <= CAP_LIMIT, "SPONSOR: daily cap above 1,000 mana");
    System.require(!cfg.enabled || cfg.max_mana_per_tx > 0, "SPONSOR: switched on with a zero cap");
    System.require(cfg.calls.length <= MAX_CALLS, "SPONSOR: at most 32 sponsored calls");
    System.require(!cfg.enabled || cfg.calls.length > 0, "SPONSOR: switched on with no sponsored calls");
    for (let i = 0; i < cfg.calls.length; i++) {
      const c = cfg.calls[i];
      System.require(
        c.contract != null && (Arrays.equal(c.contract!, cfg.ink!) || Arrays.equal(c.contract!, cfg.shop!) || Arrays.equal(c.contract!, cfg.stories!)),
        "SPONSOR: a sponsored call must be to Ink, Shop or Stories"
      );
      for (let j = 0; j < i; j++) {
        System.require(
          !(Arrays.equal(c.contract!, cfg.calls[j].contract!) && c.entry_point == cfg.calls[j].entry_point),
          "SPONSOR: duplicate sponsored call"
        );
      }
    }
    this.config.put(cfg);
    const ev = new sponsor.config_event(cfg);
    System.event("sponsor.config_event", Protobuf.encode(ev, sponsor.config_event.encode), [this.contractId]);
    return new sponsor.empty_object();
  }
}

/**
 * One operation is sponsored only if it is a listed SwarmTales entry point
 * (audit M-A: throwaway wallets could otherwise fill the daily cap with any
 * call, even a reverting one), or approves the Shop.
 */
function checkOperation(op: protocol.operation, cfg: sponsor.config, payee: Uint8Array): void {
  System.require(
    op.upload_contract == null && op.set_system_call == null && op.set_system_contract == null && op.call_contract != null,
    "SPONSOR: only contract calls are sponsored"
  );
  const call = op.call_contract!;
  System.require(call.contract_id != null, "SPONSOR: call without a contract");
  const target = call.contract_id!;
  if (Arrays.equal(target, cfg.ink!) || Arrays.equal(target, cfg.shop!) || Arrays.equal(target, cfg.stories!)) {
    System.require(listedCall(cfg.calls, target, call.entry_point), "SPONSOR: this call is not sponsored");
    return;
  }
  System.require(contains(cfg.tokens, target), "SPONSOR: only SwarmTales calls are sponsored");
  System.require(call.entry_point == APPROVE_ENTRY, "SPONSOR: only approve is sponsored on a payment token");
  const a = Protobuf.decode<sponsor.approve_args>(call.args ? call.args! : new Uint8Array(0), sponsor.approve_args.decode);
  System.require(a.spender != null && Arrays.equal(a.spender!, cfg.shop!), "SPONSOR: approve must name the Shop as spender");
  System.require(a.owner != null && Arrays.equal(a.owner!, payee), "SPONSOR: approve must be for the payee's own tokens");
}

/** A Koinos address: version 0, 20-byte hash, 4-byte double-sha256 checksum. */
function isAddress(a: Uint8Array | null): bool {
  if (a == null) return false;
  const b = a!;
  if (b.length != ADDRESS_LENGTH || b[0] != 0) return false;
  const once = System.hash(Crypto.multicodec.sha2_256, b.subarray(0, 21));
  if (!once) return false;
  const twice = System.hash(Crypto.multicodec.sha2_256, once.subarray(2));
  if (!twice) return false;
  for (let i = 0; i < 4; i++) {
    if (twice[2 + i] != b[21 + i]) return false;
  }
  return true;
}

function listedCall(calls: sponsor.sponsored_call[], contract: Uint8Array, entryPoint: u32): bool {
  for (let i = 0; i < calls.length; i++) {
    if (calls[i].entry_point == entryPoint && Arrays.equal(calls[i].contract!, contract)) return true;
  }
  return false;
}

function contains(list: Uint8Array[], item: Uint8Array): bool {
  for (let i = 0; i < list.length; i++) {
    if (Arrays.equal(list[i], item)) return true;
  }
  return false;
}

/** Addresses recovered from this transaction's signatures. */
function signatureAddresses(): Uint8Array[] {
  const out: Uint8Array[] = [];
  const field = System.getTransactionField("signatures");
  if (!field || !field.message_value) return out;
  const list = Protobuf.decode<value.list_type>(field.message_value!.value!, value.list_type.decode);
  const id = System.getTransactionField("id");
  if (!id || !id.bytes_value) return out;
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
