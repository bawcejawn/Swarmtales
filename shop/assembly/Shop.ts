// =====================================================================
// SwarmTales Shop — smart contract (AssemblyScript, Koinos SDK)
//
// WHAT THIS CONTRACT DOES
//   - Sells Reader and Writer memberships, and Ink packs for Writers.
//   - Collects Book and Short Story open/close fees when Stories asks.
//   - Mints Ink by calling the Ink contract, only for the reasons Shop
//     is allowed: PURCHASE, MEMBERSHIP, STARTER, PROMO.
//   - Gives promo Ink to a wallet that presents a campaign code.
//   - Splits every payment in that same transaction:
//       founder gets floor(price * fee_bps / 10000)
//       treasury gets the rest
//     The fee starts at 1% and cannot be raised above 5%.
//
// WHAT THIS CONTRACT DOES NOT DO
//   - It does not hold customer funds and it has no withdraw.
//   - It does not mint Ink by itself. Ink decides whether the mint is legal.
//   - It does not hardcode a token address. The admin enables each
//     stablecoin and sets each price in that token's base units.
//
// PAYING
//   Koinos stablecoins (KCS-4) do not let a contract pull a normal
//   wallet's tokens on a signature alone. The buyer approves Shop for
//   the full price, and Shop also requires the buyer's signature so a
//   leftover approval cannot be spent by someone else.
// =====================================================================

import { System, Storage, authority, Protobuf, SafeMath, Crypto, StringBytes, Arrays, token } from "@koinos/sdk-as";
import { shop } from "./proto/shop";

const CONFIG_SPACE_ID: u32 = 0;
const ASSETS_SPACE_ID: u32 = 1;
const PRICES_SPACE_ID: u32 = 2;
const MEMBERSHIPS_SPACE_ID: u32 = 3;
const CAMPAIGNS_SPACE_ID: u32 = 4;
const PROMO_CLAIMED_SPACE_ID: u32 = 5;
const SINGLE_USE_SPACE_ID: u32 = 6;
const LOCK_SPACE_ID: u32 = 7;

const ADDRESS_LENGTH: i32 = 25;
const MAX_FEE_BPS: u32 = 500;
const DEFAULT_FEE_BPS: u32 = 100;
const FEE_DENOMINATOR: u64 = 10000;
const MAX_MONTHS: u32 = 24;
const MAX_DECIMALS: u32 = 18;
const MAX_SYMBOL_LENGTH: i32 = 16;
const MAX_CODE_LENGTH: i32 = 64;
const MAX_CODES_PER_CALL: i32 = 20;

// 30 days. Not an admin setting: shrinking it would let the admin
// speed up Writer Ink claims. Changing it means a new contract.
const CLAIM_PERIOD: u64 = 2592000;
const DAY_SECONDS: u64 = 86400;

// sha256("transfer") and sha256("mint"), first 4 bytes. These are the
// Koinos entry points of a KCS-4 token and of the Ink contract.
const TOKEN_TRANSFER_ENTRY: u32 = 670398154;
const INK_MINT_ENTRY: u32 = 3698268091;

const CODE_AVAILABLE: u32 = 1;
const CODE_USED: u32 = 2;

const MINT_PURCHASE: u32 = 1;
const MINT_MEMBERSHIP: u32 = 2;
const MINT_STARTER: u32 = 3;
const MINT_PROMO: u32 = 4;

export class Shop {
  contractId: Uint8Array;
  config: Storage.Obj<shop.config>;
  assets: Storage.Map<Uint8Array, shop.asset>;
  prices: Storage.Map<Uint8Array, shop.uint64>;
  memberships: Storage.Map<Uint8Array, shop.membership>;
  campaigns: Storage.Map<Uint8Array, shop.campaign>;
  promoClaimed: Storage.Map<Uint8Array, shop.uint64>;
  singleUse: Storage.Map<Uint8Array, shop.uint32>;
  lock: Storage.Obj<shop.boole>;

