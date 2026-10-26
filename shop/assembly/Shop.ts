// =====================================================================
// SwarmTales Shop — smart contract (AssemblyScript, Koinos SDK)
//
// WHAT THIS CONTRACT DOES
//   - Sells Reader and Writer memberships, and Ink packs for Writers.
//   - Collects the Book and Short Story open fee when Stories asks
//     (closing a story is free).
//   - Mints Ink by calling the Ink contract, only for the reasons Shop
//     is allowed: PURCHASE, MEMBERSHIP, STARTER, PROMO.
//   - Gives promo Ink to a wallet that presents a campaign code. Each
//     wallet may claim each campaign once (October 2026; it was once ever).
//   - Splits every payment in that same transaction:
//       founder gets floor(price * fee_bps / 10000)
//       treasury gets the rest
//     The fee starts at 1% and cannot be raised above 5%.
//
// WHAT THIS CONTRACT DOES NOT DO
//   - It does not hold customer funds and it has no withdraw.
//   - It does not mint Ink by itself. Ink decides whether the mint is legal.
//   - It does not hardcode a token address. The admin enables each
//     stablecoin and sets each price in that token's base units. After the
//     first sale, a newly enabled token can't be used for 7 days and is
//     announced with a public event (C1-01); disabling one works at once.
//   - Every purchase carries the buyer's limits: the most they pay
//     (max_price) and the least Ink they get (min_ink). Outside either,
//     nothing is charged (AB-017, M-2).
//
// PAYING
//   Shop calls the token's transfer from the buyer to the treasury and the
//   founder inside the buyer's own signed transaction, and also requires
//   the buyer's signature itself. Whether the token accepts that signature
//   alone or needs an earlier approval is the token's own rule (check it
//   for each token before enabling it; see docs/KEY_CUSTODY.md).
//   Shop does not trust the token's reply. It reads the treasury's and
//   the founder's balances before and after, and refuses the purchase
//   unless each one went up by exactly its share. That check is only as
//   good as the token: the balances come from the same token, and the
//   token's code runs inside the buyer's signed purchase. A token's issuer
//   (whoever holds its upload key) is therefore a trust assumption, and
//   the site and deploy tool use only tokens pinned with their code hash
//   (audit H-3, L-6; docs/ADMIN_POWERS.md).
//
// WHO MAY CALL (security fix H1)
//   Koinos' signature check only asks "did this wallet sign the
//   transaction?", not "did this wallet call me?". Without more, any
//   other app a user signs for could quietly call Shop as that user.
//   So every user action and every admin action must be called directly
//   by the transaction, never through another contract. The only
//   contract allowed to call in is Stories, for the story fees.
//
// PROMO LINKS (security fix H3)
//   No promo secret is ever sent to the chain. A campaign stores only the
//   public address of a "link key". The private half lives in the share
//   link, after the #. To claim, the browser signs
//   "promo / this Shop / campaign id / this wallet" with that link key.
//   A copied signature only works for the wallet it names.
// =====================================================================

import { System, Storage, authority, Protobuf, SafeMath, Crypto, StringBytes, Arrays, token } from "@koinos/sdk-as";
import { shop } from "./proto/shop";

// Payment tokens the Shop keeps a record of (get_assets lists them all).
const MAX_ASSETS: i32 = 10;
const CONFIG_SPACE_ID: u32 = 0;
const ASSETS_SPACE_ID: u32 = 1;
const PRICES_SPACE_ID: u32 = 2;
const MEMBERSHIPS_SPACE_ID: u32 = 3;
const CAMPAIGNS_SPACE_ID: u32 = 4;
const PROMO_CLAIMED_SPACE_ID: u32 = 5;
const SINGLE_USE_SPACE_ID: u32 = 6;
const LOCK_SPACE_ID: u32 = 7;
const CAMPAIGN_CLAIMED_SPACE_ID: u32 = 8;

