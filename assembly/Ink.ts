// =====================================================================
// SwarmTales Ink — smart contract (AssemblyScript, Koinos SDK)
//
// WHAT THIS CONTRACT DOES
//   - Keeps every account's Ink balance and the total supply.
//   - Lets ONLY approved SwarmTales contracts create Ink (mint), and only
//     for the reasons each one is allowed (e.g. the Stories contract may
//     only mint REFUNDs).
//   - Lets ONLY approved SwarmTales contracts use up Ink (burn), and only
//     when the owner signed the transaction. Precisely (audit C1-08): an
//     approved burner can burn any amount of a wallet's Ink in any
//     transaction that wallet signed and that reaches the burner. Ink trusts
//     each approved burner (today only Stories) to burn only what its own
//     rules charge; Stories is called only directly (fix H1), so another
//     app's transaction can't reach it.
//   - Has NO transfer, approve or allowance functions. Ink can never be
//     sent, sold or traded. It is a writing allowance with no cash value.
//   - Has NO maximum supply. That is a decided rule, not a placeholder.
//     Minting stops when the admin pauses, or when the amount would
//     overflow a 64-bit total.
//   - Publishes a public event for every mint, burn and admin change.
//
// WHAT THE ADMIN CAN DO
//   - Approve/remove minter and burner contracts, pause, hand over admin.
// WHAT THE ADMIN CANNOT DO
//   - Mint Ink directly, move anyone's Ink, or burn anyone's Ink.
// =====================================================================

import { System, Storage, authority, Protobuf, SafeMath, Arrays } from "@koinos/sdk-as";
import { ink } from "./proto/ink";

// Each kind of stored data lives in its own numbered "space".
const SUPPLY_SPACE_ID: u32 = 0;
const BALANCES_SPACE_ID: u32 = 1;
const MINTERS_SPACE_ID: u32 = 2;
const BURNERS_SPACE_ID: u32 = 3;
const CONFIG_SPACE_ID: u32 = 4;

// Fixed token details. "SwarmTales Ink" is the final display name.
const NAME = "SwarmTales Ink";
const SYMBOL = "INK";
const DECIMALS: u32 = 0; // whole numbers only. Story text is not counted here.
const DESCRIPTION =
  "Non-transferable writing allowance for SwarmTales. 1 INK per text unit; most emoji cost 2. No cash value. Creative use only.";

const MAX_MEMO_LENGTH: i32 = 64;
const ADDRESS_LENGTH: i32 = 25; // Koinos addresses are 25 bytes

// Highest valid mint reason number (MINT_REFUND = 5).
const MAX_MINT_REASON: i32 = 5;

export class Ink {
  contractId: Uint8Array;
  supply: Storage.Obj<ink.uint64>;
  balances: Storage.Map<Uint8Array, ink.uint64>;
  minters: Storage.Map<Uint8Array, ink.uint32>;
  burners: Storage.Map<Uint8Array, ink.boole>;
  config: Storage.Obj<ink.config>;

  constructor() {
    this.contractId = System.getContractId();

    this.supply = new Storage.Obj(
      this.contractId,
      SUPPLY_SPACE_ID,
      ink.uint64.decode,
      ink.uint64.encode,
      () => new ink.uint64(0)
    );

    this.balances = new Storage.Map(
      this.contractId,
      BALANCES_SPACE_ID,
      ink.uint64.decode,
      ink.uint64.encode,
      () => new ink.uint64(0)
    );

    this.minters = new Storage.Map(
      this.contractId,
      MINTERS_SPACE_ID,
      ink.uint32.decode,
      ink.uint32.encode,
      () => new ink.uint32(0)
    );

    this.burners = new Storage.Map(
      this.contractId,
      BURNERS_SPACE_ID,
      ink.boole.decode,
      ink.boole.encode,
      () => new ink.boole(false)
    );

    this.config = new Storage.Obj(
      this.contractId,
      CONFIG_SPACE_ID,
      ink.config.decode,
      ink.config.encode,
      () => new ink.config(new Uint8Array(0), false)
    );
  }

  // ===================================================================
  // Read-only functions
  // ===================================================================

  name(args: ink.name_arguments): ink.str {
    return new ink.str(NAME);
  }

  symbol(args: ink.symbol_arguments): ink.str {
    return new ink.str(SYMBOL);
  }

  decimals(args: ink.decimals_arguments): ink.uint32 {
    return new ink.uint32(DECIMALS);
  }

  get_info(args: ink.get_info_arguments): ink.info {
    return new ink.info(NAME, SYMBOL, DECIMALS, DESCRIPTION);
  }

  total_supply(args: ink.total_supply_arguments): ink.uint64 {
    return this.supply.get()!;
  }