  constructor() {
    this.contractId = System.getContractId();

    this.config = new Storage.Obj(
      this.contractId,
      CONFIG_SPACE_ID,
      shop.config.decode,
      shop.config.encode,
      () => new shop.config(
        new Uint8Array(0),
        false,
        new Uint8Array(0),
        new Uint8Array(0),
        new Uint8Array(0),
        new Uint8Array(0),
        DEFAULT_FEE_BPS,
        false,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      )
    );

    this.assets = new Storage.Map(
      this.contractId,
      ASSETS_SPACE_ID,
      shop.asset.decode,
      shop.asset.encode,
      null
    );

    this.prices = new Storage.Map(
      this.contractId,
      PRICES_SPACE_ID,
      shop.uint64.decode,
      shop.uint64.encode,
      () => new shop.uint64(0)
    );

    this.memberships = new Storage.Map(
      this.contractId,
      MEMBERSHIPS_SPACE_ID,
      shop.membership.decode,
      shop.membership.encode,
      () => new shop.membership(shop.tier.TIER_NONE, 0, 0, 0, 0)
    );

    this.campaigns = new Storage.Map(
      this.contractId,
      CAMPAIGNS_SPACE_ID,
      shop.campaign.decode,
      shop.campaign.encode,
      null
    );

    this.promoClaimed = new Storage.Map(
      this.contractId,
      PROMO_CLAIMED_SPACE_ID,
      shop.uint64.decode,
      shop.uint64.encode,
      () => new shop.uint64(0)
    );

    this.singleUse = new Storage.Map(
      this.contractId,
      SINGLE_USE_SPACE_ID,
      shop.uint32.decode,
      shop.uint32.encode,
      () => new shop.uint32(0)
    );

    this.lock = new Storage.Obj(
      this.contractId,
      LOCK_SPACE_ID,
      shop.boole.decode,
      shop.boole.encode,
      () => new shop.boole(false)
    );
  }

  // ===================================================================
  // Reads
  // ===================================================================

  get_config(args: shop.get_config_arguments): shop.config {
    const cfg = this.loadConfig();
    cfg.admin = this.getAdmin();
    return cfg;
  }

  get_asset(args: shop.get_asset_arguments): shop.asset {
    if (args.token == null || args.token!.length != ADDRESS_LENGTH) {
      return new shop.asset(false, 0, "");
    }
    const found = this.assets.get(args.token!);
    if (found == null) return new shop.asset(false, 0, "");
    return found;
  }

  get_price(args: shop.get_price_arguments): shop.uint64 {
    if (args.token == null || args.token!.length != ADDRESS_LENGTH) return new shop.uint64(0);
    return this.prices.get(this.priceKey(<u32>args.item, args.token!))!;
  }

  get_membership(args: shop.get_membership_arguments): shop.membership {
    if (args.account == null || args.account!.length != ADDRESS_LENGTH) {
      return new shop.membership(shop.tier.TIER_NONE, 0, 0, 0, 0);
    }
    return this.memberships.get(args.account!)!;
  }

  get_campaign(args: shop.get_campaign_arguments): shop.campaign {
    if (args.campaign_id == 0) return this.emptyCampaign();
    const found = this.campaigns.get(this.idKey(args.campaign_id));
    if (found == null) return this.emptyCampaign();
    return found;
  }

  get_promo_claimed(args: shop.get_promo_claimed_arguments): shop.uint64 {
    if (args.account == null || args.account!.length != ADDRESS_LENGTH) return new shop.uint64(0);
    return this.promoClaimed.get(args.account!)!;
  }

  // ===================================================================
  // Memberships and packs
  // ===================================================================

