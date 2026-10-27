// =====================================================================
// SwarmTales Editions — smart contract (AssemblyScript, Koinos SDK)
//
// Keepsake editions of finished books (see editions.proto for the whole
// picture). In short:
//
//   First Edition        the opener, free, can't be moved
//   Contributor Edition  each writer whose surviving text reaches the
//                        story's contributor_edition_min, free, can't be moved
//   Collector's Edition  readers buy it at a fixed price; numbered, no cap;
//                        the owner may give or sell it on
//
// MONEY
//   A sale moves the price from the buyer in the buyer's own signed
//   transaction: platform_bps of it to the treasury, the rest to this
//   contract for the book's writers. Like Shop, the contract checks the
//   balances before and after, not the token's answer.
//   A writer's earnings from a book in a token are
//       floor(received * their_surviving / surviving_sum)
//   read live from Stories, minus what they were already paid, and never
//   more than the book's pot still holds. So a book can never pay out more
//   than it received, whatever later takedowns do to the shares, and one
//   book's pot can't be paid from another's.
//   Paying out uses the token's own rule that a contract may move its own
//   tokens (KCS-4, "the contract caller is the owner"). This contract has
//   no authority override and no admin withdraw: the admin can't move the
//   writers' money.
//
// WHO MAY CALL
//   Every action must come straight from the transaction (fix H1 in Shop):
//   another contract can't act in a user's name here.
// =====================================================================

import { System, Storage, authority, Protobuf, SafeMath, Arrays, chain } from "@koinos/sdk-as";
import { editions } from "./proto/editions";

const CONFIG_SPACE_ID: u32 = 0;
const TOKENS_SPACE_ID: u32 = 1;
const PRICES_SPACE_ID: u32 = 2;
const EDITIONS_SPACE_ID: u32 = 3;
const BY_OWNER_SPACE_ID: u32 = 4;
const BALANCES_SPACE_ID: u32 = 5;
const WRITER_EDITIONS_SPACE_ID: u32 = 6;
const BOOKS_SPACE_ID: u32 = 7;
const POTS_SPACE_ID: u32 = 8;
const PAID_SPACE_ID: u32 = 9;
const LOCK_SPACE_ID: u32 = 10;

const ADDRESS_LENGTH: i32 = 25;
const ID_LENGTH: i32 = 8;
const MAX_PAYMENT_TOKENS: i32 = 4;
const DEFAULT_PLATFORM_BPS: u32 = 2000;
// Writers always get at least 70% of a sale.
const MAX_PLATFORM_BPS: u32 = 3000;
const BPS: u64 = 10000;
const MAX_LIST: i32 = 100;
const MAX_SITE_LENGTH: i32 = 200;
const MAX_MEMO_LENGTH: i32 = 200;

const NAME = "SwarmTales Editions";
const SYMBOL = "STED";

// Stories' finished status (stories.proto STATUS_FINALIZED).
const STORY_FINALIZED: u32 = 4;

// Entry points of the contracts this one reads or pays through.
const STORIES_GET_STORY: u32 = 0x848a44b5;
const STORIES_GET_SURVIVING_TOTAL: u32 = 0x4af2a6bf;
const SHOP_GET_ASSET: u32 = 0xaedce590;
const TOKEN_TRANSFER: u32 = 0x27f576ca;
const TOKEN_BALANCE_OF: u32 = 0x5c721497;

/** 8 bytes, big-endian: sorts like the number. */
export function idKey(id: u64): Uint8Array {
  const out = new Uint8Array(ID_LENGTH);
  for (let i = 0; i < ID_LENGTH; i++) out[i] = <u8>((id >> (<u64>(56 - 8 * i))) & 0xff);
  return out;
}

export function idFromKey(key: Uint8Array, offset: i32 = 0): u64 {
  let id: u64 = 0;
  for (let i = 0; i < ID_LENGTH; i++) id = (id << 8) | <u64>key[offset + i];
  return id;
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * floor(a * b / c) for b <= c without overflowing: (a / c) * b + (a % c) * b / c.
 * The second product is below c * c, so c is kept below 2^32. Exported for the tests.
 */
export function shareOf(a: u64, b: u64, c: u64): u64 {
  if (c == 0 || b == 0) return 0;
  System.require(b <= c, "EDITIONS: a writer's share can't exceed the whole");
  System.require(c < 4294967296, "EDITIONS: surviving total too large");
  return SafeMath.add(SafeMath.mul(a / c, b), SafeMath.mul(a % c, b) / c);
}

/** Text for a JSON string value: quotes, backslashes and control characters escaped. */
export function jsonText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c == 0x22) out += "\\\"";
    else if (c == 0x5c) out += "\\\\";
    else if (c < 0x20) {
      const hex = "0123456789abcdef";
      out += "\\u00" + hex.charAt(c >> 4) + hex.charAt(c & 15);
    } else out += String.fromCharCode(c);
  }
  return out;
}