const ADDRESS_LENGTH: i32 = 25;
const MAX_FEE_BPS: u32 = 500;
const DEFAULT_FEE_BPS: u32 = 100;
const FEE_DENOMINATOR: u64 = 10000;
const MAX_MONTHS: u32 = 24;
// Open-price multiplier sent by Stories (2^7 = 128 for a 10th open project).
const MAX_PRICE_MULTIPLIER: u64 = 1024;
const MAX_DECIMALS: u32 = 18;
const MAX_SYMBOL_LENGTH: i32 = 16;
const MAX_SIGNERS_PER_CALL: i32 = 20;
const SIGNATURE_LENGTH: i32 = 65;

// Domain separator for promo link signatures. The browser signs exactly:
//   sha256( "swarmtales/promo/v1" || shop address (25) || campaign id (8, big-endian) || wallet (25) )
const PROMO_DOMAIN = "swarmtales/promo/v1";

// 30 days. Not an admin setting: shrinking it would let the admin
// speed up Writer Ink claims. Changing it means a new contract.
const CLAIM_PERIOD: u64 = 2592000;
const DAY_SECONDS: u64 = 86400;
// A newly enabled payment token waits this long before it can be used
// (C1-01). Not an admin setting, for the same reason.
const ASSET_WAIT: u64 = 7 * DAY_SECONDS;

// sha256("transfer") and sha256("mint"), first 4 bytes. These are the
// Koinos entry points of a KCS-4 token and of the Ink contract.
const TOKEN_TRANSFER_ENTRY: u32 = 670398154;
const TOKEN_BALANCE_OF_ENTRY: u32 = 1550980247; // 0x5c721497 "balance_of"
const INK_MINT_ENTRY: u32 = 3698268091;

const CODE_AVAILABLE: u32 = 1;
const CODE_USED: u32 = 2;

const MINT_PURCHASE: u32 = 1;
const MINT_MEMBERSHIP: u32 = 2;
const MINT_STARTER: u32 = 3;
const MINT_PROMO: u32 = 4;

/**
 * The founder's share of a price: floor(price * feeBps / FEE_DENOMINATOR),
 * computed as (p/D)*f + (p%D)*f/D so that price * fee_bps can't overflow for
 * a high-decimal token (audit L-4). Exact, and each product stays far below
 * 2^64 for fee_bps <= MAX_FEE_BPS. Exported for the tests.
 */
export function founderShare(price: u64, feeBps: u32): u64 {
  const fee = <u64>feeBps;
  return SafeMath.add(
    SafeMath.mul(price / FEE_DENOMINATOR, fee),
    SafeMath.mul(price % FEE_DENOMINATOR, fee) / FEE_DENOMINATOR
  );
}

export class Shop {
  contractId: Uint8Array;
  config: Storage.Obj<shop.config>;
  assets: Storage.Map<Uint8Array, shop.asset>;
  prices: Storage.Map<Uint8Array, shop.uint64>;
  memberships: Storage.Map<Uint8Array, shop.membership>;
  campaigns: Storage.Map<Uint8Array, shop.campaign>;
  promoClaimed: Storage.Map<Uint8Array, shop.uint64>;
  singleUse: Storage.Map<Uint8Array, shop.uint32>;
  // (campaign, wallet) pairs that were claimed: one claim per wallet per campaign.
  campaignClaimed: Storage.Map<Uint8Array, shop.boole>;
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
      () => new shop.membership()
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

    this.campaignClaimed = new Storage.Map(
      this.contractId,
      CAMPAIGN_CLAIMED_SPACE_ID,
      shop.boole.decode,
      shop.boole.encode,
      () => new shop.boole(false)
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
    const found = args.token != null && args.token!.length == ADDRESS_LENGTH ? this.assets.get(args.token!) : null;
    return found != null ? found : new shop.asset(false, 0, "");
  }

  get_assets(args: shop.get_assets_arguments): shop.token_list {
    return new shop.token_list(this.assets.getManyKeys(new Uint8Array(0), MAX_ASSETS));
  }