  buy_membership(args: shop.buy_membership_arguments): shop.empty_object {
    this.requireNotPaused();
    this.enter();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");
    System.require(args.months >= 1 && args.months <= MAX_MONTHS, "SHOP: months must be from 1 to 24");

    const tier = args.tier;
    System.require(
      tier == shop.tier.TIER_READER || tier == shop.tier.TIER_WRITER,
      "SHOP: tier must be Reader or Writer"
    );

    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.requireEnabledAsset(assetId);

    const item = tier == shop.tier.TIER_WRITER
      ? shop.item.ITEM_WRITER_MONTH
      : shop.item.ITEM_READER_MONTH;
    const unit = this.requirePrice(<u32>item, assetId);
    const price = SafeMath.mul(unit, <u64>args.months);
    const now = this.now();
    const current = this.memberships.get(payer)!;
    const writerActive = this.isActiveWriter(current, now);

    let inkAmount: u64 = 0;
    let inkReason: u32 = 0;
    let memo = "";
    if (tier == shop.tier.TIER_READER) {
      System.require(!writerActive, "SHOP: an active Writer membership cannot be replaced by Reader");
      const start = current.tier == shop.tier.TIER_READER && current.paid_until > now
        ? current.paid_until
        : now;
      current.tier = shop.tier.TIER_READER;
      current.paid_until = this.addPeriods(start, args.months);
      current.months_unclaimed = 0;
      current.next_claim_at = 0;
      current.ink_per_month = 0;
    } else {
      const cfg = this.loadConfig();
      System.require(cfg.writer_ink > 0, "SHOP: Writer Ink amount is not set");
      if (writerActive) {
        current.paid_until = this.addPeriods(current.paid_until, args.months);
        current.months_unclaimed = SafeMath.add(current.months_unclaimed, <u64>args.months);
      } else {
        inkAmount = cfg.writer_ink;
        inkReason = MINT_MEMBERSHIP;
        memo = "writer:month";
        current.tier = shop.tier.TIER_WRITER;
        current.paid_until = this.addPeriods(now, args.months);
        current.months_unclaimed = <u64>args.months - 1;
        current.next_claim_at = SafeMath.add(now, CLAIM_PERIOD);
        current.ink_per_month = cfg.writer_ink;
      }
    }

    this.takePayment(payer, assetId, <u32>item, price, inkAmount, inkReason, memo);
    this.memberships.put(payer, current);
    this.leave();
    return new shop.empty_object();
  }

  claim_writer_ink(args: shop.claim_writer_ink_arguments): shop.empty_object {
    this.requireNotPaused();
    this.enter();

    const account = this.requireAddress(args.account, "SHOP: invalid account address");
    this.requireSigner(account, "SHOP: account has not authorized this claim");

    const now = this.now();
    const current = this.memberships.get(account)!;
    System.require(this.isActiveWriter(current, now), "SHOP: Writer membership is not active");
    System.require(current.ink_per_month > 0, "SHOP: Writer Ink amount is not set");
    System.require(current.months_unclaimed > 0, "SHOP: no Writer Ink is waiting");
    System.require(now >= current.next_claim_at, "SHOP: next Writer Ink claim is not due");

    current.months_unclaimed = SafeMath.sub(current.months_unclaimed, 1);
    current.next_claim_at = SafeMath.add(current.next_claim_at, CLAIM_PERIOD);
    this.memberships.put(account, current);

    this.mintInk(account, current.ink_per_month, MINT_MEMBERSHIP, "writer:month");
    const event = new shop.claim_event(
      account,
      current.ink_per_month,
      current.months_unclaimed,
      current.next_claim_at
    );
    System.event("shop.claim_event", Protobuf.encode(event, shop.claim_event.encode), [account]);
    this.leave();
    return new shop.empty_object();
  }

  buy_pack(args: shop.buy_pack_arguments): shop.empty_object {
    this.requireNotPaused();
    this.enter();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.requireEnabledAsset(assetId);

    const pack = args.pack;
    System.require(this.isPack(pack), "SHOP: pack must be S, M or L");
    const now = this.now();
    System.require(this.isActiveWriter(this.memberships.get(payer)!, now), "SHOP: packs are for active Writers");

    const cfg = this.loadConfig();
    const inkAmount = this.packInk(cfg, pack);
    System.require(inkAmount > 0, "SHOP: pack Ink amount is not set");
    const price = this.requirePrice(<u32>pack, assetId);
    const memo = pack == shop.item.ITEM_PACK_S ? "pack:S" : pack == shop.item.ITEM_PACK_M ? "pack:M" : "pack:L";

    this.takePayment(payer, assetId, <u32>pack, price, inkAmount, MINT_PURCHASE, memo);
    this.leave();
    return new shop.empty_object();
  }

  // ===================================================================
  // Story open / close fees (Stories contract only)
  // ===================================================================