export class Editions {
  contractId: Uint8Array;
  config: Storage.Obj<editions.config>;
  tokens: Storage.Map<Uint8Array, editions.token_settings>;
  prices: Storage.Map<Uint8Array, editions.uint64>;
  editionsById: Storage.Map<Uint8Array, editions.edition>;
  byOwner: Storage.Map<Uint8Array, editions.boole>;
  balances: Storage.Map<Uint8Array, editions.uint64>;
  writerEditions: Storage.Map<Uint8Array, editions.uint64>;
  books: Storage.Map<Uint8Array, editions.book_editions>;
  pots: Storage.Map<Uint8Array, editions.pot>;
  paid: Storage.Map<Uint8Array, editions.uint64>;
  lock: Storage.Obj<editions.boole>;

  constructor() {
    this.contractId = System.getContractId();
    this.config = new Storage.Obj(this.contractId, CONFIG_SPACE_ID, editions.config.decode, editions.config.encode,
      () => {
        const c = new editions.config();
        c.platform_bps = DEFAULT_PLATFORM_BPS;
        return c;
      });
    this.tokens = new Storage.Map(this.contractId, TOKENS_SPACE_ID, editions.token_settings.decode, editions.token_settings.encode, null);
    this.prices = new Storage.Map(this.contractId, PRICES_SPACE_ID, editions.uint64.decode, editions.uint64.encode, () => new editions.uint64(0));
    this.editionsById = new Storage.Map(this.contractId, EDITIONS_SPACE_ID, editions.edition.decode, editions.edition.encode, null);
    this.byOwner = new Storage.Map(this.contractId, BY_OWNER_SPACE_ID, editions.boole.decode, editions.boole.encode, null);
    this.balances = new Storage.Map(this.contractId, BALANCES_SPACE_ID, editions.uint64.decode, editions.uint64.encode, () => new editions.uint64(0));
    this.writerEditions = new Storage.Map(this.contractId, WRITER_EDITIONS_SPACE_ID, editions.uint64.decode, editions.uint64.encode, () => new editions.uint64(0));
    this.books = new Storage.Map(this.contractId, BOOKS_SPACE_ID, editions.book_editions.decode, editions.book_editions.encode, () => new editions.book_editions());
    this.pots = new Storage.Map(this.contractId, POTS_SPACE_ID, editions.pot.decode, editions.pot.encode, () => new editions.pot());
    this.paid = new Storage.Map(this.contractId, PAID_SPACE_ID, editions.uint64.decode, editions.uint64.encode, () => new editions.uint64(0));
    this.lock = new Storage.Obj(this.contractId, LOCK_SPACE_ID, editions.boole.decode, editions.boole.encode, () => new editions.boole(false));
  }

  // ===================================================================
  // SwarmTales reads
  // ===================================================================

  get_config(args: editions.get_config_arguments): editions.config {
    const cfg = this.config.get()!;
    if (cfg.admin == null || cfg.admin!.length == 0) cfg.admin = this.contractId;
    return cfg;
  }

  get_token_settings(args: editions.get_token_settings_arguments): editions.token_settings {
    const found = args.token != null ? this.tokens.get(args.token!) : null;
    return found != null ? found! : new editions.token_settings();
  }

  get_price(args: editions.get_price_arguments): editions.uint64 {
    if (args.token == null) return new editions.uint64(0);
    return new editions.uint64(this.priceFor(args.story_id, args.token!));
  }

  get_pot(args: editions.get_pot_arguments): editions.pot {
    if (args.token == null) return new editions.pot();
    return this.pots.get(this.bookTokenKey(args.story_id, args.token!))!;
  }

  get_earnings(args: editions.get_earnings_arguments): editions.earnings {
    if (args.token == null || args.writer == null) return new editions.earnings();
    return this.earningsOf(args.story_id, args.token!, args.writer!);
  }

  get_edition(args: editions.get_edition_arguments): editions.edition {
    const found = this.editionsById.get(idKey(args.token_number));
    return found != null ? found! : new editions.edition();
  }

  get_writer_edition(args: editions.get_writer_edition_arguments): editions.uint64 {
    if (args.writer == null) return new editions.uint64(0);
    return this.writerEditions.get(join(idKey(args.story_id), args.writer!))!;
  }

  get_book_editions(args: editions.get_book_editions_arguments): editions.book_editions {
    return this.books.get(idKey(args.story_id))!;
  }

  // ===================================================================
  // KCS-5 reads
  // ===================================================================

  name(args: editions.name_arguments): editions.str {
    return new editions.str(NAME);
  }

  symbol(args: editions.symbol_arguments): editions.str {
    return new editions.str(SYMBOL);
  }

  // Empty: the metadata is on chain (metadata_of), as KCS-5 allows.
  uri(args: editions.uri_arguments): editions.str {
    return new editions.str("");
  }

  owner(args: editions.owner_arguments): editions.address {
    return new editions.address(this.getAdmin());
  }