  get_price(args: shop.get_price_arguments): shop.uint64 {
    if (args.token == null || args.token!.length != ADDRESS_LENGTH) return new shop.uint64(0);
    return this.prices.get(this.priceKey(<u32>args.item, args.token!))!;
  }

  get_membership(args: shop.get_membership_arguments): shop.membership {
    if (args.account == null || args.account!.length != ADDRESS_LENGTH) {
      return new shop.membership();
    }
    return this.membership(args.account!, this.now());
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

  get_campaign_claimed(args: shop.get_campaign_claimed_arguments): shop.boole {
    if (args.campaign_id == 0 || args.account == null || args.account!.length != ADDRESS_LENGTH) return new shop.boole(false);
    return this.campaignClaimed.get(this.codeKey(args.campaign_id, args.account!))!;
  }

  // 0 = never added, 1 = waiting to be claimed, 2 = already claimed.
  get_single_use_status(args: shop.get_single_use_status_arguments): shop.uint32 {
    if (args.campaign_id == 0 || args.signer == null || args.signer!.length != ADDRESS_LENGTH) return new shop.uint32(0);
    return this.singleUse.get(this.codeKey(args.campaign_id, args.signer!))!;
  }

  // ===================================================================
  // Memberships and packs
  // ===================================================================

  buy_membership(args: shop.buy_membership_arguments): shop.empty_object {
    this.enter();
    this.requireNotPaused();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");
    System.require(args.months >= 1 && args.months <= MAX_MONTHS, "SHOP: months must be from 1 to 24");
    // A gift: the payer pays, the beneficiary gets the membership and its Ink.
    const gift = args.beneficiary != null && args.beneficiary!.length > 0;
    const member = gift ? this.requireAddress(args.beneficiary, "SHOP: invalid beneficiary address") : payer;

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
    this.requireMaxPrice(price, args.max_price);
    const now = this.now();
    const current = this.membership(member, now);
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
      // More months of a running term bring the Ink locked when it began.
      const perMonth = writerActive ? current.ink_per_month : cfg.writer_ink;
      this.requireMinInk(perMonth, args.min_ink);
      if (writerActive) {
        current.paid_until = this.addPeriods(current.paid_until, args.months);
        current.months_unclaimed = SafeMath.add(current.months_unclaimed, <u64>args.months);
      } else {
        // Reader time left resumes after the Writer term (C1-03).
        if (current.tier == shop.tier.TIER_READER && current.paid_until > now) {
          current.reader_left = current.paid_until - now;
        }
        inkAmount = perMonth;
        inkReason = MINT_MEMBERSHIP;
        memo = "writer:month";
        current.tier = shop.tier.TIER_WRITER;
        current.paid_until = this.addPeriods(now, args.months);
        current.months_unclaimed = <u64>args.months - 1;
        current.next_claim_at = SafeMath.add(now, CLAIM_PERIOD);
        current.ink_per_month = perMonth;
      }
    }

    this.takePayment(payer, assetId, <u32>item, price, inkAmount, inkReason, memo, member);
    this.memberships.put(member, current);
    if (gift && !Arrays.equal(member, payer)) {
      const ev = new shop.membership_gift_event(payer, member, tier, args.months);
      System.event("shop.membership_gift_event", Protobuf.encode(ev, shop.membership_gift_event.encode), [payer, member]);
    }
    this.leave();
    return new shop.empty_object();
  }

