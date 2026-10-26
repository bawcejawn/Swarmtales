// Storage and shared helpers of the Stories contract. The entry points are
// in StoriesAdmin.ts (moderation and settings) and Stories.ts (everything
// else); see the top of Stories.ts for what the contract does.
import { System, Storage, authority, Protobuf, SafeMath, Crypto, StringBytes, Arrays } from "@koinos/sdk-as";
import { stories } from "./proto/stories";
import { CONFIG_SPACE_ID, LOCK_SPACE_ID, STORIES_SPACE_ID, SEGMENTS_SPACE_ID, EDITORS_SPACE_ID, ALLOWED_SPACE_ID, INVITES_SPACE_ID, CONTRIBUTOR_TOTALS_SPACE_ID, SURVIVING_TOTALS_SPACE_ID, TRIAL_USED_SPACE_ID, OPEN_COUNT_SPACE_ID, OPENER_COUNT_SPACE_ID, OPENER_LIST_SPACE_ID, CATEGORY_COUNT_SPACE_ID, CATEGORY_LIST_SPACE_ID, CATEGORY_MEMBER_SPACE_ID, AUTHOR_COUNT_SPACE_ID, AUTHOR_LIST_SPACE_ID, CATEGORIES_SPACE_ID, REPORTS_SPACE_ID, TEXT_HASHES_SPACE_ID, TERMS_ACCEPTED_SPACE_ID, ACCOUNT_STATUS_SPACE_ID, READING_PLACE_SPACE_ID, READING_COUNT_SPACE_ID, READING_LIST_SPACE_ID, VERSIONS_SPACE_ID, REMOVED_SPACE_ID, PART_EDITORS_SPACE_ID, PART_CHANGERS_SPACE_ID, LIVE_PARTS_SPACE_ID, VERSION_ORIGINAL, VERSION_REMOVED, VERSION_EDITED, WRITER_VERSION_ROOM, MAX_VERSIONS, ADDRESS_LENGTH, CITATION_CHANGER_ROOM, SIGNATURE_LENGTH, INVITE_DOMAIN, DEFAULT_MIN_CONTRIBUTION, MAX_SKIP_PER_CALL, DEFAULT_STRIKE_LIMIT, DEFAULT_CAP, DEFAULT_TRIAL, DEFAULT_OPEN_LIMIT, DEFAULT_ARCHIVE_DAYS, DEFAULT_INACTIVITY_DAYS, INK_BURN_ENTRY, INK_MINT_ENTRY, SHOP_MEMBERSHIP_ENTRY, SHOP_PROMO_ENTRY, BURN_CONTRIBUTION, MINT_REFUND, SHOP_TIER_WRITER } from "./lib/constants";
import { u64Key, u32Key, join, pairKey, versionKey, idAddrKey, addrIdxKey, u32IdxKey, u32IdKey, sha256, foldHash } from "./lib/keys";
import { requireAddress } from "./lib/text";
import { nowSeconds, requireSigner, resultIsFalse } from "./lib/rules";

export class StoriesBase {
  contractId: Uint8Array;
  config: Storage.Obj<stories.config>;
  lock: Storage.Obj<stories.boole>;
  stories: Storage.Map<Uint8Array, stories.story>;
  segments: Storage.Map<Uint8Array, stories.segment>;
  editors: Storage.Map<Uint8Array, stories.boole>;
  allowed: Storage.Map<Uint8Array, stories.boole>;
  invites: Storage.Map<Uint8Array, stories.invite>;
  contributorTotals: Storage.Map<Uint8Array, stories.uint64>;
  survivingTotals: Storage.Map<Uint8Array, stories.uint64>;
  trialUsed: Storage.Map<Uint8Array, stories.uint64>;
  openCount: Storage.Map<Uint8Array, stories.uint32>;
  openerCount: Storage.Map<Uint8Array, stories.uint64>;
  openerList: Storage.Map<Uint8Array, stories.uint64>;
  categoryCount: Storage.Map<Uint8Array, stories.uint64>;
  categoryList: Storage.Map<Uint8Array, stories.uint64>;
  categoryMember: Storage.Map<Uint8Array, stories.boole>;
  authorCount: Storage.Map<Uint8Array, stories.uint64>;
  authorList: Storage.Map<Uint8Array, stories.segment_ref>;
  categories: Storage.Map<Uint8Array, stories.category>;
  reports: Storage.Map<Uint8Array, stories.boole>;
  // (story, text hash) -> the part that first had that text. Text goes into a
  // story once: a new part may not repeat any text the story ever had, and a
  // part may not take another part's text, though it may go back to its own
  // earlier wording (audit F-03).
  textHashes: Storage.Map<Uint8Array, stories.uint64>;
  termsAccepted: Storage.Map<Uint8Array, stories.uint32>;
  accountStatus: Storage.Map<Uint8Array, stories.account_status>;
  readingPlace: Storage.Map<Uint8Array, stories.reading_place>;
  readingCount: Storage.Map<Uint8Array, stories.uint64>;
  readingList: Storage.Map<Uint8Array, stories.uint64>;
  versions: Storage.Map<Uint8Array, stories.segment_version>;
  // (story, wallet) the opener or an editor took off the allow-list: an
  // invite cannot bring it back, only set_allowed (AB-010).
  removed: Storage.Map<Uint8Array, stories.boole>;
  // (story, part, wallet) that changed someone else's part, cuts included:
  // the admin may strike any of them on a takedown (AB-028).
  partEditors: Storage.Map<Uint8Array, stories.boole>;
  // (story, part) -> the same wallets in the order they first changed it, so
  // the takedown tool can list every one (AB-048). Bounded: text changers each
  // made a paid change or are the finalizer, and citation-only changers stop
  // at CITATION_CHANGER_ROOM beyond the paid changes, plus the opener
  // (AB-063, AB-073).
  partChangers: Storage.Map<Uint8Array, stories.address_list>;
  // (story, wallet) -> how many live parts the wallet wrote there. "A current
  // writer" means owning one (AB-066).
  liveParts: Storage.Map<Uint8Array, stories.uint32>;
  // How many removed segments this call may still fold in (fix M2).
  skipBudget: u32 = MAX_SKIP_PER_CALL;