  total_supply(args: editions.total_supply_arguments): editions.uint64 {
    return new editions.uint64(this.config.get()!.total_supply);
  }

  royalties(args: editions.royalties_arguments): editions.royalties_result {
    return new editions.royalties_result();
  }

  balance_of(args: editions.balance_of_arguments): editions.uint64 {
    if (args.owner == null) return new editions.uint64(0);
    return this.balances.get(args.owner!)!;
  }

  owner_of(args: editions.owner_of_arguments): editions.address {
    const found = this.findEdition(args.token_id);
    return new editions.address(found != null ? found!.owner : new Uint8Array(0));
  }

  metadata_of(args: editions.metadata_of_arguments): editions.str {
    const found = this.findEdition(args.token_id);
    if (found == null) return new editions.str("");
    const ed = found!;
    const number = idFromKey(args.token_id!);
    const cfg = this.config.get()!;
    let label = "";
    let kind = "";
    if (ed.kind == editions.edition_kind.EDITION_FIRST) {
      label = "First Edition";
      kind = "first";
    } else if (ed.kind == editions.edition_kind.EDITION_CONTRIBUTOR) {
      label = "Contributor Edition";
      kind = "contributor";
    } else {
      label = "Collector's Edition No. " + ed.number.toString();
      kind = "collector";
    }
    const site = this.text(cfg.site);
    const title = this.text(ed.title);
    const link = site.length > 0 ? site + "/#/stories/" + ed.story_id.toString() : "";
    const json = "{\"name\":\"" + jsonText(title + ": " + label) + "\"," +
      "\"description\":\"" + jsonText("A keepsake " + label + " of the SwarmTales book “" + title + "”. It is not an investment and gives no copyright in the book.") + "\"," +
      "\"edition\":\"" + kind + "\"," +
      "\"story_id\":\"" + ed.story_id.toString() + "\"," +
      "\"number\":\"" + ed.number.toString() + "\"," +
      "\"token_number\":\"" + number.toString() + "\"," +
      "\"made_at\":\"" + ed.made_at.toString() + "\"," +
      "\"transferable\":" + (ed.kind == editions.edition_kind.EDITION_COLLECTOR ? "true" : "false") +
      (link.length > 0 ? ",\"external_url\":\"" + jsonText(link) + "\"" : "") + "}";
    return new editions.str(json);
  }

  get_tokens(args: editions.get_tokens_arguments): editions.token_ids {
    const limit = this.listLimit(args.limit);
    let start = args.start != null && args.start!.length == ID_LENGTH ? args.start! : new Uint8Array(0);
    if (args.descending && start.length == 0) start = idKey(u64.MAX_VALUE);
    const keys = this.editionsById.getManyKeys(start, limit,
      args.descending ? Storage.Direction.Descending : Storage.Direction.Ascending);
    return new editions.token_ids(keys);
  }

  get_tokens_by_owner(args: editions.get_tokens_by_owner_arguments): editions.token_ids {
    const out: Uint8Array[] = [];
    if (args.owner == null || args.owner!.length != ADDRESS_LENGTH) return new editions.token_ids(out);
    const owner = args.owner!;
    const limit = this.listLimit(args.limit);
    const hasStart = args.start != null && args.start!.length == ID_LENGTH;
    let key = join(owner, hasStart ? args.start! : (args.descending ? idKey(u64.MAX_VALUE) : new Uint8Array(0)));
    while (out.length < limit) {
      const next = args.descending
        ? System.getPrevObject<Uint8Array, editions.boole>(this.ownerSpace(), key, editions.boole.decode)
        : System.getNextObject<Uint8Array, editions.boole>(this.ownerSpace(), key, editions.boole.decode);
      if (next == null) break;
      const k = next.key!;
      if (k.length != ADDRESS_LENGTH + ID_LENGTH || !Arrays.equal(k.subarray(0, ADDRESS_LENGTH), owner)) break;
      out.push(k.slice(ADDRESS_LENGTH));
      key = k;
    }
    return new editions.token_ids(out);
  }

  get_approved(args: editions.get_approved_arguments): editions.approved_result {
    return new editions.approved_result();
  }

  is_approved_for_all(args: editions.is_approved_for_all_arguments): editions.boole {
    return new editions.boole(false);
  }

  get_operator_approvals(args: editions.get_operator_approvals_arguments): editions.operator_approvals_result {
    return new editions.operator_approvals_result(args.owner, []);
  }

  // ===================================================================
  // Readers and writers
  // ===================================================================