  claim_writer_ink(args: shop.claim_writer_ink_arguments): shop.empty_object {
    this.enter();
    this.requireNotPaused();

    const account = this.requireAddress(args.account, "SHOP: invalid account address");
    this.requireSigner(account, "SHOP: account has not authorized this claim");

    const now = this.now();
    const current = this.membership(account, now);
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
    this.enter();
    this.requireNotPaused();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.requireEnabledAsset(assetId);

    const pack = args.pack;
    System.require(this.isPack(pack), "SHOP: pack must be S, M or L");
    const now = this.now();
    System.require(this.isActiveWriter(this.membership(payer, now), now), "SHOP: packs are for active Writers");

    const cfg = this.loadConfig();
    const inkAmount = this.packInk(cfg, pack);
    System.require(inkAmount > 0, "SHOP: pack Ink amount is not set");
    this.requireMinInk(inkAmount, args.min_ink);
    const price = this.requirePrice(<u32>pack, assetId);
    this.requireMaxPrice(price, args.max_price);
    const memo = pack == shop.item.ITEM_PACK_S ? "pack:S" : pack == shop.item.ITEM_PACK_M ? "pack:M" : "pack:L";

    this.takePayment(payer, assetId, <u32>pack, price, inkAmount, MINT_PURCHASE, memo);
    this.leave();
    return new shop.empty_object();
  }

  // ===================================================================
  // Story open fee (Stories contract only)
  // ===================================================================

  pay_open_fee(args: shop.pay_open_fee_arguments): shop.empty_object {
    // The one call another contract may make, and only Stories.
    this.requireStoriesCaller();
    this.enter(false);
    this.requireNotPaused();

    const payer = this.requireAddress(args.payer, "SHOP: invalid payer address");
    this.requireSigner(payer, "SHOP: payer has not authorized this purchase");

    const kind = args.kind;
    System.require(
      kind == shop.story_kind.KIND_BOOK || kind == shop.story_kind.KIND_SHORT || kind == shop.story_kind.KIND_POEM,
      "SHOP: kind must be Book, Short Story or Poem"
    );
    const assetId = this.requireAddress(args.token, "SHOP: invalid token address");
    this.requireEnabledAsset(assetId);

    const cfg = this.loadConfig();
    const isBook = kind == shop.story_kind.KIND_BOOK;
    const isPoem = kind == shop.story_kind.KIND_POEM;
    const item = isBook ? shop.item.ITEM_OPEN_BOOK : isPoem ? shop.item.ITEM_OPEN_POEM : shop.item.ITEM_OPEN_SHORT;
    const starter = isBook ? cfg.starter_book : isPoem ? cfg.starter_poem : cfg.starter_short;
    System.require(starter > 0, "SHOP: starter Ink amount is not set");
    this.requireMinInk(starter, args.min_ink);
    const base = this.requirePrice(<u32>item, assetId);
    // Stories raises the price when the opener already has many projects open.
    const multiplier: u64 = args.price_multiplier <= 1 ? 1 : <u64>args.price_multiplier;
    System.require(multiplier <= MAX_PRICE_MULTIPLIER, "SHOP: price multiplier is too high");
    const price = SafeMath.mul(base, multiplier);
    this.requireMaxPrice(price, args.max_price);
    const memo = isBook ? "open:book" : isPoem ? "open:poem" : "open:short";

    this.takePayment(payer, assetId, <u32>item, price, starter, MINT_STARTER, memo);
    this.leave();
    return new shop.empty_object();
  }

  // ===================================================================
  // Promo
  // ===================================================================