  balance_of(args: ink.balance_of_arguments): ink.uint64 {
    // A missing address is not an account, so it has no Ink.
    if (args.owner == null) return new ink.uint64(0);
    return this.balances.get(args.owner!)!;
  }

  get_minter_reasons(args: ink.get_minter_reasons_arguments): ink.uint32 {
    if (args.account == null) return new ink.uint32(0);
    return this.minters.get(args.account!)!;
  }

  is_burner(args: ink.is_burner_arguments): ink.boole {
    if (args.account == null) return new ink.boole(false);
    return this.burners.get(args.account!)!;
  }

  get_config(args: ink.get_config_arguments): ink.config {
    const cfg = this.config.get()!;
    return new ink.config(this.getAdmin(), cfg.paused, cfg.pending_admin);
  }

  // ===================================================================
  // Mint: create Ink (approved SwarmTales contracts only)
  // ===================================================================

  mint(args: ink.mint_arguments): ink.empty_object {
    const cfg = this.config.get()!;
    System.require(!cfg.paused, "INK: minting is paused");
    const to = this.requireAddress(args.to, "INK: invalid recipient address");
    System.require(args.value > 0, "INK: amount must be greater than zero");
    const memo = this.memoText(args.memo);

    const reasonNumber = <i32>args.reason;
    System.require(
      reasonNumber >= 1 && reasonNumber <= MAX_MINT_REASON,
      "INK: invalid mint reason"
    );

    // Who is calling? A user calling directly has no calling contract,
    // so they can never mint. Only an approved contract can.
    const caller = this.requireCaller("INK: mint must come from an approved contract");

    // Is this contract allowed to mint for THIS reason?
    const allowedMask = this.minters.get(caller)!.value;
    const reasonBit: u32 = (<u32>1) << (<u32>reasonNumber);
    System.require((allowedMask & reasonBit) != 0, "INK: caller is not allowed to mint for this reason");

    // Update supply and balance. There is no supply cap. SafeMath stops overflow.
    const supply = this.supply.get()!;
    supply.value = SafeMath.add(supply.value, args.value);
    this.supply.put(supply);

    const balance = this.balances.get(to)!;
    balance.value = SafeMath.add(balance.value, args.value);
    this.balances.put(to, balance);

    // Public record.
    const event = new ink.mint_event(to, args.value, args.reason, memo, caller);
    System.event("ink.mint_event", Protobuf.encode(event, ink.mint_event.encode), [to]);

    return new ink.empty_object();
  }

  // ===================================================================
  // Burn: use up Ink (approved contract + owner's signature required)
  // ===================================================================