  pay_open_fee(args: shop.pay_open_fee_arguments): shop.empty_object {
    this.requireNotPaused();
    this.enter();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");
    this.requireStoriesCaller();

    const kind = args.kind;
    System.require(
      kind == shop.story_kind.KIND_BOOK || kind == shop.story_kind.KIND_SHORT,
      "SHOP: kind must be Book or Short Story"
    );
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.requireEnabledAsset(assetId);

    const cfg = this.loadConfig();
    const isBook = kind == shop.story_kind.KIND_BOOK;
    const item = isBook ? shop.item.ITEM_OPEN_BOOK : shop.item.ITEM_OPEN_SHORT;
    const starter = isBook ? cfg.starter_book : cfg.starter_short;
    System.require(starter > 0, "SHOP: starter Ink amount is not set");
    const price = this.requirePrice(<u32>item, assetId);
    const memo = isBook ? "open:book" : "open:short";

    this.takePayment(payer, assetId, <u32>item, price, starter, MINT_STARTER, memo);
    this.leave();
    return new shop.empty_object();
  }

  pay_close_fee(args: shop.pay_close_fee_arguments): shop.empty_object {
    this.requireNotPaused();
    this.enter();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");
    this.requireStoriesCaller();

    const kind = args.kind;
    System.require(
      kind == shop.story_kind.KIND_BOOK || kind == shop.story_kind.KIND_SHORT,
      "SHOP: kind must be Book or Short Story"
    );
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.requireEnabledAsset(assetId);

    const isBook = kind == shop.story_kind.KIND_BOOK;
    const item = isBook ? shop.item.ITEM_CLOSE_BOOK : shop.item.ITEM_CLOSE_SHORT;
    const price = this.requirePrice(<u32>item, assetId);

    this.takePayment(payer, assetId, <u32>item, price, 0, 0, "");
    this.leave();
    return new shop.empty_object();
  }

  // ===================================================================
  // Promo
  // ===================================================================

  claim_promo(args: shop.claim_promo_arguments): shop.empty_object {
    this.requireNotPaused();
    this.enter();

    const account = this.requireAddress(args.account, "SHOP: invalid account address");
    this.requireSigner(account, "SHOP: account has not authorized this claim");

    const cfg = this.loadConfig();
    System.require(cfg.promo_enabled, "SHOP: promo is off");
    System.require(args.campaign_id > 0, "SHOP: unknown campaign");

    const key = this.idKey(args.campaign_id);
    const campaign = this.campaigns.get(key);
    System.require(campaign != null, "SHOP: unknown campaign");
    const row = campaign!;
    System.require(row.enabled, "SHOP: campaign is disabled");

    const now = this.now();
    System.require(now >= row.starts_at, "SHOP: campaign has not started");
    System.require(now < row.ends_at, "SHOP: campaign has ended");

    const code = this.text(args.code);
    System.require(code.length > 0 && code.length <= MAX_CODE_LENGTH, "SHOP: invalid promo code");
    const hash = this.sha256(code);

    if (row.single_use) {
      const statusKey = this.codeKey(args.campaign_id, hash);
      const status = this.singleUse.get(statusKey)!.value;
      System.require(status == CODE_AVAILABLE, status == CODE_USED
        ? "SHOP: promo code already used"
        : "SHOP: promo code rejected");
      this.singleUse.put(statusKey, new shop.uint32(CODE_USED));
    } else {
      System.require(Arrays.equal(hash, row.code_hash), "SHOP: promo code rejected");
    }

    const already = this.promoClaimed.get(account)!.value;
    System.require(already == 0, "SHOP: this wallet has already claimed a promo");

    const day = now / DAY_SECONDS;
    if (row.day != day) {
      row.day = day;
      row.used_today = 0;
    }
    const nextBudget = SafeMath.add(row.budget_used, row.amount);
    System.require(nextBudget <= row.budget_total, "SHOP: promo budget exhausted");
    if (row.daily_cap > 0) {
      const nextToday = SafeMath.add(row.used_today, row.amount);
      System.require(nextToday <= row.daily_cap, "SHOP: promo daily cap reached");
      row.used_today = nextToday;
    }
    row.budget_used = nextBudget;
    this.campaigns.put(key, row);
    this.promoClaimed.put(account, new shop.uint64(args.campaign_id));

    const memo = "campaign:" + args.campaign_id.toString();
    this.mintInk(account, row.amount, MINT_PROMO, memo);

    const event = new shop.promo_claim_event(account, args.campaign_id, row.amount, memo);
    System.event("shop.promo_claim_event", Protobuf.encode(event, shop.promo_claim_event.encode), [account]);
    this.leave();
    return new shop.empty_object();
  }

  // ===================================================================
  // Admin
  // ===================================================================