  claim_promo(args: shop.claim_promo_arguments): shop.empty_object {
    this.enter();
    this.requireNotPaused();

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

    // Which link key must have signed? A shared campaign has one key for
    // everyone. A single-use campaign has one key per link, and each key
    // works once.
    let signer: Uint8Array;
    if (row.single_use) {
      signer = this.requireAddress(args.signer, "SHOP: promo link rejected");
      const statusKey = this.codeKey(args.campaign_id, signer);
      const status = this.singleUse.get(statusKey)!.value;
      System.require(status == CODE_AVAILABLE, status == CODE_USED
        ? "SHOP: promo link already used"
        : "SHOP: promo link rejected");
      this.singleUse.put(statusKey, new shop.uint32(CODE_USED));
    } else {
      signer = this.requireAddress(row.link_signer, "SHOP: promo link rejected");
    }
    this.requireLinkSignature(signer, this.promoDigest(args.campaign_id, account), args.signature, "SHOP: promo link rejected");

    const claimKey = this.codeKey(args.campaign_id, account);
    System.require(!this.campaignClaimed.get(claimKey)!.value, "SHOP: this wallet has already claimed this promo");

    const day = now / DAY_SECONDS;
    if (row.day != day) {
      row.day = day;
      row.used_today = 0;
    }
    const nextBudget = SafeMath.add(row.budget_used, row.amount);
    System.require(nextBudget <= row.budget_total, "SHOP: promo budget exhausted");
    // Counted even without a cap, so a cap set mid-day sees the day's
    // earlier claims (C1-04).
    const nextToday = SafeMath.add(row.used_today, row.amount);
    System.require(row.daily_cap == 0 || nextToday <= row.daily_cap, "SHOP: promo daily cap reached");
    row.used_today = nextToday;
    row.budget_used = nextBudget;
    this.campaigns.put(key, row);
    this.campaignClaimed.put(claimKey, new shop.boole(true));
    // The newest campaign claimed (Stories only asks "ever claimed?").
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
    // Turning a token on starts a public 7-day wait before anyone can pay
    // with it (C1-01), once the Shop has made its first sale: before that no
    // buyer is exposed, so the tokens set up for launch work at once. An
    // enabled token keeps its wait, and its decimals and symbol can't change
    // under buyers; turn it off first. Off is immediate, and keeps the
    // recorded decimals and symbol whatever the call says (audit M-D: the
    // off switch must work in an incident even with blank fields).
    const found = this.assets.get(assetId);
    let decimals = args.decimals;
    let symbol = this.text(args.symbol);
    if (!args.enabled && found != null) {
      decimals = found!.decimals;
      symbol = this.text(found!.symbol);
    }
    System.require(decimals <= MAX_DECIMALS, "SHOP: decimals must be from 0 to 18");
    System.require(symbol.length > 0 && symbol.length <= MAX_SYMBOL_LENGTH, "SHOP: symbol must be 1 to 16 characters");
    // At most MAX_ASSETS tokens ever get a record, so get_assets lists them all.
    if (found == null) {
      System.require(this.assets.getManyKeys(new Uint8Array(0), MAX_ASSETS).length < MAX_ASSETS, "SHOP: at most 10 payment tokens");
    }
    const wasOn = found != null && found.enabled;
    let usableFrom: u64 = 0;
    if (args.enabled) {
      if (wasOn) {
        System.require(found!.decimals == decimals && found!.symbol == symbol,
          "SHOP: turn the token off before changing its decimals or symbol");
        usableFrom = found!.usable_from;
      } else {
        const cfg = this.loadConfig();
        usableFrom = cfg.sold ? SafeMath.add(this.now(), ASSET_WAIT) : this.now();
      }
    }
    const row = new shop.asset(args.enabled, decimals, symbol, usableFrom);
    this.assets.put(assetId, row);
    const ev = new shop.asset_event(assetId, row.enabled, row.decimals, row.symbol, row.usable_from);
    System.event("shop.asset_event", Protobuf.encode(ev, shop.asset_event.encode), []);
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
    System.require(ink.length == 0 || stories.length == 0 || !Arrays.equal(ink, stories), "SHOP: Ink and Stories must be different contracts");

    const cfg = this.loadConfig();
    // Ink and Stories are each set once and can never be changed or cleared
    // (AB-050, C1-07). Every purchase calls Ink's mint inside the buyer's own
    // signed transaction, and Stories calls pay_open_fee inside the opener's,
    // so a contract swapped in by the admin key would act with their
    // signatures. Moving to a new one needs a reviewed code upload with the
    // Shop contract key. Treasury and founder stay changeable.
    System.require(this.sameOrUnset(cfg.ink, ink), "SHOP: the Ink address is already set and can never be changed");
    System.require(this.sameOrUnset(cfg.stories, stories), "SHOP: the Stories address is already set and can never be changed");
    cfg.treasury = treasury;
    cfg.founder = founder;
    cfg.ink = ink;
    cfg.stories = stories;
    this.saveConfig(cfg);
    const ev = new shop.addresses_event(treasury, founder, ink, stories);
    System.event("shop.addresses_event", Protobuf.encode(ev, shop.addresses_event.encode), []);
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
    cfg.starter_poem = args.starter_poem;
    this.saveConfig(cfg);
    const ev = new shop.ink_amounts_event(cfg.writer_ink, cfg.pack_s_ink, cfg.pack_m_ink, cfg.pack_l_ink, cfg.starter_book, cfg.starter_short, cfg.starter_poem);
    System.event("shop.ink_amounts_event", Protobuf.encode(ev, shop.ink_amounts_event.encode), []);
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

  // Step 1 of 2 (AB-016): propose. Admin moves only when the proposed
  // address accepts, so a typo cannot strand it.
  set_admin(args: shop.set_admin_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const proposed = this.requireAddress(args.new_admin, "SHOP: invalid admin address");
    const admin = this.getAdmin();
    const cfg = this.loadConfig();
    // Proposing the current admin cancels a pending handover.
    cfg.pending_admin = Arrays.equal(proposed, admin) ? null : proposed;
    this.config.put(cfg);
    const event = new shop.admin_proposed_event(admin, cfg.pending_admin);
    System.event(
      "shop.admin_proposed_event",
      Protobuf.encode(event, shop.admin_proposed_event.encode),
      [proposed]
    );
    this.leave();
    return new shop.empty_object();
  }

  // Step 2 of 2: the proposed admin signs to take over.
  accept_admin(args: shop.accept_admin_arguments): shop.empty_object {
    this.enter();
    const cfg = this.loadConfig();
    const pending = cfg.pending_admin;
    System.require(pending != null && pending.length == ADDRESS_LENGTH, "SHOP: no admin handover is pending");
    this.requireSigner(pending!, "SHOP: only the proposed admin can accept");
    const oldAdmin = this.getAdmin();
    cfg.admin = pending;
    cfg.pending_admin = null;
    this.config.put(cfg);
    const event = new shop.admin_changed_event(oldAdmin, pending);
    System.event(
      "shop.admin_changed_event",
      Protobuf.encode(event, shop.admin_changed_event.encode),
      [pending!]
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

    // Only the PUBLIC address of the link key is stored. The private key
    // stays in the share link and never touches the chain.
    let linkSigner = new Uint8Array(0);
    if (args.single_use) {
      System.require(
        args.link_signer == null || args.link_signer!.length == 0,
        "SHOP: single-use campaigns add their link keys separately"
      );
    } else {
      linkSigner = this.requireAddress(args.link_signer, "SHOP: a shared campaign needs a link key address");
    }

    const cfg = this.loadConfig();
    let id = cfg.next_campaign_id;
    if (id == 0) id = 1;
    cfg.next_campaign_id = SafeMath.add(id, 1);
    this.saveConfig(cfg);

    const row = new shop.campaign(
      linkSigner,
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

  // Each single-use link has its own key. Only the public addresses are
  // sent here, so publishing this transaction gives nothing away.
  add_single_use_signers(args: shop.add_single_use_signers_arguments): shop.empty_object {
    this.enter();
    this.requireAdmin();
    const row = this.requireCampaign(args.campaign_id);
    System.require(row.single_use, "SHOP: campaign is not single-use");
    const signers = args.signers;
    System.require(signers.length > 0, "SHOP: no link keys were provided");
    System.require(signers.length <= MAX_SIGNERS_PER_CALL, "SHOP: too many link keys in one call");

    for (let i = 0; i < signers.length; i++) {
      const signer = this.requireAddress(signers[i], "SHOP: invalid link key address");
      const statusKey = this.codeKey(args.campaign_id, signer);
      const status = this.singleUse.get(statusKey)!.value;
      System.require(status == 0, "SHOP: link key already added");
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
    memo: string,
    inkTo: Uint8Array | null = null
  ): void {
    const cfg = this.loadConfig();
    if (!cfg.sold) {
      cfg.sold = true;
      this.saveConfig(cfg);
    }
    const treasury = this.requireAddress(cfg.treasury, "SHOP: treasury is not set");
    const founder = this.requireAddress(cfg.founder, "SHOP: founder is not set");
    System.require(cfg.fee_bps <= MAX_FEE_BPS, "SHOP: fee is above the cap");

    const founderAmount = founderShare(price, cfg.fee_bps);
    const treasuryAmount = SafeMath.sub(price, founderAmount);
    System.require(treasuryAmount > 0, "SHOP: treasury amount is zero");

    // Security fix M1: check the outcome, not the token's answer.
    // Read both balances first, move the money, then read them again.
    // Treasury and founder may be the same wallet (common on a testnet),
    // so in that case the whole price must arrive at that one address.
    const sameWallet = Arrays.equal(treasury, founder);
    const founderLeg = founderAmount > 0 && !sameWallet;
    const treasuryBefore = this.readBalance(assetId, treasury);
    const founderBefore = founderLeg ? this.readBalance(assetId, founder) : 0;

    this.transferToken(assetId, payer, treasury, treasuryAmount);
    if (founderAmount > 0) {
      this.transferToken(assetId, payer, founder, founderAmount);
    }

    const treasuryAfter = this.readBalance(assetId, treasury);
    const treasuryExpected = sameWallet ? price : treasuryAmount;
    System.require(
      treasuryAfter >= treasuryBefore && treasuryAfter - treasuryBefore == treasuryExpected,
      "SHOP: stablecoin payment did not arrive"
    );
    if (founderLeg) {
      const founderAfter = this.readBalance(assetId, founder);
      System.require(
        founderAfter >= founderBefore && founderAfter - founderBefore == founderAmount,
        "SHOP: stablecoin payment did not arrive"
      );
    }
    if (inkAmount > 0) {
      this.mintInk(inkTo != null ? inkTo! : payer, inkAmount, inkReason, memo);
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

  // Field 1, wire type 0, value 0: the protobuf encoding of `bool value = false`.
  private transferResultIsFalse(raw: Uint8Array): bool {
    return raw.length >= 2 && raw[0] == 8 && raw[1] == 0;
  }

  private transferToken(assetId: Uint8Array, from: Uint8Array, to: Uint8Array, amount: u64): void {
    const args = new token.transfer_arguments(from, to, amount);
    const payload = Protobuf.encode(args, token.transfer_arguments.encode);
    this.callOut(assetId, TOKEN_TRANSFER_ENTRY, payload, [from, to], "SHOP: stablecoin transfer failed");
  }

  // A read of the token's own ledger. An empty answer means a balance of 0.
  private readBalance(assetId: Uint8Array, owner: Uint8Array): u64 {
    const args = new token.balance_of_arguments(owner);
    const res = System.call(assetId, TOKEN_BALANCE_OF_ENTRY, Protobuf.encode(args, token.balance_of_arguments.encode));
    System.require(res.code == 0, "SHOP: could not read the stablecoin balance");
    const raw = res.res.object;
    if (raw == null || raw!.length == 0) return 0;
    return Protobuf.decode<token.balance_of_result>(raw!, token.balance_of_result.decode).value;
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
    // Some tokens return exit code 0 and a protobuf bool of false when they
    // refuse the transfer. That must not count as a payment. An empty result
    // still counts as success: tokens built with SDK 1.0.0 encode
    // transfer_result as empty bytes.
    if (entryPoint == TOKEN_TRANSFER_ENTRY) {
      const raw = callRes.res.object;
      if (raw != null && this.transferResultIsFalse(raw!)) System.require(false, message);
    }
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

  // The payer signs the most they agreed to pay (AB-017). A price changed
  // after they looked, or a client that sends no limit, charges nothing.
  private requireMaxPrice(price: u64, maxPrice: u64): void {
    System.require(price <= maxPrice, "SHOP: the price is " + price.toString() + ", more than the most you agreed to pay. Nothing was charged.");
  }

  // And the least Ink they agreed to get (M-2): an Ink amount lowered after
  // they looked charges nothing.
  private requireMinInk(ink: u64, minInk: u64): void {
    System.require(ink >= minInk, "SHOP: this now brings " + ink.toString() + " Ink, less than the " + minInk.toString() + " you agreed to. Nothing was charged.");
  }

  // Security fix H1. A transaction that calls Shop itself has no calling
  // contract. Anything else is another app acting in the user's name.
  private requireDirectCall(): void {
    const caller = System.getCaller().caller;
    System.require(
      caller == null || caller.length == 0,
      "SHOP: call SwarmTales directly from your wallet, not through another contract"
    );
  }

  // The 32-byte multihash digest the link key signed.
  private promoDigest(campaignId: u64, account: Uint8Array): Uint8Array {
    const domain = StringBytes.stringToBytes(PROMO_DOMAIN);
    const id = this.idKey(campaignId);
    const msg = new Uint8Array(domain.length + ADDRESS_LENGTH + 8 + ADDRESS_LENGTH);
    memory.copy(msg.dataStart, domain.dataStart, domain.length);
    memory.copy(msg.dataStart + domain.length, this.contractId.dataStart, ADDRESS_LENGTH);
    memory.copy(msg.dataStart + domain.length + ADDRESS_LENGTH, id.dataStart, 8);
    memory.copy(msg.dataStart + domain.length + ADDRESS_LENGTH + 8, account.dataStart, ADDRESS_LENGTH);
    const digest = System.hash(Crypto.multicodec.sha2_256, msg);
    System.require(digest != null, "SHOP: could not hash the promo link");
    return digest!;
  }

  // The signature must recover to the stored link key address.
  private requireLinkSignature(signer: Uint8Array, digest: Uint8Array, signature: Uint8Array | null, message: string): void {
    System.require(signature != null && signature.length == SIGNATURE_LENGTH, message);
    const pub = System.recoverPublicKey(signature!, digest);
    System.require(pub != null, message);
    System.require(Arrays.equal(Crypto.addressFromPublicKey(pub!), signer), message);
  }

  private requireNotPaused(): void {
    System.require(!this.loadConfig().paused, "SHOP: shop is paused");
  }

  // Held across the whole call, including the signature check, so a token
  // or authority contract cannot call back into Shop mid-payment. Every
  // entry point but pay_open_fee must be called directly (fix H1); that is
  // checked first, before anything is written.
  private enter(direct: bool = true): void {
    if (direct) this.requireDirectCall();
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
    System.require(found != null && found.enabled, "SHOP: asset is not accepted");
    System.require(this.now() >= found!.usable_from, "SHOP: this token was enabled recently and can't be used yet");
  }

  private sameOrUnset(stored: Uint8Array | null, value: Uint8Array): bool {
    return stored == null || stored.length == 0 || Arrays.equal(stored!, value);
  }

  // The stored record, with Reader time saved under an ended Writer term
  // resumed (C1-03). Reads return this; writes save it.
  private membership(account: Uint8Array, now: u64): shop.membership {
    const m = this.memberships.get(account)!;
    if (m.tier == shop.tier.TIER_WRITER && m.paid_until <= now && m.reader_left > 0) {
      m.tier = shop.tier.TIER_READER;
      m.paid_until = SafeMath.add(m.paid_until, m.reader_left);
      m.reader_left = 0;
      m.months_unclaimed = 0;
      m.next_claim_at = 0;
      m.ink_per_month = 0;
    }
    return m;
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
    return (item >= <u32>shop.item.ITEM_READER_MONTH && item <= <u32>shop.item.ITEM_OPEN_SHORT) || item == <u32>shop.item.ITEM_OPEN_POEM;
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