  buy_edition(args: editions.buy_edition_arguments): editions.empty_object {
    this.enter();
    this.requireNotPaused();
    const buyer = this.requireAddress(args.buyer, "EDITIONS: invalid buyer address");
    const token = this.requireAddress(args.token, "EDITIONS: invalid token address");
    this.requireSigner(buyer, "EDITIONS: the buyer must sign");
    const st = this.readStory(args.story_id);
    this.requireFinished(st);
    System.require(!st.needs_new_pdf, "EDITIONS: this book is being updated after a takedown; editions are on sale again once it's republished");
    System.require(st.surviving_sum > 0, "EDITIONS: this book has no surviving text to share");
    this.requireUsableToken(token);
    const price = this.priceFor(args.story_id, token);
    System.require(price > 0, "EDITIONS: this book isn't on sale in that token");
    System.require(price <= args.max_price, "EDITIONS: the price is " + price.toString() + ", more than the most you agreed to pay. Nothing was charged.");

    const cfg = this.config.get()!;
    const treasury = this.requireAddress(cfg.treasury, "EDITIONS: treasury is not set");
    System.require(cfg.platform_bps <= MAX_PLATFORM_BPS, "EDITIONS: platform share is above the cap");
    const toTreasury = SafeMath.mul(price / BPS, <u64>cfg.platform_bps) + SafeMath.mul(price % BPS, <u64>cfg.platform_bps) / BPS;
    const toWriters = SafeMath.sub(price, toTreasury);
    System.require(toWriters > 0, "EDITIONS: the writers' part is zero");
    System.require(!Arrays.equal(buyer, this.contractId) && !Arrays.equal(buyer, treasury), "EDITIONS: this wallet can't buy editions");

    // Check the outcome, not the token's answer (as Shop, fix M1).
    const treasuryBefore = toTreasury > 0 ? this.readBalance(token, treasury) : 0;
    const poolBefore = this.readBalance(token, this.contractId);
    if (toTreasury > 0) this.transferToken(token, buyer, treasury, toTreasury);
    this.transferToken(token, buyer, this.contractId, toWriters);
    if (toTreasury > 0) {
      const after = this.readBalance(token, treasury);
      System.require(after >= treasuryBefore && after - treasuryBefore == toTreasury, "EDITIONS: payment did not arrive");
    }
    const poolAfter = this.readBalance(token, this.contractId);
    System.require(poolAfter >= poolBefore && poolAfter - poolBefore == toWriters, "EDITIONS: payment did not arrive");

    const potKey = this.bookTokenKey(args.story_id, token);
    const pot = this.pots.get(potKey)!;
    pot.received = SafeMath.add(pot.received, toWriters);
    pot.sales = SafeMath.add(pot.sales, 1);
    this.pots.put(potKey, pot);

    const book = this.books.get(idKey(args.story_id))!;
    book.collector_count = SafeMath.add(book.collector_count, 1);
    this.books.put(idKey(args.story_id), book);
    const tokenNumber = this.mint(buyer, args.story_id, editions.edition_kind.EDITION_COLLECTOR, book.collector_count, this.text(st.title));

    const ev = new editions.sale_event(buyer, args.story_id, token, price, toTreasury, toWriters, tokenNumber, book.collector_count);
    System.event("editions.sale_event", Protobuf.encode(ev, editions.sale_event.encode), [buyer, treasury]);
    this.leave();
    return new editions.empty_object();
  }

  claim_writer_edition(args: editions.claim_writer_edition_arguments): editions.empty_object {
    this.enter();
    this.requireNotPaused();
    const writer = this.requireAddress(args.writer, "EDITIONS: invalid writer address");
    this.requireSigner(writer, "EDITIONS: the writer must sign");
    const st = this.readStory(args.story_id);
    this.requireFinished(st);
    const key = join(idKey(args.story_id), writer);
    System.require(this.writerEditions.get(key)!.value == 0, "EDITIONS: you already claimed your edition of this book");
    let kind = editions.edition_kind.EDITION_CONTRIBUTOR;
    if (st.opener != null && Arrays.equal(st.opener!, writer)) {
      kind = editions.edition_kind.EDITION_FIRST;
    } else {
      const surviving = this.readSurviving(args.story_id, writer);
      const min = st.contributor_edition_min > 0 ? st.contributor_edition_min : 1;
      System.require(surviving >= min,
        "EDITIONS: your text in the finished book is " + surviving.toString() + " characters; a Contributor Edition needs " + min.toString());
    }
    const book = this.books.get(idKey(args.story_id))!;
    book.writer_count = SafeMath.add(book.writer_count, 1);
    this.books.put(idKey(args.story_id), book);
    const tokenNumber = this.mint(writer, args.story_id, kind, 0, this.text(st.title));
    this.writerEditions.put(key, new editions.uint64(tokenNumber));
    this.leave();
    return new editions.empty_object();
  }