  burn(args: ink.burn_arguments): ink.empty_object {
    const cfg = this.config.get()!;
    System.require(!cfg.paused, "INK: burning is paused");
    const from = this.requireAddress(args.from, "INK: invalid owner address");
    System.require(args.value > 0, "INK: amount must be greater than zero");
    const memo = this.memoText(args.memo);

    // Only BURN_CONTRIBUTION (1). Reason 2 is reserved and must fail.
    const reasonNumber = <i32>args.reason;
    System.require(reasonNumber == 1, "INK: invalid burn reason");

    // Only an approved SwarmTales contract may burn.
    const caller = this.requireCaller("INK: burn must come from an approved contract");
    System.require(this.burners.get(caller)!.value, "INK: caller is not an approved burner");

    // The owner must have authorized this transaction (signed it).
    // contract_call is the only authority a user contract is allowed to ask for.
    // It checks the owner's signature, or their own authority contract if they have one.
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, from),
      "INK: owner has not authorized this burn"
    );

    const balance = this.balances.get(from)!;
    System.require(balance.value >= args.value, "INK: not enough Ink");
    balance.value = SafeMath.sub(balance.value, args.value);
    this.balances.put(from, balance);

    const supply = this.supply.get()!;
    supply.value = SafeMath.sub(supply.value, args.value);
    this.supply.put(supply);

    const event = new ink.burn_event(from, args.value, args.reason, memo, caller);
    System.event("ink.burn_event", Protobuf.encode(event, ink.burn_event.encode), [from]);

    return new ink.empty_object();
  }

  // ===================================================================
  // Admin functions
  // ===================================================================

  set_minter(args: ink.set_minter_arguments): ink.empty_object {
    this.requireAdmin();
    const account = this.requireAddress(args.account, "INK: invalid account address");

    // Only bits 1..5 (the real reasons) may be set.
    const validMask: u32 = 0b111110;
    System.require((args.reasons_mask & ~validMask) == 0, "INK: reasons mask contains invalid reasons");

    if (args.reasons_mask == 0) {
      this.minters.remove(account);
    } else {
      this.minters.put(account, new ink.uint32(args.reasons_mask));
    }

    const event = new ink.minter_set_event(account, args.reasons_mask);
    System.event("ink.minter_set_event", Protobuf.encode(event, ink.minter_set_event.encode), [account]);
    return new ink.empty_object();
  }

  set_burner(args: ink.set_burner_arguments): ink.empty_object {
    this.requireAdmin();
    const account = this.requireAddress(args.account, "INK: invalid account address");

    if (args.allowed) {
      this.burners.put(account, new ink.boole(true));
    } else {
      this.burners.remove(account);
    }

    const event = new ink.burner_set_event(account, args.allowed);
    System.event("ink.burner_set_event", Protobuf.encode(event, ink.burner_set_event.encode), [account]);
    return new ink.empty_object();
  }

  set_paused(args: ink.set_paused_arguments): ink.empty_object {
    this.requireAdmin();
    const cfg = this.config.get()!;
    cfg.admin = this.getAdmin();
    cfg.paused = args.paused;
    this.config.put(cfg);

    const event = new ink.paused_event(args.paused);
    System.event("ink.paused_event", Protobuf.encode(event, ink.paused_event.encode), []);
    return new ink.empty_object();
  }

  // Step 1 of 2 (AB-016): propose. Admin moves only when the proposed
  // address accepts, so a typo cannot strand it.
  set_admin(args: ink.set_admin_arguments): ink.empty_object {
    this.requireAdmin();
    const proposed = this.requireAddress(args.new_admin, "INK: invalid admin address");
    const admin = this.getAdmin();
    const cfg = this.config.get()!;
    // Proposing the current admin cancels a pending handover.
    cfg.pending_admin = Arrays.equal(proposed, admin) ? null : proposed;
    this.config.put(cfg);

    const event = new ink.admin_proposed_event(admin, cfg.pending_admin);
    System.event("ink.admin_proposed_event", Protobuf.encode(event, ink.admin_proposed_event.encode), [proposed]);
    return new ink.empty_object();
  }

  // Step 2 of 2: the proposed admin signs to take over.
  accept_admin(args: ink.accept_admin_arguments): ink.empty_object {
    const caller = System.getCaller().caller;
    System.require(
      caller == null || caller.length == 0,
      "INK: call SwarmTales directly from your wallet, not through another contract"
    );
    const cfg = this.config.get()!;
    const pending = cfg.pending_admin;
    System.require(pending != null && pending.length == ADDRESS_LENGTH, "INK: no admin handover is pending");
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, pending!),
      "INK: only the proposed admin can accept"
    );
    const oldAdmin = this.getAdmin();
    cfg.admin = pending;
    cfg.pending_admin = null;
    this.config.put(cfg);

    const event = new ink.admin_changed_event(oldAdmin, pending);
    System.event("ink.admin_changed_event", Protobuf.encode(event, ink.admin_changed_event.encode), [pending!]);
    return new ink.empty_object();
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  // Until set_admin is called, the contract's own address is the admin.
  // On Koinos that is safe: checkAuthority looks for a signature from that
  // address (or its authority contract). A stranger cannot sign for it, so
  // nobody can "claim" admin. It only works if the deployer still holds the
  // private key of the address the contract was uploaded to. Upload with the
  // call-contract authority override turned OFF, then hand admin to a wallet.
  private getAdmin(): Uint8Array {
    const stored = this.config.get()!.admin;
    if (stored != null && stored.length > 0) return stored;
    return this.contractId;
  }

  // Protobuf leaves missing bytes and strings as null. A missing address is
  // invalid. A missing memo is an empty note.
  private requireAddress(account: Uint8Array | null, message: string): Uint8Array {
    System.require(account != null && account.length == ADDRESS_LENGTH, message);
    return account!;
  }

  private memoText(memo: string | null): string {
    const text = memo != null ? memo! : "";
    System.require(text.length <= MAX_MEMO_LENGTH, "INK: memo too long (max 64)");
    return text;
  }

  private requireCaller(message: string): Uint8Array {
    const caller = System.getCaller().caller;
    System.require(caller != null && caller.length > 0, message);
    return caller!;
  }

  // Admin actions must come straight from a transaction (security fix H1).
  // Koinos' signature check alone would also pass when some other contract,
  // which the admin signed a transaction for, calls in the admin's name.
  private requireAdmin(): void {
    const caller = System.getCaller().caller;
    System.require(
      caller == null || caller.length == 0,
      "INK: call SwarmTales directly from your wallet, not through another contract"
    );
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, this.getAdmin()),
      "INK: admin authority required"
    );
  }
}