  set_asset(args: shop.set_asset_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    System.require(args.decimals <= MAX_DECIMALS, "SHOP: decimals must be from 0 to 18");
    const symbol = this.text(args.symbol);
    System.require(symbol.length > 0 && symbol.length <= MAX_SYMBOL_LENGTH, "SHOP: symbol must be 1 to 16 characters");
    this.assets.put(assetId, new shop.asset(args.enabled, args.decimals, symbol));
    this.leave();
    return new shop.empty_object();
  }

  set_price(args: shop.set_price_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    System.require(this.isItem(<u32>args.item), "SHOP: unknown item");
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.prices.put(this.priceKey(<u32>args.item, assetId), new shop.uint64(args.amount));
    this.leave();
    return new shop.empty_object();
  }

  set_addresses(args: shop.set_addresses_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const treasury = this.requireAddress(args.treasury, "SHOP: invalid treasury address");
    const founder = this.requireAddress(args.founder, "SHOP: invalid founder address");
    this.requireOutside(treasury, "SHOP: treasury cannot be the Shop contract");
    this.requireOutside(founder, "SHOP: founder cannot be the Shop contract");
    const ink = this.optionalAddress(args.ink, "SHOP: invalid Ink address");
    const stories = this.optionalAddress(args.stories, "SHOP: invalid Stories address");
    if (ink.length != 0) this.requireOutside(ink, "SHOP: Ink cannot be the Shop contract");
    if (stories.length != 0) this.requireOutside(stories, "SHOP: Stories cannot be the Shop contract");

    const cfg = this.loadConfig();
    cfg.treasury = treasury;
    cfg.founder = founder;
    cfg.ink = ink;
    cfg.stories = stories;
    this.saveConfig(cfg);
    this.leave();
    return new shop.empty_object();
  }

  set_ink_amounts(args: shop.set_ink_amounts_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const cfg = this.loadConfig();
    cfg.writer_ink = args.writer_month;
    cfg.pack_s_ink = args.pack_s;
    cfg.pack_m_ink = args.pack_m;
    cfg.pack_l_ink = args.pack_l;
    cfg.starter_book = args.starter_book;
    cfg.starter_short = args.starter_short;
    this.saveConfig(cfg);
    this.leave();
    return new shop.empty_object();
  }

  set_fee_bps(args: shop.set_fee_bps_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    System.require(args.fee_bps <= MAX_FEE_BPS, "SHOP: fee cannot exceed 500 basis points");
    const cfg = this.loadConfig();
    cfg.fee_bps = args.fee_bps;
    this.saveConfig(cfg);
    this.leave();
    return new shop.empty_object();
  }

  set_paused(args: shop.set_paused_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const cfg = this.loadConfig();
    cfg.paused = args.paused;
    this.saveConfig(cfg);
    const event = new shop.paused_event(args.paused);
    System.event("shop.paused_event", Protobuf.encode(event, shop.paused_event.encode), []);
    this.leave();
    return new shop.empty_object();
  }

  set_admin(args: shop.set_admin_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const newAdmin = this.requireAddress(args.new_admin, "SHOP: invalid admin address");
    const oldAdmin = this.getAdmin();
    const cfg = this.loadConfig();
    cfg.admin = newAdmin;
    this.config.put(cfg);
    const event = new shop.admin_changed_event(oldAdmin, newAdmin);
    System.event(
      "shop.admin_changed_event",
      Protobuf.encode(event, shop.admin_changed_event.encode),
      [newAdmin]
    );
    this.leave();
    return new shop.empty_object();
  }

  set_promo_enabled(args: shop.set_promo_enabled_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const cfg = this.loadConfig();
    cfg.promo_enabled = args.enabled;
    this.saveConfig(cfg);
    const event = new shop.promo_enabled_event(args.enabled);
    System.event("shop.promo_enabled_event", Protobuf.encode(event, shop.promo_enabled_event.encode), []);
    this.leave();
    return new shop.empty_object();
  }