  claim_earnings(args: editions.claim_earnings_arguments): editions.empty_object {
    this.enter();
    const writer = this.requireAddress(args.writer, "EDITIONS: invalid writer address");
    const token = this.requireAddress(args.token, "EDITIONS: invalid token address");
    System.require(!Arrays.equal(writer, this.contractId), "EDITIONS: invalid writer address");
    const e = this.earningsOf(args.story_id, token, writer);
    System.require(e.owed > 0, "EDITIONS: nothing to claim yet");

    const potKey = this.bookTokenKey(args.story_id, token);
    const pot = this.pots.get(potKey)!;
    pot.paid = SafeMath.add(pot.paid, e.owed);
    System.require(pot.paid <= pot.received, "EDITIONS: the book's pot is empty");
    this.pots.put(potKey, pot);
    const paidKey = join(potKey, writer);
    this.paid.put(paidKey, new editions.uint64(SafeMath.add(e.paid, e.owed)));

    const writerBefore = this.readBalance(token, writer);
    const poolBefore = this.readBalance(token, this.contractId);
    this.transferToken(token, this.contractId, writer, e.owed);
    const writerAfter = this.readBalance(token, writer);
    const poolAfter = this.readBalance(token, this.contractId);
    System.require(writerAfter >= writerBefore && writerAfter - writerBefore == e.owed, "EDITIONS: payout did not arrive");
    System.require(poolBefore >= poolAfter && poolBefore - poolAfter == e.owed, "EDITIONS: payout did not arrive");

    const ev = new editions.earnings_event(writer, args.story_id, token, e.owed);
    System.event("editions.earnings_event", Protobuf.encode(ev, editions.earnings_event.encode), [writer]);
    this.leave();
    return new editions.empty_object();
  }

  set_book_price(args: editions.set_book_price_arguments): editions.empty_object {
    this.enter();
    const opener = this.requireAddress(args.opener, "EDITIONS: invalid opener address");
    const token = this.requireAddress(args.token, "EDITIONS: invalid token address");
    this.requireSigner(opener, "EDITIONS: the opener must sign");
    const st = this.readStory(args.story_id);
    System.require(st.opener != null && Arrays.equal(st.opener!, opener), "EDITIONS: only the story's opener sets its price");
    const settings = this.tokens.get(token);
    System.require(settings != null && settings!.enabled, "EDITIONS: that token isn't accepted for editions");
    if (args.price > 0) {
      System.require(args.price >= settings!.min_price && args.price <= settings!.max_price,
        "EDITIONS: choose a price from " + settings!.min_price.toString() + " to " + settings!.max_price.toString());
    }
    this.prices.put(this.bookTokenKey(args.story_id, token), new editions.uint64(args.price));
    const ev = new editions.book_price_event(args.story_id, token, args.price);
    System.event("editions.book_price_event", Protobuf.encode(ev, editions.book_price_event.encode), [opener]);
    this.leave();
    return new editions.empty_object();
  }

  transfer(args: editions.transfer_arguments): editions.empty_object {
    this.enter();
    const from = this.requireAddress(args.from, "EDITIONS: invalid sender address");
    const to = this.requireAddress(args.to, "EDITIONS: invalid recipient address");
    System.require(!Arrays.equal(from, to), "EDITIONS: sender and recipient are the same");
    System.require(!Arrays.equal(to, this.contractId), "EDITIONS: can't send an edition to the Editions contract");
    System.require(this.text(args.memo).length <= MAX_MEMO_LENGTH, "EDITIONS: memo too long");
    const tokenId = this.requireTokenId(args.token_id);
    const ed = this.editionsById.get(tokenId);
    System.require(ed != null && ed!.owner != null && ed!.owner!.length == ADDRESS_LENGTH, "EDITIONS: no such edition");
    System.require(Arrays.equal(ed!.owner!, from), "EDITIONS: that wallet doesn't hold this edition");
    System.require(ed!.kind == editions.edition_kind.EDITION_COLLECTOR, "EDITIONS: First and Contributor Editions stay with their writer");
    this.requireSigner(from, "EDITIONS: the holder must sign");
    this.byOwner.remove(join(from, tokenId));
    this.byOwner.put(join(to, tokenId), new editions.boole(true));
    this.addBalance(from, false);
    this.addBalance(to, true);
    ed!.owner = to;
    this.editionsById.put(tokenId, ed!);
    const ev = new editions.transfer_event(from, to, tokenId, this.text(args.memo));
    System.event("collections.transfer_event", Protobuf.encode(ev, editions.transfer_event.encode), [to, from]);
    this.leave();
    return new editions.empty_object();
  }

  burn(args: editions.burn_arguments): editions.empty_object {
    this.enter();
    System.require(this.text(args.memo).length <= MAX_MEMO_LENGTH, "EDITIONS: memo too long");
    const tokenId = this.requireTokenId(args.token_id);
    const ed = this.editionsById.get(tokenId);
    System.require(ed != null && ed!.owner != null && ed!.owner!.length == ADDRESS_LENGTH, "EDITIONS: no such edition");
    const holder = ed!.owner!;
    this.requireSigner(holder, "EDITIONS: the holder must sign");
    this.byOwner.remove(join(holder, tokenId));
    this.addBalance(holder, false);
    this.editionsById.remove(tokenId);
    const cfg = this.config.get()!;
    cfg.total_supply = SafeMath.sub(cfg.total_supply, 1);
    this.config.put(cfg);
    // A burned writer's edition stays claimed: it can't be minted again.
    const ev = new editions.burn_event(holder, tokenId, this.text(args.memo));
    System.event("collections.burn_event", Protobuf.encode(ev, editions.burn_event.encode), [holder]);
    this.leave();
    return new editions.empty_object();
  }