  constructor() {
    this.contractId = System.getContractId();
    const id = this.contractId;
    this.config = new Storage.Obj(id, CONFIG_SPACE_ID, stories.config.decode, stories.config.encode,
      () => new stories.config(
        new Uint8Array(0), false, new Uint8Array(0), new Uint8Array(0),
        DEFAULT_CAP, DEFAULT_TRIAL, DEFAULT_OPEN_LIMIT, DEFAULT_ARCHIVE_DAYS, DEFAULT_INACTIVITY_DAYS, 0, 0,
        DEFAULT_MIN_CONTRIBUTION
      ));
    this.lock = new Storage.Obj(id, LOCK_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.stories = new Storage.Map(id, STORIES_SPACE_ID, stories.story.decode, stories.story.encode, null);
    this.segments = new Storage.Map(id, SEGMENTS_SPACE_ID, stories.segment.decode, stories.segment.encode, null);
    this.editors = new Storage.Map(id, EDITORS_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.allowed = new Storage.Map(id, ALLOWED_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.invites = new Storage.Map(id, INVITES_SPACE_ID, stories.invite.decode, stories.invite.encode, null);
    // No default: a missing entry means "never contributed here", which
    // is how contributor_count counts each author once.
    this.contributorTotals = new Storage.Map(id, CONTRIBUTOR_TOTALS_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
    this.survivingTotals = new Storage.Map(id, SURVIVING_TOTALS_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.trialUsed = new Storage.Map(id, TRIAL_USED_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.openCount = new Storage.Map(id, OPEN_COUNT_SPACE_ID, stories.uint32.decode, stories.uint32.encode, () => new stories.uint32(0));
    this.openerCount = new Storage.Map(id, OPENER_COUNT_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.openerList = new Storage.Map(id, OPENER_LIST_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
    this.categoryCount = new Storage.Map(id, CATEGORY_COUNT_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.categoryList = new Storage.Map(id, CATEGORY_LIST_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
    this.categoryMember = new Storage.Map(id, CATEGORY_MEMBER_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.authorCount = new Storage.Map(id, AUTHOR_COUNT_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.authorList = new Storage.Map(id, AUTHOR_LIST_SPACE_ID, stories.segment_ref.decode, stories.segment_ref.encode, null);
    this.categories = new Storage.Map(id, CATEGORIES_SPACE_ID, stories.category.decode, stories.category.encode, null);
    this.reports = new Storage.Map(id, REPORTS_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.textHashes = new Storage.Map(id, TEXT_HASHES_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
    this.termsAccepted = new Storage.Map(id, TERMS_ACCEPTED_SPACE_ID, stories.uint32.decode, stories.uint32.encode, () => new stories.uint32(0));
    this.accountStatus = new Storage.Map(id, ACCOUNT_STATUS_SPACE_ID, stories.account_status.decode, stories.account_status.encode, () => new stories.account_status(false, 0));
    this.readingPlace = new Storage.Map(id, READING_PLACE_SPACE_ID, stories.reading_place.decode, stories.reading_place.encode, null);
    this.readingCount = new Storage.Map(id, READING_COUNT_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.readingList = new Storage.Map(id, READING_LIST_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
    this.versions = new Storage.Map(id, VERSIONS_SPACE_ID, stories.segment_version.decode, stories.segment_version.encode, null);
    this.removed = new Storage.Map(id, REMOVED_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.partEditors = new Storage.Map(id, PART_EDITORS_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.partChangers = new Storage.Map(id, PART_CHANGERS_SPACE_ID, stories.address_list.decode, stories.address_list.encode, () => new stories.address_list());
    this.liveParts = new Storage.Map(id, LIVE_PARTS_SPACE_ID, stories.uint32.decode, stories.uint32.encode, () => new stories.uint32(0));
  }

  // ===================================================================
  // Writing helpers
  // ===================================================================

  // Append a new segment, update the story, then burn the Ink.
  protected writeSegment(
    storyId: u64, st: stories.story, author: Uint8Array, text: string, cost: u64,
    startsChapter: bool, aiAssisted: bool, trial: bool, ink: Uint8Array, termsVersion: u32, insertAfter: u64, fromFund: bool,
    citation: string
  ): u64 {
    const now = nowSeconds();
    const seq = st.segment_count + 1;
    const chapter = startsChapter || seq == 1;
    const hash = this.newTextHash(storyId, seq, text);
    const seg = new stories.segment();
    seg.author = author;
    seg.text = text;
    seg.text_hash = hash;
    seg.original_cost = cost;
    seg.charged = cost;
    seg.current_cost = cost;
    seg.status = stories.segment_status.SEGMENT_ACTIVE;
    seg.starts_chapter = chapter;
    seg.ai_assisted = aiAssisted;
    seg.created_at = now;
    seg.rights_confirmed = true;
    seg.terms_version = termsVersion;
    seg.insert_after = insertAfter;
    seg.fund_paid = fromFund;
    seg.citation = citation;
    this.segments.put(pairKey(storyId, seq), seg);

    st.segment_count = seq;
    st.used_chars = SafeMath.add(st.used_chars, cost);
    // Fund Ink was already burned when it was deposited.
    if (!fromFund) st.total_burned = SafeMath.add(st.total_burned, cost);
    if (chapter) st.chapter_count = st.chapter_count + 1;
    this.touch(st, author, true);

    const totalKey = idAddrKey(storyId, author);
    const total = this.contributorTotals.get(totalKey);
    if (total == null) {
      st.contributor_count = st.contributor_count + 1;
      this.contributorTotals.put(totalKey, new stories.uint64(cost));
    } else {
      total.value = SafeMath.add(total.value, cost);
      this.contributorTotals.put(totalKey, total);
    }
    const parts = this.liveParts.get(totalKey)!;
    parts.value = parts.value + 1;
    this.liveParts.put(totalKey, parts);
    const count = this.authorCount.get(author)!;
    this.authorList.put(addrIdxKey(author, count.value), new stories.segment_ref(storyId, seq));
    count.value = count.value + 1;
    this.authorCount.put(author, count);

    this.maybeAutoLock(storyId, st, author);
    this.putStory(storyId, st);

    const ev = new stories.contribution_event(storyId, seq, author, cost, chapter, aiAssisted, hash, trial, true, termsVersion, insertAfter, fromFund);
    System.event("stories.contribution_event", Protobuf.encode(ev, stories.contribution_event.encode), [author]);

    if (!fromFund) {
      const burn = new stories.ink_burn_call(author, cost, BURN_CONTRIBUTION, "s:" + storyId.toString() + ":" + seq.toString());
      this.callOut(ink, INK_BURN_ENTRY, Protobuf.encode(burn, stories.ink_burn_call.encode), [author], "STORIES: Ink burn failed");
    }
    return seq;
  }

  /**
   * Who may write in this story: invite-only stories need an invite (and a
   * Writer month, except for the opener); public stories need a Writer
   * month, unless the writer is the opener or an editor, or uses the promo
   * trial (which counts `units` against the trial limit). Returns true when
   * the trial was used.
   */
  protected checkWriter(storyId: u64, st: stories.story, author: Uint8Array, units: u64, cfg: stories.config): bool {
    const privileged = this.isPrivileged(storyId, st, author);
    const inviteOnly = st.visibility != stories.visibility.VISIBILITY_PUBLIC;
    if (inviteOnly) {
      System.require(privileged || this.allowed.get(idAddrKey(storyId, author))!.value, "STORIES: this story is private");
      // Everyone but the opener needs a Writer month here (no promo trial).
      if (!Arrays.equal(author, st.opener!)) {
        System.require(this.isActiveWriter(author), "STORIES: an active Writer month is required to write in private stories");
      }
      return false;
    }
    if (privileged || this.isActiveWriter(author)) return false;
    System.require(this.promoClaimed(author), "STORIES: an active Writer membership is required");
    // A used-up trial is over, also for changes that add no letters, such as
    // a paid cut (audit Info).
    const used = this.trialUsed.get(author)!;
    System.require(used.value < <u64>cfg.trial_limit && SafeMath.add(used.value, units) <= <u64>cfg.trial_limit,
      "STORIES: trial writing limit reached");
    if (units > 0) {
      used.value = used.value + units;
      this.trialUsed.put(author, used);
    }
    return true;
  }

  protected maybeAutoLock(storyId: u64, st: stories.story, by: Uint8Array): void {
    if (st.status == stories.story_status.STATUS_OPEN && st.used_chars >= st.max_chars) {
      st.status = stories.story_status.STATUS_LOCKED;
      st.locked_at = nowSeconds();
      this.emitStatus(storyId, st.status, "auto-lock", by);
    }
  }

  // Record a refund on the story and the author's live total. A refund
  // can never take a story past the Ink it actually burned.
  protected applyRefund(storyId: u64, st: stories.story, author: Uint8Array, refund: u64): void {
    if (refund == 0) return;
    st.total_refunded = SafeMath.add(st.total_refunded, refund);
    System.require(st.total_refunded <= st.total_burned, "STORIES: refund would exceed the Ink burned for this story");
    const key = idAddrKey(storyId, author);
    const total = this.contributorTotals.get(key)!;
    total.value = SafeMath.sub(total.value, refund);
    this.contributorTotals.put(key, total);
  }

  protected refundInk(ink: Uint8Array, author: Uint8Array, amount: u64, storyId: u64, seq: u64): void {
    const mint = new stories.ink_mint_call(author, amount, MINT_REFUND, "r:" + storyId.toString() + ":" + seq.toString());
    this.callOut(ink, INK_MINT_ENTRY, Protobuf.encode(mint, stories.ink_mint_call.encode), [author], "STORIES: Ink refund failed");
  }

  // Remembers that `by` changed someone else's part, even only by cutting
  // words, so the admin can strike them on a takedown (AB-028). One entry
  // per part and wallet: nothing is looped over. The writer can always be
  // struck, so their own changes are not recorded. A citation alone is
  // recorded only while the list has room beyond the paid changes, so
  // rotating editors can't grow it without limit (AB-063); the part still
  // counts as changed. The opener's citation is always recorded (set_citation
  // passes citationOnly false): there is one opener, and rotating throwaway
  // editors must not crowd them out (AB-073).
  protected recordChanger(key: Uint8Array, seg: stories.segment, by: Uint8Array, citationOnly: bool): void {
    if (Arrays.equal(by, seg.author!)) return;
    seg.edited_by_others = true;
    if (citationOnly && <u32>this.partChangers.get(key)!.values.length >= seg.paid_changes + CITATION_CHANGER_ROOM) return;
    this.addChanger(key, by);
  }

  // Adds `by` to the part's changers once (AB-028, AB-048).
  protected addChanger(key: Uint8Array, by: Uint8Array): void {
    const flag = join(key, by);
    if (this.partEditors.get(flag)!.value) return;
    const list = this.partChangers.get(key)!;
    this.partEditors.put(flag, new stories.boole(true));
    list.values.push(by);
    this.partChangers.put(key, list);
  }

  // A part's writer has one live part less in the story (AB-066). Called
  // once per part, as it leaves the story.
  protected dropLivePart(storyId: u64, seg: stories.segment): void {
    const key = idAddrKey(storyId, seg.author!);
    const parts = this.liveParts.get(key)!;
    if (parts.value == 0) return;
    parts.value = parts.value - 1;
    this.liveParts.put(key, parts);
  }

  // What every free removal of a live part does besides the refund: the
  // removed text stays on record as the version before a "removed" version,
  // so a later takedown still has it to review (audit F-06); a hidden part
  // stops blocking the book; and its writer has one live part less.
  protected removePart(storyId: u64, seq: u64, st: stories.story, seg: stories.segment, by: Uint8Array, now: u64): void {
    const oldText = seg.text != null ? seg.text! : "";
    this.keepVersion(storyId, seq, seg, oldText, VERSION_REMOVED, by, "", 0, now, "", false);
    if (seg.hidden) this.unhideCount(st);
    this.dropLivePart(storyId, seg);
  }

  // The same exact text goes into a story once (audit F-03): new text may not
  // repeat any text the story ever had (edited away, removed and taken-down
  // text included), except that part `seq` may go back to wording it had
  // itself, such as its original after a paid change. Returns the hash.
  protected newTextHash(storyId: u64, seq: u64, text: string): Uint8Array {
    const hash = sha256(StringBytes.stringToBytes(text));
    const key = join(u64Key(storyId), hash);
    const first = this.textHashes.get(key);
    System.require(first == null || first.value == seq, "STORIES: this exact text is already in this story");
    if (first == null) this.textHashes.put(key, new stories.uint64(seq));
    return hash;
  }

  // Every change to a part's text is kept as a version naming who made it
  // (AB-033); the text before the first change becomes version 1. Past
  // WRITER_VERSION_ROOM the writer's edit replaces their own newest version,
  // so the writer can always edit, paid changes always have room (AB-047) and
  // a takedown always wipes them all.
  protected keepVersion(storyId: u64, seq: u64, seg: stories.segment, oldText: string, kind: u32, by: Uint8Array,
    text: string, cost: u64, now: u64, citation: string, aiAssisted: bool): u32 {
    if (seg.version_count == 0) {
      this.versions.put(versionKey(storyId, seq, 1), new stories.segment_version(
        1, seg.author, oldText, seg.original_cost, seg.created_at, VERSION_ORIGINAL, seg.author));
      seg.version_count = 1;
    }
    let version = seg.version_count + 1;
    if (version > WRITER_VERSION_ROOM && kind == VERSION_EDITED) {
      const newest = this.versions.get(versionKey(storyId, seq, seg.version_count));
      if (newest != null && newest.kind == VERSION_EDITED) version = seg.version_count;
    }
    System.require(version <= MAX_VERSIONS, "STORIES: this part has too many versions to change it again");
    this.versions.put(versionKey(storyId, seq, version), new stories.segment_version(
      version, seg.author, text, cost, now, kind, by, citation, aiAssisted));
    seg.version_count = version;
    return version;
  }

  // Take a part's Ink off its writer's live total without a refund (a
  // takedown, or removing a part the admin or the checker hid), so they stop
  // counting as a current writer once their writing is gone (AB-057).
  protected dropTotal(storyId: u64, author: Uint8Array, amount: u64): void {
    if (amount == 0) return;
    const key = idAddrKey(storyId, author);
    const total = this.contributorTotals.get(key);
    if (total == null) return;
    total.value = total.value > amount ? total.value - amount : 0;
    this.contributorTotals.put(key, total);
  }

  // Segments removed before the lock are folded into the final hash
  // automatically, so the finalizer only submits live text.
  protected skipRemoved(storyId: u64, st: stories.story): void {
    while (st.final_cursor < st.segment_count && this.skipBudget > 0) {
      const next = st.final_cursor + 1;
      const key = pairKey(storyId, next);
      const seg = this.segments.get(key)!;
      if (seg.status != stories.segment_status.SEGMENT_REMOVED) return;
      this.skipBudget = this.skipBudget - 1;
      if (seg.final_mode == stories.final_mode.FINAL_PENDING) {
        seg.final_mode = stories.final_mode.FINAL_REMOVED;
        this.segments.put(key, seg);
      }
      st.running_hash = foldHash(st.running_hash, next, <u8>stories.final_mode.FINAL_REMOVED, new Uint8Array(32));
      st.final_cursor = next;
    }
  }

  protected addSurviving(storyId: u64, author: Uint8Array, amount: u64): void {
    const key = idAddrKey(storyId, author);
    const total = this.survivingTotals.get(key)!;
    total.value = SafeMath.add(total.value, amount);
    this.survivingTotals.put(key, total);
  }

  protected decrementOpen(opener: Uint8Array): void {
    const open = this.openCount.get(opener)!;
    if (open.value > 0) open.value = open.value - 1;
    this.openCount.put(opener, open);
  }

  // Burn the opener's Ink into the story's fund.
  protected depositFund(storyId: u64, st: stories.story, opener: Uint8Array, amount: u64, ink: Uint8Array): void {
    st.fund = SafeMath.add(st.fund, amount);
    st.fund_added = SafeMath.add(st.fund_added, amount);
    st.total_burned = SafeMath.add(st.total_burned, amount);
    this.putStory(storyId, st);
    const ev = new stories.fund_event(storyId, opener, "deposit", amount, st.fund);
    System.event("stories.fund_event", Protobuf.encode(ev, stories.fund_event.encode), [opener]);
    const burn = new stories.ink_burn_call(opener, amount, BURN_CONTRIBUTION, "fund:" + storyId.toString());
    this.callOut(ink, INK_BURN_ENTRY, Protobuf.encode(burn, stories.ink_burn_call.encode), [opener], "STORIES: Ink burn failed");
  }

  // A refund for a part. A part the fund paid for gives back first what the
  // writer paid themselves for letters added later (own_paid), then the rest
  // goes back to the fund (no mint). Otherwise it all goes to the writer.
  // Returns the Ink to mint to the writer after saving (call before saving seg).
  protected settleRefund(storyId: u64, st: stories.story, seg: stories.segment, refund: u64): u64 {
    if (refund == 0) return 0;
    let toWriter = refund;
    if (seg.fund_paid) {
      toWriter = refund < seg.own_paid ? refund : seg.own_paid;
      seg.own_paid = seg.own_paid - toWriter;
      const toFund = refund - toWriter;
      if (toFund > 0) {
        const key = idAddrKey(storyId, seg.author!);
        const total = this.contributorTotals.get(key)!;
        total.value = SafeMath.sub(total.value, toFund);
        this.contributorTotals.put(key, total);
        st.fund = SafeMath.add(st.fund, toFund);
      }
    }
    if (toWriter > 0) this.applyRefund(storyId, st, seg.author!, toWriter);
    return toWriter;
  }

  // Empty the fund for its return to the opener (call before saving the story).
  protected takeFundBack(storyId: u64, st: stories.story): u64 {
    const back = st.fund;
    if (back == 0) return 0;
    st.fund = 0;
    st.total_refunded = SafeMath.add(st.total_refunded, back);
    System.require(st.total_refunded <= st.total_burned, "STORIES: refund would exceed the Ink burned for this story");
    return back;
  }

  protected returnFund(storyId: u64, st: stories.story, back: u64): void {
    const ink = requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const ev = new stories.fund_event(storyId, st.opener!, "returned", back, 0);
    System.event("stories.fund_event", Protobuf.encode(ev, stories.fund_event.encode), [st.opener!]);
    const mint = new stories.ink_mint_call(st.opener!, back, MINT_REFUND, "fund-back:" + storyId.toString());
    this.callOut(ink, INK_MINT_ENTRY, Protobuf.encode(mint, stories.ink_mint_call.encode), [st.opener!], "STORIES: Ink refund failed");
  }

  // ===================================================================
  // Moderation helpers
  // ===================================================================

  // Every new part needs the writer's rights confirmation and the current
  // Terms of Use version. A wallet's newest accepted version is recorded.
  protected requireRightsAndTerms(account: Uint8Array, rights: bool, version: u32, cfg: stories.config): void {
    System.require(rights, "STORIES: confirm that you wrote this text or have the right to use it");
    System.require(version == cfg.terms_version, "STORIES: the Terms of Use have changed; reload the page and accept the current version");
    const accepted = this.termsAccepted.get(account)!;
    if (accepted.value == version) return;
    accepted.value = version;
    this.termsAccepted.put(account, accepted);
    const ev = new stories.terms_accepted_event(account, version);
    System.event("stories.terms_accepted_event", Protobuf.encode(ev, stories.terms_accepted_event.encode), [account]);
  }

  protected requireNotBlocked(account: Uint8Array): void {
    System.require(!this.accountStatus.get(account)!.blocked, "STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
  }

  // Repeat-infringer policy: every takedown is a strike; at the limit the
  // wallet is blocked automatically.
  protected addStrike(author: Uint8Array, by: Uint8Array): void {
    const status = this.accountStatus.get(author)!;
    status.strikes = status.strikes + 1;
    const cfg = this.config.get()!;
    const limit = cfg.strike_limit == 0 ? DEFAULT_STRIKE_LIMIT : cfg.strike_limit;
    const newlyBlocked = !status.blocked && status.strikes >= limit;
    if (newlyBlocked) status.blocked = true;
    this.accountStatus.put(author, status);
    if (newlyBlocked) {
      const ev = new stories.account_blocked_event(author, true, status.strikes, by,
        "automatic: " + status.strikes.toString() + " takedowns");
      System.event("stories.account_blocked_event", Protobuf.encode(ev, stories.account_blocked_event.encode), [author]);
    }
  }

  protected isModeratorOrAdmin(actor: Uint8Array): bool {
    if (Arrays.equal(actor, this.getAdmin())) return true;
    const mod = this.config.get()!.moderator;
    return mod != null && mod.length == ADDRESS_LENGTH && Arrays.equal(actor, mod!);
  }

  protected requireModeratorOrAdmin(actor: Uint8Array): void {
    if (Arrays.equal(actor, this.getAdmin())) {
      this.requireAdmin();
      return;
    }
    const mod = this.config.get()!.moderator;
    System.require(mod != null && mod.length == ADDRESS_LENGTH && Arrays.equal(actor, mod!), "STORIES: only the admin or the moderator may do this");
    requireSigner(actor, "STORIES: moderator has not authorized this");
  }

  protected unhideCount(st: stories.story): void {
    if (st.hidden_count > 0) st.hidden_count = st.hidden_count - 1;
  }

  protected emitModeration(storyId: u64, seq: u64, action: stories.moderation_action, reason: stories.moderation_reason,
    by: Uint8Array, seg: stories.segment, note: string): void {
    const ev = new stories.moderation_event(storyId, seq, action, reason, by, seg.author, note,
      seg.text_hash != null ? seg.text_hash! : new Uint8Array(0));
    System.event("stories.moderation_event", Protobuf.encode(ev, stories.moderation_event.encode), [seg.author!]);
  }

  // ===================================================================
  // Shop reads
  // ===================================================================

  protected isActiveWriter(account: Uint8Array): bool {
    const shopId = requireAddress(this.config.get()!.shop, "STORIES: Shop contract is not set");
    const call = new stories.shop_account_call(account);
    const raw = this.readCall(shopId, SHOP_MEMBERSHIP_ENTRY, Protobuf.encode(call, stories.shop_account_call.encode), "STORIES: could not read membership");
    if (raw.length == 0) return false;
    const m = Protobuf.decode<stories.shop_membership>(raw, stories.shop_membership.decode);
    return m.tier == SHOP_TIER_WRITER && m.paid_until > nowSeconds();
  }

  protected promoClaimed(account: Uint8Array): bool {
    const shopId = requireAddress(this.config.get()!.shop, "STORIES: Shop contract is not set");
    const call = new stories.shop_account_call(account);
    const raw = this.readCall(shopId, SHOP_PROMO_ENTRY, Protobuf.encode(call, stories.shop_account_call.encode), "STORIES: could not read promo status");
    if (raw.length == 0) return false;
    return Protobuf.decode<stories.uint64>(raw, stories.uint64.decode).value != 0;
  }

  // Every write to Ink or Shop must exit with code 0 AND must not answer
  // "false". The exact bytes sent are published in an event.
  protected callOut(contractId: Uint8Array, entryPoint: u32, payload: Uint8Array, impacted: Uint8Array[], message: string): void {
    const res = System.call(contractId, entryPoint, payload);
    System.require(res.code == 0, message);
    const raw = res.res.object;
    if (raw != null && resultIsFalse(raw!)) System.require(false, message);
    const ev = new stories.external_call_event(contractId, entryPoint, payload);
    System.event("stories.external_call_event", Protobuf.encode(ev, stories.external_call_event.encode), impacted);
  }

  protected readCall(contractId: Uint8Array, entryPoint: u32, payload: Uint8Array, message: string): Uint8Array {
    const res = System.call(contractId, entryPoint, payload);
    System.require(res.code == 0, message);
    const raw = res.res.object;
    return raw != null ? raw! : new Uint8Array(0);
  }

  protected requireCategories(c1: u32, c2: u32): void {
    System.require(this.isActiveCategory(c1), "STORIES: pick an active category");
    if (c2 != 0) {
      System.require(c2 != c1, "STORIES: the two categories must be different");
      System.require(this.isActiveCategory(c2), "STORIES: second category is not active");
    }
  }

  protected isActiveCategory(id: u32): bool {
    if (id == 0) return false;
    const found = this.categories.get(u32Key(id));
    return found != null && found!.active;
  }

  // In a private story: the opener, an editor, or a wallet on the allow-list.
  protected requireMember(storyId: u64, st: stories.story, account: Uint8Array): void {
    if (st.visibility == stories.visibility.VISIBILITY_PUBLIC || this.isPrivileged(storyId, st, account)) return;
    System.require(this.allowed.get(idAddrKey(storyId, account))!.value,
      "STORIES: you are no longer on this private story's list of writers; you can still remove your parts");
  }

  // ===================================================================
  // Access helpers
  // ===================================================================

  protected requireStory(storyId: u64): stories.story {
    const found = this.stories.get(u64Key(storyId));
    System.require(found != null, "STORIES: unknown story");
    return found!;
  }

  protected putStory(storyId: u64, st: stories.story): void {
    this.stories.put(u64Key(storyId), st);
  }

  protected requireActiveSegment(key: Uint8Array): stories.segment {
    const seg = this.segments.get(key);
    System.require(seg != null, "STORIES: unknown segment");
    System.require(seg!.status == stories.segment_status.SEGMENT_ACTIVE, "STORIES: segment was already removed");
    return seg!;
  }

  protected requireOpener(st: stories.story, account: Uint8Array): void {
    System.require(Arrays.equal(account, st.opener!), "STORIES: only the opener may do this");
  }

  protected isPrivileged(storyId: u64, st: stories.story, account: Uint8Array): bool {
    if (Arrays.equal(account, st.opener!)) return true;
    return this.editors.get(idAddrKey(storyId, account))!.value;
  }

  protected requireJoinable(st: stories.story): void {
    System.require(
      st.status != stories.story_status.STATUS_FINALIZED && st.status != stories.story_status.STATUS_ARCHIVED,
      "STORIES: story is not accepting new writers"
    );
  }

  // The finalizer is either the opener (after close_story) or whoever is
  // admin at the time of the call (after admin_take_over), so handing
  // admin to a new wallet does not strand a book mid-edit.
  protected requireFinalizer(st: stories.story, finalizer: Uint8Array): void {
    if (st.finalizer_is_admin) {
      System.require(Arrays.equal(finalizer, this.getAdmin()), "STORIES: only the admin may finalize this story");
      this.requireAdmin();
    } else {
      System.require(Arrays.equal(finalizer, st.opener!), "STORIES: only the opener may finalize this story");
      requireSigner(finalizer, "STORIES: finalizer has not authorized this");
    }
  }

  // Until set_admin is called, the contract's own address is the admin.
  // checkAuthority still requires a signature from that address.
  protected getAdmin(): Uint8Array {
    const stored = this.config.get()!.admin;
    if (stored != null && stored.length > 0) return stored;
    return this.contractId;
  }

  protected requireAdmin(): void {
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, this.getAdmin()),
      "STORIES: admin authority required"
    );
  }

  protected requireNotPaused(): void {
    System.require(!this.config.get()!.paused, "STORIES: stories are paused");
  }

  // Seconds the current pause has lasted (0 when not paused).
  protected pausedNow(cfg: stories.config, now: u64): u64 {
    return cfg.paused && cfg.paused_at > 0 && now > cfg.paused_at ? now - cfg.paused_at : 0;
  }

  // The activity clock (audit M-1): wall time minus every second Stories was
  // paused. It stands still during a pause, so a pause never counts as a
  // story's or an opener's inactivity.
  protected clock(): u64 {
    const cfg = this.config.get()!;
    const now = nowSeconds();
    const paused = SafeMath.add(cfg.paused_seconds, this.pausedNow(cfg, now));
    return now > paused ? now - paused : 0;
  }

  // Record activity on the activity clock: the story's text (`text`) and,
  // when `by` is the opener, the opener's own.
  protected touch(st: stories.story, by: Uint8Array, text: bool): void {
    const t = this.clock();
    if (text) st.last_activity_at = t;
    if (Arrays.equal(by, st.opener!)) st.opener_last_active = t;
  }

  protected saveConfig(cfg: stories.config): void {
    if (cfg.admin == null || cfg.admin!.length == 0) cfg.admin = this.contractId;
    this.config.put(cfg);
  }

  // Held across the whole call, so a token, Shop, Ink or authority
  // contract cannot call back into Stories mid-transaction.
  protected enter(): void {
    this.requireDirectCall();
    this.skipBudget = MAX_SKIP_PER_CALL;
    const flag = this.lock.get()!;
    System.require(!flag.value, "STORIES: reentrant call");
    flag.value = true;
    this.lock.put(flag);
  }

  // Fix H1: Stories is only ever called directly by a transaction. A call
  // that arrives from another contract is some other app acting in a user's
  // (or the admin's) name, and is refused before anything else.
  protected requireDirectCall(): void {
    const caller = System.getCaller().caller;
    System.require(
      caller == null || caller.length == 0,
      "STORIES: call SwarmTales directly from your wallet, not through another contract"
    );
  }

  protected leave(): void {
    const flag = this.lock.get()!;
    flag.value = false;
    this.lock.put(flag);
  }

  protected emitStatus(storyId: u64, status: stories.story_status, why: string, by: Uint8Array): void {
    const ev = new stories.status_event(storyId, status, why, by);
    System.event("stories.status_event", Protobuf.encode(ev, stories.status_event.encode), []);
  }

  protected emitChange(storyId: u64, seq: u64, by: Uint8Array, oldCost: u64, newCost: u64, refund: u64, removed: bool, finalPass: bool, author: Uint8Array): void {
    const ev = new stories.segment_changed_event(storyId, seq, by, oldCost, newCost, refund, removed, finalPass);
    System.event("stories.segment_changed_event", Protobuf.encode(ev, stories.segment_changed_event.encode), [author]);
  }

  protected appendOpener(opener: Uint8Array, storyId: u64): void {
    const count = this.openerCount.get(opener)!;
    this.openerList.put(addrIdxKey(opener, count.value), new stories.uint64(storyId));
    count.value = count.value + 1;
    this.openerCount.put(opener, count);
  }

  // Each story enters a category list once, however often it is re-tagged.
  protected addToCategory(categoryId: u32, storyId: u64): void {
    const memberKey = u32IdKey(categoryId, storyId);
    if (this.categoryMember.get(memberKey)!.value) return;
    this.categoryMember.put(memberKey, new stories.boole(true));
    const countKey = u32Key(categoryId);
    const count = this.categoryCount.get(countKey)!;
    this.categoryList.put(u32IdxKey(categoryId, count.value), new stories.uint64(storyId));
    count.value = count.value + 1;
    this.categoryCount.put(countKey, count);
  }

  // The 32-byte multihash digest an invite link key signs (fix H2).
  protected inviteDigest(storyId: u64, inviteId: u64, account: Uint8Array): Uint8Array {
    const domain = StringBytes.stringToBytes(INVITE_DOMAIN);
    const msg = join(join(join(domain, this.contractId), pairKey(storyId, inviteId)), account);
    const digest = System.hash(Crypto.multicodec.sha2_256, msg);
    System.require(digest != null, "STORIES: could not hash");
    return digest!;
  }

  // The signature must recover to the invite's stored link key address.
  protected requireLinkSignature(signer: Uint8Array, digest: Uint8Array, signature: Uint8Array | null, message: string): void {
    System.require(signature != null && signature.length == SIGNATURE_LENGTH, message);
    const pub = System.recoverPublicKey(signature!, digest);
    System.require(pub != null, message);
    System.require(Arrays.equal(Crypto.addressFromPublicKey(pub!), signer), message);
  }
}