  create_campaign(args: shop.create_campaign_arguments): shop.uint64 {
    this.enter();
    this.requireAdmin();
    System.require(args.amount > 0, "SHOP: promo amount must be greater than zero");
    System.require(args.budget_total >= args.amount, "SHOP: budget must cover at least one claim");
    System.require(
      args.daily_cap == 0 || args.daily_cap >= args.amount,
      "SHOP: daily cap must cover at least one claim"
    );
    System.require(args.ends_at > args.starts_at, "SHOP: campaign end must be after the start");

    const code = this.text(args.code);
    let codeHash = new Uint8Array(0);
    if (args.single_use) {
      System.require(code.length == 0, "SHOP: single-use campaigns take codes separately");
    } else {
      System.require(code.length > 0 && code.length <= MAX_CODE_LENGTH, "SHOP: invalid promo code");
      codeHash = this.sha256(code);
    }

    const cfg = this.loadConfig();
    let id = cfg.next_campaign_id;
    if (id == 0) id = 1;
    cfg.next_campaign_id = SafeMath.add(id, 1);
    this.saveConfig(cfg);

    const row = new shop.campaign(
      codeHash,
      args.amount,
      args.budget_total,
      0,
      args.daily_cap,
      0,
      0,
      args.starts_at,
      args.ends_at,
      args.enabled,
      args.single_use
    );
    this.campaigns.put(this.idKey(id), row);
    this.emitCampaign(id, row);
    this.leave();
    return new shop.uint64(id);
  }

  set_campaign_enabled(args: shop.set_campaign_enabled_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const row = this.requireCampaign(args.campaign_id);
    row.enabled = args.enabled;
    this.campaigns.put(this.idKey(args.campaign_id), row);
    this.emitCampaign(args.campaign_id, row);
    this.leave();
    return new shop.empty_object();
  }

  set_campaign_limits(args: shop.set_campaign_limits_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const row = this.requireCampaign(args.campaign_id);
    System.require(args.budget_total >= row.budget_used, "SHOP: budget cannot be below what was already given");
    System.require(args.budget_total >= row.amount, "SHOP: budget must cover at least one claim");
    System.require(
      args.daily_cap == 0 || args.daily_cap >= row.amount,
      "SHOP: daily cap must cover at least one claim"
    );
    System.require(args.ends_at > row.starts_at, "SHOP: campaign end must be after the start");
    row.budget_total = args.budget_total;
    row.daily_cap = args.daily_cap;
    row.ends_at = args.ends_at;
    this.campaigns.put(this.idKey(args.campaign_id), row);
    this.emitCampaign(args.campaign_id, row);
    this.leave();
    return new shop.empty_object();
  }