  approve(args: editions.approve_arguments): editions.empty_object {
    System.require(false, "EDITIONS: approvals aren't offered; the holder sends editions directly");
    return new editions.empty_object();
  }

  set_approval_for_all(args: editions.set_approval_for_all_arguments): editions.empty_object {
    System.require(false, "EDITIONS: approvals aren't offered; the holder sends editions directly");
    return new editions.empty_object();
  }

  // ===================================================================
  // Admin
  // ===================================================================

  set_addresses(args: editions.set_addresses_arguments): editions.empty_object {
    this.enter();
    this.requireAdmin();
    const stories = this.requireAddress(args.stories, "EDITIONS: invalid Stories address");
    const shopId = this.requireAddress(args.shop, "EDITIONS: invalid Shop address");
    const treasury = this.requireAddress(args.treasury, "EDITIONS: invalid treasury address");
    const cfg = this.config.get()!;
    // Stories and Shop are set once: a different Stories could report
    // other shares and send the writers' money elsewhere.
    System.require(this.sameOrUnset(cfg.stories, stories), "EDITIONS: the Stories address is already set");
    System.require(this.sameOrUnset(cfg.shop, shopId), "EDITIONS: the Shop address is already set");
    System.require(!Arrays.equal(stories, shopId) && !Arrays.equal(stories, this.contractId) && !Arrays.equal(shopId, this.contractId),
      "EDITIONS: Stories, Shop and Editions must differ");
    System.require(!Arrays.equal(treasury, this.contractId), "EDITIONS: the treasury can't be the Editions contract");
    cfg.stories = stories;
    cfg.shop = shopId;
    cfg.treasury = treasury;
    this.saveConfig(cfg);
    this.leave();
    return new editions.empty_object();
  }

  set_payment_token(args: editions.set_payment_token_arguments): editions.empty_object {
    this.enter();
    this.requireAdmin();
    const token = this.requireAddress(args.token, "EDITIONS: invalid token address");
    const s = args.settings != null ? args.settings! : new editions.token_settings();
    const cfg = this.config.get()!;
    System.require(!Arrays.equal(token, this.contractId) &&
      (cfg.stories == null || !Arrays.equal(token, cfg.stories!)) && (cfg.shop == null || !Arrays.equal(token, cfg.shop!)),
    "EDITIONS: a payment token can't be a SwarmTales contract");
    if (s.enabled) {
      System.require(s.min_price > 0 && s.min_price <= s.default_price && s.default_price <= s.max_price,
        "EDITIONS: prices must satisfy 0 < min <= default <= max");
    }
    let listed = false;
    for (let i = 0; i < cfg.payment_tokens.length; i++) {
      if (Arrays.equal(cfg.payment_tokens[i], token)) listed = true;
    }
    if (!listed) {
      System.require(cfg.payment_tokens.length < MAX_PAYMENT_TOKENS, "EDITIONS: at most 4 payment tokens");
      cfg.payment_tokens.push(token);
      this.saveConfig(cfg);
    }
    this.tokens.put(token, s);
    const ev = new editions.payment_token_event(token, s);
    System.event("editions.payment_token_event", Protobuf.encode(ev, editions.payment_token_event.encode), []);
    this.leave();
    return new editions.empty_object();
  }

  set_platform_bps(args: editions.set_platform_bps_arguments): editions.empty_object {
    this.enter();
    this.requireAdmin();
    System.require(args.bps <= MAX_PLATFORM_BPS, "EDITIONS: the platform share can't be above 30%");
    const cfg = this.config.get()!;
    cfg.platform_bps = args.bps;
    this.saveConfig(cfg);
    this.leave();
    return new editions.empty_object();
  }

  set_site(args: editions.set_site_arguments): editions.empty_object {
    this.enter();
    this.requireAdmin();
    const site = this.text(args.site);
    System.require(site.length <= MAX_SITE_LENGTH, "EDITIONS: site address too long");
    System.require(site.length == 0 || site.startsWith("https://"), "EDITIONS: the site address must start with https://");
    const cfg = this.config.get()!;
    cfg.site = site;
    this.saveConfig(cfg);
    this.leave();
    return new editions.empty_object();
  }

  set_paused(args: editions.set_paused_arguments): editions.empty_object {
    this.enter();
    this.requireAdmin();
    const cfg = this.config.get()!;
    cfg.paused = args.paused;
    this.saveConfig(cfg);
    this.leave();
    return new editions.empty_object();
  }