  add_single_use_codes(args: shop.add_single_use_codes_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const row = this.requireCampaign(args.campaign_id);
    System.require(row.single_use, "SHOP: campaign is not single-use");
    const codes = args.codes;
    System.require(codes.length > 0, "SHOP: no promo codes were provided");
    System.require(codes.length <= MAX_CODES_PER_CALL, "SHOP: too many promo codes in one call");

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      System.require(code.length > 0 && code.length <= MAX_CODE_LENGTH, "SHOP: invalid promo code");
      const hash = this.sha256(code);
      const statusKey = this.codeKey(args.campaign_id, hash);
      const status = this.singleUse.get(statusKey)!.value;
      System.require(status == 0, "SHOP: promo code already added");
      this.singleUse.put(statusKey, new shop.uint32(CODE_AVAILABLE));
    }
    this.leave();
    return new shop.empty_object();
  }

  // ===================================================================
  // Money and Ink
  // ===================================================================

  // Pull the stablecoin, then mint if this purchase includes Ink.
  // founder_amount uses floor division. The remainder stays with treasury,
  // so the two legs always add up to the price. A zero founder leg
  // (a very small price) is not sent as a transfer.
  private takePayment(
    payer: Uint8Array,
    assetId: Uint8Array,
    item: u32,
    price: u64,
    inkAmount: u64,
    inkReason: u32,
    memo: string
  ): void {
    const cfg = this.loadConfig();
    const treasury = this.requireAddress(cfg.treasury, "SHOP: treasury is not set");
    const founder = this.requireAddress(cfg.founder, "SHOP: founder is not set");
    System.require(cfg.fee_bps <= MAX_FEE_BPS, "SHOP: fee is above the cap");

    const founderAmount = SafeMath.div(
      SafeMath.mul(price, <u64>cfg.fee_bps),
      FEE_DENOMINATOR
    );
    const treasuryAmount = SafeMath.sub(price, founderAmount);
    System.require(treasuryAmount > 0, "SHOP: treasury amount is zero");

    this.transferToken(assetId, payer, treasury, treasuryAmount);
    if (founderAmount > 0) {
      this.transferToken(assetId, payer, founder, founderAmount);
    }
    if (inkAmount > 0) {
      this.mintInk(payer, inkAmount, inkReason, memo);
    }

    const event = new shop.payment_event(
      payer,
      assetId,
      <shop.item>item,
      price,
      treasuryAmount,
      founderAmount,
      treasury,
      founder,
      cfg.fee_bps,
      inkAmount,
      inkReason
    );
    System.event(
      "shop.payment_event",
      Protobuf.encode(event, shop.payment_event.encode),
      [payer, treasury, founder]
    );
  }

  private transferToken(assetId: Uint8Array, from: Uint8Array, to: Uint8Array, amount: u64): void {
    const args = new token.transfer_arguments(from, to, amount);
    const payload = Protobuf.encode(args, token.transfer_arguments.encode);
    this.callOut(assetId, TOKEN_TRANSFER_ENTRY, payload, [from, to], "SHOP: stablecoin transfer failed");
  }

  private mintInk(to: Uint8Array, amount: u64, reason: u32, memo: string): void {
    const ink = this.requireAddress(this.loadConfig().ink, "SHOP: Ink contract is not set");
    const args = new shop.ink_mint_call(to, amount, reason, memo);
    const payload = Protobuf.encode(args, shop.ink_mint_call.encode);
    this.callOut(ink, INK_MINT_ENTRY, payload, [to], "SHOP: Ink mint failed");
  }

  // The payload in the event is the same buffer passed to the other contract.
  private callOut(
    contractId: Uint8Array,
    entryPoint: u32,
    payload: Uint8Array,
    impacted: Uint8Array[],
    message: string
  ): void {
    const callRes = System.call(contractId, entryPoint, payload);
    System.require(callRes.code == 0, message);
    const event = new shop.external_call_event(contractId, entryPoint, payload);
    System.event(
      "shop.external_call_event",
      Protobuf.encode(event, shop.external_call_event.encode),
      impacted
    );
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  private loadConfig(): shop.config {
    return this.config.get()!;
  }

  private saveConfig(cfg: shop.config): void {
    if (cfg.admin == null || cfg.admin!.length == 0) cfg.admin = this.contractId;
    this.config.put(cfg);
  }

  // Until set_admin is called, the contract's own address is the admin.
  // checkAuthority still requires a signature from that address.
  private getAdmin(): Uint8Array {
    const stored = this.loadConfig().admin;
    if (stored != null && stored.length > 0) return stored;
    return this.contractId;
  }

  private requireAdmin(): void {
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, this.getAdmin()),
      "SHOP: admin authority required"
    );
  }

  private requireNotPaused(): void {
    System.require(!this.loadConfig().paused, "SHOP: shop is paused");
  }

  // Held across the whole call, including the signature check, so a token
  // or authority contract cannot call back into Shop mid-payment.
  private enter(): void {
    const flag = this.lock.get()!;
    System.require(!flag.value, "SHOP: reentrant call");
    flag.value = true;
    this.lock.put(flag);
  }

  private leave(): void {
    const flag = this.lock.get()!;
    flag.value = false;
    this.lock.put(flag);
  }

  private requireSigner(account: Uint8Array, message: string): void {
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, account),
      message
    );
  }

  private requireStoriesCaller(): void {
    const stories = this.requireAddress(this.loadConfig().stories, "SHOP: Stories contract is not set");
    const caller = System.getCaller().caller;
    System.require(caller != null && caller.length == ADDRESS_LENGTH, "SHOP: caller must be the Stories contract");
    System.require(Arrays.equal(caller!, stories), "SHOP: caller must be the Stories contract");
  }

  private requireEnabledAsset(assetId: Uint8Array): void {
    const found = this.assets.get(assetId);
    System.require(found != null, "SHOP: asset is not accepted");
    System.require(found!.enabled, "SHOP: asset is not accepted");
  }

  private requirePrice(item: u32, assetId: Uint8Array): u64 {
    const price = this.prices.get(this.priceKey(item, assetId))!.value;
    System.require(price > 0, "SHOP: price is not set for this asset");
    return price;
  }

  private requireAddress(account: Uint8Array | null, message: string): Uint8Array {
    System.require(account != null && account.length == ADDRESS_LENGTH, message);
    return account!;
  }

  private optionalAddress(account: Uint8Array | null, message: string): Uint8Array {
    if (account == null || account.length == 0) return new Uint8Array(0);
    System.require(account.length == ADDRESS_LENGTH, message);
    return account!;
  }

  private requireOutside(account: Uint8Array, message: string): void {
    System.require(!Arrays.equal(account, this.contractId), message);
  }

  private text(value: string | null): string {
    return value != null ? value! : "";
  }

  // Koinos head_block_time is in milliseconds. Every period, day and
  // campaign time in this contract is in seconds, so convert here.
  private now(): u64 {
    return System.getHeadInfo().head_block_time / 1000;
  }

  private addPeriods(start: u64, months: u32): u64 {
    return SafeMath.add(start, SafeMath.mul(CLAIM_PERIOD, <u64>months));
  }

  private isActiveWriter(current: shop.membership, now: u64): bool {
    return current.tier == shop.tier.TIER_WRITER && current.paid_until > now;
  }

  private isItem(item: u32): bool {
    return item >= <u32>shop.item.ITEM_READER_MONTH && item <= <u32>shop.item.ITEM_CLOSE_SHORT;
  }

  private isPack(pack: shop.item): bool {
    return pack == shop.item.ITEM_PACK_S || pack == shop.item.ITEM_PACK_M || pack == shop.item.ITEM_PACK_L;
  }

  private packInk(cfg: shop.config, pack: shop.item): u64 {
    if (pack == shop.item.ITEM_PACK_S) return cfg.pack_s_ink;
    if (pack == shop.item.ITEM_PACK_M) return cfg.pack_m_ink;
    return cfg.pack_l_ink;
  }

  private priceKey(item: u32, assetId: Uint8Array): Uint8Array {
    const key = new Uint8Array(1 + ADDRESS_LENGTH);
    key[0] = <u8>item;
    memory.copy(key.dataStart + 1, assetId.dataStart, ADDRESS_LENGTH);
    return key;
  }

  private idKey(id: u64): Uint8Array {
    const key = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      key[i] = <u8>(id & 0xff);
      id = id >> 8;
    }
    return key;
  }

  private codeKey(campaignId: u64, hash: Uint8Array): Uint8Array {
    const id = this.idKey(campaignId);
    const key = new Uint8Array(8 + hash.length);
    memory.copy(key.dataStart, id.dataStart, 8);
    memory.copy(key.dataStart + 8, hash.dataStart, hash.length);
    return key;
  }

  // System.hash returns a multihash (code, length, digest). Store the
  // raw 32-byte sha256 so the code itself is not kept on chain.
  private sha256(value: string): Uint8Array {
    const wrapped = System.hash(Crypto.multicodec.sha2_256, StringBytes.stringToBytes(value));
    System.require(wrapped != null, "SHOP: could not hash promo code");
    const bytes = wrapped!;
    let i = 0;
    while (i < bytes.length) {
      const bite = bytes[i];
      i++;
      if ((bite & 0x80) == 0) break;
    }
    let size: u64 = 0;
    let shift: u8 = 0;
    while (i < bytes.length) {
      const bite = bytes[i];
      i++;
      size = size | ((<u64>(bite & 0x7f)) << shift);
      if ((bite & 0x80) == 0) break;
      shift = <u8>(shift + 7);
    }
    System.require(size == 32 && i + 32 <= bytes.length, "SHOP: unexpected promo hash");
    return bytes.slice(i, i + 32);
  }

  private requireCampaign(id: u64): shop.campaign {
    System.require(id > 0, "SHOP: unknown campaign");
    const found = this.campaigns.get(this.idKey(id));
    System.require(found != null, "SHOP: unknown campaign");
    return found!;
  }

  private emptyCampaign(): shop.campaign {
    return new shop.campaign(new Uint8Array(0), 0, 0, 0, 0, 0, 0, 0, 0, false, false);
  }

  private emitCampaign(id: u64, row: shop.campaign): void {
    const event = new shop.campaign_event(
      id,
      row.enabled,
      row.amount,
      row.budget_total,
      row.daily_cap,
      row.starts_at,
      row.ends_at,
      row.single_use
    );
    System.event("shop.campaign_event", Protobuf.encode(event, shop.campaign_event.encode), []);
  }
}