  set_admin(args: editions.set_admin_arguments): editions.empty_object {
    this.enter();
    this.requireAdmin();
    const proposed = this.requireAddress(args.admin, "EDITIONS: invalid admin address");
    const cfg = this.config.get()!;
    cfg.pending_admin = Arrays.equal(proposed, this.getAdmin()) ? null : proposed;
    this.saveConfig(cfg);
    this.leave();
    return new editions.empty_object();
  }

  accept_admin(args: editions.accept_admin_arguments): editions.empty_object {
    this.enter();
    const cfg = this.config.get()!;
    const pending = cfg.pending_admin;
    System.require(pending != null && pending!.length == ADDRESS_LENGTH, "EDITIONS: no admin handover is pending");
    this.requireSigner(pending!, "EDITIONS: only the proposed admin can accept");
    cfg.admin = pending;
    cfg.pending_admin = null;
    this.saveConfig(cfg);
    this.leave();
    return new editions.empty_object();
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  private earningsOf(storyId: u64, token: Uint8Array, writer: Uint8Array): editions.earnings {
    const potKey = this.bookTokenKey(storyId, token);
    const pot = this.pots.get(potKey)!;
    const paid = this.paid.get(join(potKey, writer))!.value;
    if (pot.received == 0) return new editions.earnings(0, paid, 0);
    const st = this.readStory(storyId);
    const mine = this.readSurviving(storyId, writer);
    const sum = st.surviving_sum;
    // A share can't exceed the whole, even if the two reads ever disagree.
    const share = mine > sum ? sum : mine;
    const earned = shareOf(pot.received, share, sum);
    let owed: u64 = earned > paid ? earned - paid : 0;
    const left = pot.received > pot.paid ? pot.received - pot.paid : 0;
    if (owed > left) owed = left;
    return new editions.earnings(earned, paid, owed);
  }

  private mint(to: Uint8Array, storyId: u64, kind: editions.edition_kind, number: u64, title: string): u64 {
    const cfg = this.config.get()!;
    cfg.next_token_id = SafeMath.add(cfg.next_token_id, 1);
    cfg.total_supply = SafeMath.add(cfg.total_supply, 1);
    this.saveConfig(cfg);
    const tokenNumber = cfg.next_token_id;
    const tokenId = idKey(tokenNumber);
    const ed = new editions.edition(to, storyId, kind, number, title, this.now());
    this.editionsById.put(tokenId, ed);
    this.byOwner.put(join(to, tokenId), new editions.boole(true));
    this.addBalance(to, true);
    const ev = new editions.mint_event(to, tokenId, "");
    System.event("collections.mint_event", Protobuf.encode(ev, editions.mint_event.encode), [to]);
    return tokenNumber;
  }

  private addBalance(owner: Uint8Array, up: bool): void {
    const bal = this.balances.get(owner)!;
    bal.value = up ? SafeMath.add(bal.value, 1) : SafeMath.sub(bal.value, 1);
    if (bal.value == 0) this.balances.remove(owner);
    else this.balances.put(owner, bal);
  }

  private priceFor(storyId: u64, token: Uint8Array): u64 {
    const settings = this.tokens.get(token);
    if (settings == null || !settings!.enabled) return 0;
    const chosen = this.prices.get(this.bookTokenKey(storyId, token))!.value;
    // A price chosen before the range changed is kept inside the range.
    if (chosen == 0) return settings!.default_price;
    if (chosen < settings!.min_price) return settings!.min_price;
    if (chosen > settings!.max_price) return settings!.max_price;
    return chosen;
  }

  private requireUsableToken(token: Uint8Array): void {
    const cfg = this.config.get()!;
    const shopId = this.requireAddress(cfg.shop, "EDITIONS: Shop address is not set");
    const res = System.call(shopId, SHOP_GET_ASSET, Protobuf.encode(new editions.shop_asset_query(token), editions.shop_asset_query.encode));
    System.require(res.code == 0, "EDITIONS: could not read the Shop's payment tokens");
    const raw = res.res.object;
    System.require(raw != null && raw!.length > 0, "EDITIONS: that token isn't accepted by the Shop");
    const asset = Protobuf.decode<editions.shop_asset>(raw!, editions.shop_asset.decode);
    System.require(asset.enabled, "EDITIONS: that token isn't accepted by the Shop");
    System.require(this.now() >= asset.usable_from, "EDITIONS: this token was enabled recently and can't be used yet");
  }

  private readStory(storyId: u64): editions.stories_story {
    const cfg = this.config.get()!;
    const stories = this.requireAddress(cfg.stories, "EDITIONS: Stories address is not set");
    const res = System.call(stories, STORIES_GET_STORY, Protobuf.encode(new editions.stories_story_query(storyId), editions.stories_story_query.encode));
    System.require(res.code == 0, "EDITIONS: could not read the story");
    const raw = res.res.object;
    if (raw == null || raw!.length == 0) return new editions.stories_story();
    return Protobuf.decode<editions.stories_story>(raw!, editions.stories_story.decode);
  }

  private readSurviving(storyId: u64, account: Uint8Array): u64 {
    const cfg = this.config.get()!;
    const stories = this.requireAddress(cfg.stories, "EDITIONS: Stories address is not set");
    const res = System.call(stories, STORIES_GET_SURVIVING_TOTAL,
      Protobuf.encode(new editions.stories_surviving_query(storyId, account), editions.stories_surviving_query.encode));
    System.require(res.code == 0, "EDITIONS: could not read the writer's share");
    const raw = res.res.object;
    if (raw == null || raw!.length == 0) return 0;
    return Protobuf.decode<editions.uint64>(raw!, editions.uint64.decode).value;
  }

  private requireFinished(st: editions.stories_story): void {
    System.require(st.status == STORY_FINALIZED, "EDITIONS: editions are made only of finished books");
  }

  private transferToken(token: Uint8Array, from: Uint8Array, to: Uint8Array, amount: u64): void {
    const payload = Protobuf.encode(new editions.token_transfer_call(from, to, amount), editions.token_transfer_call.encode);
    const res = System.call(token, TOKEN_TRANSFER, payload);
    System.require(res.code == 0, "EDITIONS: token transfer failed");
    // Some tokens answer "false" with exit code 0 when they refuse.
    const raw = res.res.object;
    System.require(!(raw != null && raw!.length >= 2 && raw![0] == 8 && raw![1] == 0), "EDITIONS: token transfer failed");
  }

  private readBalance(token: Uint8Array, owner: Uint8Array): u64 {
    const res = System.call(token, TOKEN_BALANCE_OF, Protobuf.encode(new editions.token_balance_query(owner), editions.token_balance_query.encode));
    System.require(res.code == 0, "EDITIONS: could not read a token balance");
    const raw = res.res.object;
    if (raw == null || raw!.length == 0) return 0;
    return Protobuf.decode<editions.token_balance_answer>(raw!, editions.token_balance_answer.decode).value;
  }

  private findEdition(tokenId: Uint8Array | null): editions.edition | null {
    if (tokenId == null || tokenId.length != ID_LENGTH) return null;
    return this.editionsById.get(tokenId);
  }

  private requireTokenId(tokenId: Uint8Array | null): Uint8Array {
    System.require(tokenId != null && tokenId.length == ID_LENGTH, "EDITIONS: token_id must be 8 bytes");
    return tokenId!;
  }

  private bookTokenKey(storyId: u64, token: Uint8Array): Uint8Array {
    return join(idKey(storyId), token);
  }

  private listLimit(limit: i32): i32 {
    return limit <= 0 || limit > MAX_LIST ? MAX_LIST : limit;
  }

  private getAdmin(): Uint8Array {
    const stored = this.config.get()!.admin;
    if (stored != null && stored.length > 0) return stored;
    return this.contractId;
  }

  private saveConfig(cfg: editions.config): void {
    if (cfg.admin == null || cfg.admin!.length == 0) cfg.admin = this.contractId;
    this.config.put(cfg);
    const ev = new editions.settings_event(cfg);
    System.event("editions.settings_event", Protobuf.encode(ev, editions.settings_event.encode), []);
  }

  private requireAdmin(): void {
    System.require(System.checkAuthority(authority.authorization_type.contract_call, this.getAdmin()), "EDITIONS: admin authority required");
  }

  private requireSigner(account: Uint8Array, message: string): void {
    System.require(System.checkAuthority(authority.authorization_type.contract_call, account), message);
  }

  private requireNotPaused(): void {
    System.require(!this.config.get()!.paused, "EDITIONS: editions are paused");
  }

  // Straight from the transaction, and never twice at once: a token's code
  // runs inside a sale or payout and must not call back in.
  private enter(): void {
    const caller = System.getCaller().caller;
    System.require(caller == null || caller.length == 0, "EDITIONS: call SwarmTales directly from your wallet, not through another contract");
    const flag = this.lock.get()!;
    System.require(!flag.value, "EDITIONS: reentrant call");
    flag.value = true;
    this.lock.put(flag);
  }

  private leave(): void {
    this.lock.put(new editions.boole(false));
  }

  private requireAddress(account: Uint8Array | null, message: string): Uint8Array {
    System.require(account != null && account.length == ADDRESS_LENGTH, message);
    return account!;
  }

  private sameOrUnset(stored: Uint8Array | null, value: Uint8Array): bool {
    return stored == null || stored.length == 0 || Arrays.equal(stored!, value);
  }

  private text(value: string | null): string {
    return value != null ? value! : "";
  }

  // The by-owner index's object space, for the paged walk in get_tokens_by_owner.
  private ownerSpace(): chain.object_space {
    return new chain.object_space(false, this.contractId, BY_OWNER_SPACE_ID);
  }

  private now(): u64 {
    return System.getHeadInfo().head_block_time / 1000;
  }
}
