// =====================================================================
// SwarmTales Stories — smart contract (AssemblyScript, Koinos SDK)
//
// WHAT THIS CONTRACT DOES
//   - Holds every Book and Short Story: who wrote what, when, and for
//     how much Ink.
//   - Opening: Shop collects the open fee (99/1 split) and mints the
//     starter Ink, then Stories burns Ink for the opening text. One
//     transaction: if any part fails, nothing happens.
//   - Writing burns the writer's own Ink (Ink checks their signature).
//   - While a story is OPEN, a part's own writer may edit it (light
//     edits) or remove it for free. Anyone else who can write in the story
//     changes it with revise_part, which costs Ink and keeps every
//     version. The ORIGINAL author is re-credited through Ink mint, reason
//     REFUND, the only mint reason Stories is allowed.
//   - Closing (opener pays the close fee through Shop), the final edit
//     in ordered batches, surviving characters, and finalize.
//   - The 3-open-projects limit, the promo trial, private allow-lists
//     with invite codes, the 60-day archive and the admin-finalize rule.
//
// MODERATION (added October 2026, for copied text and abuse)
//   - Every new part carries the writer's "I wrote this, or I have the
//     right to use it" confirmation and the Terms of Use version they
//     accepted. The contract refuses a part without both.
//   - The same exact text cannot be added to one story twice.
//   - Any wallet may report a part once. Reports from wallets that have
//     written on SwarmTales count; enough of them hide the part.
//   - The admin, or a narrow "moderator" key used by the automated copy
//     checker, may hide and unhide parts at any stage. Hidden parts stay
//     on the record but block finalizing until unhidden or removed. A part
//     the admin or moderator hid is not refunded when removed; one hidden
//     by writer reports alone is.
//   - A wallet the opener or an editor takes off a story's allow-list
//     cannot rejoin with an invite; only they can add it back.
//   - The admin alone may take a part down for good, at any stage. Its
//     text is cleared from contract storage and no Ink is refunded.
//   - A takedown of a part nobody else changed is a strike against its
//     writer. Once anyone else changed it (revise_part or the final edit,
//     even a typo fix or a cut), the contract does not guess: the admin
//     compares the versions and names who gets the strike (the writer or
//     any wallet that changed the part), or chooses no strike. So nobody
//     can plant text in a rival's part to get them blocked, whoever made
//     the text can always be struck, and a typo fix never costs a strike
//     by itself (AB-001, AB-028, AB-029). At the strike
//     limit (default 5, the admin can set 1 to 20) the wallet is blocked
//     from opening, writing and reporting (the repeat-infringer policy).
//     The admin can also block or unblock by hand.
//   - Every report, hide, unhide, takedown and block is a public event.
//
// INVITE-ONLY STORIES AND STORY FUNDS (October 2026)
//   - Unlisted and private stories are invite-only for writing: the
//     opener, editors and invited wallets. Everyone except the opener
//     needs an active Writer month there (no promo trial). A story can
//     only switch to unlisted or private while its pool holds the minimum.
//   - The opener must set Ink aside in the story's fund (the writers'
//     pool) when opening: at least the kind's minimum length (10,000 for a
//     Short Story, 100,000 for a Book). It can be topped up later. Parts are paid from the fund while it has enough; otherwise
//     the writer pays. Refunds of fund-paid parts go back to the fund, and
//     what is left returns to the opener when the story is finalized or
//     archived.
//   - Opening costs the normal price for the first few open projects
//     (default 3); each one beyond doubles it, until it reaches the
//     ceiling (default 4x), up to the open limit.
//
// WHAT THIS CONTRACT DOES NOT DO
//   - It never moves stablecoins and holds no money.
//   - The admin cannot move or burn Ink, refund outside the rules, or
//     finalize except under the admin rule. It edits text only as the
//     finalizer after admin_take_over, under the same light-edit limits
//     (recorded as a change to the part); otherwise it can only remove text
//     through a recorded takedown.
//   - The moderator can only hide and unhide. It cannot remove text,
//     touch Ink, or change any setting.
//
// SECURITY RULES ADDED AFTER THE OCTOBER 2026 REVIEW
//   H1  Every action must be called directly by the transaction, never
//       through another contract. Koinos' signature check only asks "did
//       this wallet sign?", so without this rule any other app a user signs
//       for could write, edit, close or invite in that user's name.
//   H2  Invites are signed links. Only the PUBLIC address of a link key is
//       stored. The private key lives in the link after the #, and joining
//       needs a signature over "invite / this contract / story / invite /
//       this wallet". Nothing secret is ever sent to the chain, and a copied
//       signature only works for the wallet it names.
//   M2  The final edit skips removed text in bounded steps (at most 50 per
//       call). advance_final_cursor lets anyone push a long run along.
//   New text must be at least 20 Ink units, except a piece that exactly
//   fills the story's last space.
//
// INK COST OF TEXT
//   Cost = number of UTF-16 code units (JavaScript's text.length).
//   A letter costs 1, most emoji 2, some older emoji 1, skin tones and
//   flags 4, family emoji 8. The caller sends the expected cost and the
//   contract refuses any mismatch, so nobody is charged a surprise.
// =====================================================================

import { System, Storage, authority, Protobuf, SafeMath, Crypto, StringBytes, Arrays } from "@koinos/sdk-as";
import { stories } from "./proto/stories";

// Story text, final batches and stored segments are larger than the
// SDK's default 1 KB system buffer. This runs once when the contract
// loads, before any entry point reads its arguments.
const SYSTEM_BUFFER_SIZE: u32 = 65536;
System.setSystemBufferSize(SYSTEM_BUFFER_SIZE);

// ---------- storage spaces ----------
const CONFIG_SPACE_ID: u32 = 0;
const LOCK_SPACE_ID: u32 = 1;
const STORIES_SPACE_ID: u32 = 2;
const SEGMENTS_SPACE_ID: u32 = 3;
const EDITORS_SPACE_ID: u32 = 4;
const ALLOWED_SPACE_ID: u32 = 5;
const INVITES_SPACE_ID: u32 = 6;
const CONTRIBUTOR_TOTALS_SPACE_ID: u32 = 7;
const SURVIVING_TOTALS_SPACE_ID: u32 = 8;
const TRIAL_USED_SPACE_ID: u32 = 9;
const OPEN_COUNT_SPACE_ID: u32 = 10;
const OPENER_COUNT_SPACE_ID: u32 = 11;
const OPENER_LIST_SPACE_ID: u32 = 12;
const CATEGORY_COUNT_SPACE_ID: u32 = 13;
const CATEGORY_LIST_SPACE_ID: u32 = 14;
const CATEGORY_MEMBER_SPACE_ID: u32 = 15;
const AUTHOR_COUNT_SPACE_ID: u32 = 16;
const AUTHOR_LIST_SPACE_ID: u32 = 17;
const CATEGORIES_SPACE_ID: u32 = 18;
const REPORTS_SPACE_ID: u32 = 19;
const TEXT_HASHES_SPACE_ID: u32 = 20;
const TERMS_ACCEPTED_SPACE_ID: u32 = 21;
const ACCOUNT_STATUS_SPACE_ID: u32 = 22;
const READING_PLACE_SPACE_ID: u32 = 23;
const READING_COUNT_SPACE_ID: u32 = 24;
const READING_LIST_SPACE_ID: u32 = 25;
const VERSIONS_SPACE_ID: u32 = 26;
const REMOVED_SPACE_ID: u32 = 27;
const PART_EDITORS_SPACE_ID: u32 = 28;
const MAX_SUMMARY: i32 = 1500;
const VERSION_ORIGINAL: u32 = 1;
const VERSION_CHANGED: u32 = 2;
const VERSION_REMOVED: u32 = 3;
const MIN_CHANGE_UNITS: u64 = 10;

const ADDRESS_LENGTH: i32 = 25;
const DAY_SECONDS: u64 = 86400;

// ---------- fixed rules (changing these needs a published upgrade) ----------
const BOOK_MIN: u64 = 100000;
const BOOK_MAX: u64 = 1000000;
const SHORT_MIN: u64 = 10000;
const SHORT_MAX: u64 = 99999;
// A story this close to its own maximum may be closed even below the
// kind minimum, so a 100,000 Book stuck at 99,998 is not stuck forever.
const CLOSE_SLACK: u64 = 100;

const MAX_TITLE: i32 = 100;
const MAX_CATEGORY_NAME: i32 = 32;
const MAX_CATEGORIES: u32 = 255;
const MAX_EDITORS: u32 = 10;
const MAX_ACCOUNTS_PER_CALL: i32 = 20;
const MAX_FREE_CHAPTERS: u32 = 5;
const MAX_BATCH_ITEMS: i32 = 20;
const MAX_BATCH_UNITS: u64 = 20000;
const MAX_LIST: u32 = 50;
const MAX_SEGMENT_READ: u32 = 10;
const MAX_NEWLINE_RUN: i32 = 3;
const SIGNATURE_LENGTH: i32 = 65;
// The browser signs exactly:
//   sha256( "swarmtales/invite/v1" || stories (25) || story id (8, BE) || invite id (8, BE) || wallet (25) )
const INVITE_DOMAIN = "swarmtales/invite/v1";
// New text shorter than the minimum is refused, unless it exactly fills
// the story. Starts at 20; the admin may set 1 to 200.
const DEFAULT_MIN_CONTRIBUTION: u32 = 20;
const MIN_CONTRIBUTION_MAX: u32 = 200;
// The most removed segments the final edit folds in during one call.
const MAX_SKIP_PER_CALL: u32 = 50;
const MAX_INVITE_USES: u32 = 1000;
const MAX_INVITE_DAYS: u64 = 365;
const MAX_PDF_URI: i32 = 200;
const MIN_PDF_HASH: i32 = 32;
const MAX_PDF_HASH: i32 = 64;
// Moderation
const MAX_NOTE: i32 = 200;
const MAX_TERMS_URI: i32 = 200;
const TERMS_HASH_LENGTH: i32 = 32;
const DEFAULT_REPORT_THRESHOLD: u32 = 3;
const REPORT_THRESHOLD_MAX: u32 = 20;
const DEFAULT_STRIKE_LIMIT: u32 = 5;
const STRIKE_LIMIT_MAX: u32 = 20;

// ---------- adjustable limits: start value and hard bounds ----------
const DEFAULT_CAP: u32 = 10000;
const CAP_MIN: u32 = 100;
const CAP_MAX: u32 = 10000;
const DEFAULT_TRIAL: u32 = 1000;
const TRIAL_MAX: u32 = 5000;
const DEFAULT_OPEN_LIMIT: u32 = 10;
const DEFAULT_FULL_PRICE_PROJECTS: u32 = 3;
const DEFAULT_MAX_PRICE_MULTIPLIER: u32 = 4;
const MAX_PRICE_MULTIPLIER: u32 = 1024;
const OPEN_LIMIT_MIN: u32 = 1;
const OPEN_LIMIT_MAX: u32 = 10;
const DEFAULT_ARCHIVE_DAYS: u32 = 60;
const ARCHIVE_DAYS_MIN: u32 = 30;
const DEFAULT_INACTIVITY_DAYS: u32 = 30;
const INACTIVITY_DAYS_MIN: u32 = 30;
const DAYS_MAX: u32 = 365;

// ---------- other contracts ----------
// First 4 bytes of sha256(entry point name).
const INK_BURN_ENTRY: u32 = 2241834181;       // 0x859facc5 "burn"
const INK_MINT_ENTRY: u32 = 3698268091;       // 0xdc6f17bb "mint"
const SHOP_OPEN_FEE_ENTRY: u32 = 547545118;   // 0x20a2e01e "pay_open_fee"
const SHOP_MEMBERSHIP_ENTRY: u32 = 1996602347; // 0x7701bbeb "get_membership"
const SHOP_PROMO_ENTRY: u32 = 672038647;      // 0x280e7ef7 "get_promo_claimed"

const BURN_CONTRIBUTION: u32 = 1;
const MINT_REFUND: u32 = 5;
const SHOP_TIER_WRITER: u32 = 2;

export class Stories {
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
  textHashes: Storage.Map<Uint8Array, stories.boole>;
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
    this.textHashes = new Storage.Map(id, TEXT_HASHES_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.termsAccepted = new Storage.Map(id, TERMS_ACCEPTED_SPACE_ID, stories.uint32.decode, stories.uint32.encode, () => new stories.uint32(0));
    this.accountStatus = new Storage.Map(id, ACCOUNT_STATUS_SPACE_ID, stories.account_status.decode, stories.account_status.encode, () => new stories.account_status(false, 0));
    this.readingPlace = new Storage.Map(id, READING_PLACE_SPACE_ID, stories.reading_place.decode, stories.reading_place.encode, null);
    this.readingCount = new Storage.Map(id, READING_COUNT_SPACE_ID, stories.uint64.decode, stories.uint64.encode, () => new stories.uint64(0));
    this.readingList = new Storage.Map(id, READING_LIST_SPACE_ID, stories.uint64.decode, stories.uint64.encode, null);
    this.versions = new Storage.Map(id, VERSIONS_SPACE_ID, stories.segment_version.decode, stories.segment_version.encode, null);
    this.removed = new Storage.Map(id, REMOVED_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
    this.partEditors = new Storage.Map(id, PART_EDITORS_SPACE_ID, stories.boole.decode, stories.boole.encode, () => new stories.boole(false));
  }

  // ===================================================================
  // Reads
  // ===================================================================

  get_config(args: stories.get_config_arguments): stories.config {
    const cfg = this.config.get()!;
    cfg.admin = this.getAdmin();
    return cfg;
  }

  get_story(args: stories.get_story_arguments): stories.story {
    const found = this.stories.get(this.u64Key(args.story_id));
    return found != null ? found! : new stories.story();
  }

  get_segment(args: stories.get_segment_arguments): stories.segment {
    const found = this.segments.get(this.pairKey(args.story_id, args.seq));
    return found != null ? found! : new stories.segment();
  }

  get_segments(args: stories.get_segments_arguments): stories.segment_list {
    const out = new stories.segment_list();
    const found = this.stories.get(this.u64Key(args.story_id));
    if (found == null) return out;
    const limit = args.limit == 0 || args.limit > MAX_SEGMENT_READ ? MAX_SEGMENT_READ : args.limit;
    let seq = args.start == 0 ? 1 : args.start;
    for (let n: u32 = 0; n < limit && seq <= found!.segment_count; n++) {
      out.values.push(this.segments.get(this.pairKey(args.story_id, seq))!);
      seq++;
    }
    return out;
  }

  get_contributor_total(args: stories.get_contributor_total_arguments): stories.uint64 {
    if (!this.isAddress(args.account)) return new stories.uint64(0);
    const found = this.contributorTotals.get(this.idAddrKey(args.story_id, args.account!));
    return found != null ? found! : new stories.uint64(0);
  }

  get_surviving_total(args: stories.get_surviving_total_arguments): stories.uint64 {
    if (!this.isAddress(args.account)) return new stories.uint64(0);
    return this.survivingTotals.get(this.idAddrKey(args.story_id, args.account!))!;
  }

  is_editor(args: stories.is_editor_arguments): stories.boole {
    if (!this.isAddress(args.account)) return new stories.boole(false);
    return this.editors.get(this.idAddrKey(args.story_id, args.account!))!;
  }

  is_allowed(args: stories.is_allowed_arguments): stories.boole {
    if (!this.isAddress(args.account)) return new stories.boole(false);
    return this.allowed.get(this.idAddrKey(args.story_id, args.account!))!;
  }

  get_invite(args: stories.get_invite_arguments): stories.invite {
    const found = this.invites.get(this.pairKey(args.story_id, args.invite_id));
    return found != null ? found! : new stories.invite();
  }

  get_trial_used(args: stories.get_trial_used_arguments): stories.uint64 {
    if (!this.isAddress(args.account)) return new stories.uint64(0);
    return this.trialUsed.get(args.account!)!;
  }

  get_open_count(args: stories.get_open_count_arguments): stories.uint32 {
    if (!this.isAddress(args.account)) return new stories.uint32(0);
    return this.openCount.get(args.account!)!;
  }

  get_category(args: stories.get_category_arguments): stories.category {
    const found = this.categories.get(this.u32Key(args.category_id));
    return found != null ? found! : new stories.category();
  }

  get_opener_stories(args: stories.get_opener_stories_arguments): stories.id_list {
    const out = new stories.id_list();
    if (!this.isAddress(args.account)) return out;
    const total = this.openerCount.get(args.account!)!.value;
    const limit = this.listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      out.values.push(this.openerList.get(this.addrIdxKey(args.account!, i))!.value);
    }
    return out;
  }

  get_reading_place(args: stories.get_reading_place_arguments): stories.reading_place {
    if (!this.isAddress(args.reader)) return new stories.reading_place();
    const found = this.readingPlace.get(this.idAddrKey(args.story_id, args.reader!));
    return found != null ? found : new stories.reading_place(args.story_id);
  }

  get_reading_places(args: stories.get_reading_places_arguments): stories.reading_place_list {
    const out = new stories.reading_place_list();
    if (!this.isAddress(args.reader)) return out;
    const total = this.readingCount.get(args.reader!)!.value;
    out.total = total;
    const limit = this.listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      const storyId = this.readingList.get(this.addrIdxKey(args.reader!, i))!.value;
      const place = this.readingPlace.get(this.idAddrKey(storyId, args.reader!));
      if (place != null && place.seq > 0) out.values.push(place);
    }
    return out;
  }

  get_versions(args: stories.get_versions_arguments): stories.version_list {
    const out = new stories.version_list();
    const seg = this.segments.get(this.pairKey(args.story_id, args.seq));
    if (seg == null) return out;
    for (let v: u32 = 1; v <= seg.version_count; v++) {
      const found = this.versions.get(this.versionKey(args.story_id, args.seq, v));
      if (found != null) out.values.push(found);
    }
    return out;
  }

  get_category_stories(args: stories.get_category_stories_arguments): stories.id_list {
    const out = new stories.id_list();
    const total = this.categoryCount.get(this.u32Key(args.category_id))!.value;
    const limit = this.listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      out.values.push(this.categoryList.get(this.u32IdxKey(args.category_id, i))!.value);
    }
    return out;
  }

  get_author_segments(args: stories.get_author_segments_arguments): stories.segment_ref_list {
    const out = new stories.segment_ref_list();
    if (!this.isAddress(args.account)) return out;
    const total = this.authorCount.get(args.account!)!.value;
    const limit = this.listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      out.values.push(this.authorList.get(this.addrIdxKey(args.account!, i))!);
    }
    return out;
  }

  has_reported(args: stories.has_reported_arguments): stories.boole {
    if (!this.isAddress(args.account)) return new stories.boole(false);
    return this.reports.get(this.reportKey(args.story_id, args.seq, args.account!))!;
  }

  get_account_status(args: stories.get_account_status_arguments): stories.account_status {
    if (!this.isAddress(args.account)) return new stories.account_status(false, 0);
    return this.accountStatus.get(args.account!)!;
  }

  get_open_multiplier(args: stories.get_open_multiplier_arguments): stories.uint32 {
    if (!this.isAddress(args.account)) return new stories.uint32(1);
    return new stories.uint32(this.openMultiplier(this.openCount.get(args.account!)!.value, this.config.get()!));
  }

  get_terms_accepted(args: stories.get_terms_accepted_arguments): stories.uint32 {
    if (!this.isAddress(args.account)) return new stories.uint32(0);
    return this.termsAccepted.get(args.account!)!;
  }

  quote_cost(args: stories.quote_cost_arguments): stories.uint64 {
    return new stories.uint64(this.requireText(this.text(args.text), true));
  }

  // ===================================================================
  // Opening and settings
  // ===================================================================

  open_story(args: stories.open_story_arguments): stories.uint64 {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    this.requireNotBlocked(opener);
    const cfg = this.config.get()!;
    const ink = this.requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const shopId = this.requireAddress(cfg.shop, "STORIES: Shop contract is not set");
    const token = this.requireAddress(args.token, "STORIES: invalid token address");

    const kind = args.kind;
    System.require(kind == stories.story_kind.KIND_BOOK || kind == stories.story_kind.KIND_SHORT, "STORIES: kind must be Book or Short Story");
    const isBook = kind == stories.story_kind.KIND_BOOK;
    const lo = isBook ? BOOK_MIN : SHORT_MIN;
    const hi = isBook ? BOOK_MAX : SHORT_MAX;
    // 0 = no fixed size: the story may grow to its kind's maximum, and the
    // opener can close it any time after it reaches the kind's minimum.
    if (args.max_chars == 0) args.max_chars = hi;
    System.require(args.max_chars >= lo && args.max_chars <= hi, isBook
      ? "STORIES: a Book must be 100,000 to 1,000,000 characters"
      : "STORIES: a Short Story must be 10,000 to 99,999 characters");

    const title = this.requireTitle(args.title);
    this.requireCategories(args.category_1, args.category_2);
    this.requireVisibility(args.visibility);
    System.require(args.free_chapters <= MAX_FREE_CHAPTERS, "STORIES: free chapters must be 0 to 5");
    System.require(args.contributor_edition_min <= args.max_chars, "STORIES: Contributor Edition minimum is above the story size");

    const text = this.text(args.opening_text);
    const cost = <u64>this.requireText(text, true);
    System.require(cost == args.expected_ink, "STORIES: Ink cost does not match expected_ink");
    System.require(cost <= <u64>cfg.contribution_cap, "STORIES: text is over the per-submission cap");
    System.require(cost >= this.minContribution(cfg), "STORIES: opening text is shorter than the minimum");
    this.requireRightsAndTerms(opener, args.rights_confirmed, args.terms_version, cfg);

    const open = this.openCount.get(opener)!;
    System.require(open.value < cfg.open_limit, "STORIES: you already have the maximum number of open projects");
    if (args.visibility == stories.visibility.VISIBILITY_PUBLIC) {
      System.require(args.fund == 0, "STORIES: only unlisted and private stories have a fund");
    } else {
      // The writers' pool must at least cover a story long enough to close.
      System.require(args.fund >= lo, isBook
        ? "STORIES: an unlisted or private Book needs a writers' pool of at least 100,000 Ink"
        : "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink");
    }
    const multiplier = this.openMultiplier(open.value, cfg);

    let storyId = cfg.next_story_id;
    if (storyId == 0) storyId = 1;
    cfg.next_story_id = SafeMath.add(storyId, 1);
    this.saveConfig(cfg);

    const now = this.now();
    const st = new stories.story();
    st.kind = kind;
    st.opener = opener;
    st.title = title;
    st.category_1 = args.category_1;
    st.category_2 = args.category_2;
    st.visibility = args.visibility;
    st.status = stories.story_status.STATUS_OPEN;
    st.max_chars = args.max_chars;
    st.free_chapters = args.free_chapters;
    st.contributor_edition_min = args.contributor_edition_min;
    st.created_at = now;
    st.last_activity_at = now;
    st.opener_last_active = now;
    st.next_invite_id = 1;

    open.value = open.value + 1;
    this.openCount.put(opener, open);
    this.appendOpener(opener, storyId);
    this.addToCategory(args.category_1, storyId);
    if (args.category_2 != 0) this.addToCategory(args.category_2, storyId);

    const ev = new stories.story_opened_event(storyId, opener, kind, args.max_chars, token);
    System.event("stories.story_opened_event", Protobuf.encode(ev, stories.story_opened_event.encode), [opener]);

    // 1) Shop takes the fee and mints the starter Ink to the opener.
    const fee = new stories.shop_fee_call(opener, <u32>kind, token, multiplier, args.max_price);
    this.callOut(shopId, SHOP_OPEN_FEE_ENTRY, Protobuf.encode(fee, stories.shop_fee_call.encode), [opener], "STORIES: open fee payment failed");

    // 2) The opening text is segment 1, paid in Ink like any other text.
    this.writeSegment(storyId, st, opener, text, cost, true, args.ai_assisted, false, ink, args.terms_version, 0, false, this.requireCitation(args.citation));
    // 3) Optional: Ink set aside for everyone's writing in this story.
    if (args.fund > 0) this.depositFund(storyId, st, opener, args.fund, ink);
    this.leave();
    return new stories.uint64(storyId);
  }

  update_story(args: stories.update_story_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    st.title = this.requireTitle(args.title);
    this.requireCategories(args.category_1, args.category_2);
    this.requireVisibility(args.visibility);
    System.require(args.free_chapters <= MAX_FREE_CHAPTERS, "STORIES: free chapters must be 0 to 5");
    st.category_1 = args.category_1;
    st.category_2 = args.category_2;
    if (st.visibility == stories.visibility.VISIBILITY_PUBLIC && args.visibility != stories.visibility.VISIBILITY_PUBLIC) {
      // Invite-only stories pay their writers from the pool, so switching
      // from public needs the same pool as opening one (AB-011). A story
      // that is already invite-only keeps its pool as writers use it (AB-022).
      const isBook = st.kind == stories.story_kind.KIND_BOOK;
      System.require(st.fund >= (isBook ? BOOK_MIN : SHORT_MIN), isBook
        ? "STORIES: an unlisted or private Book needs a writers' pool of at least 100,000 Ink"
        : "STORIES: an unlisted or private Short Story needs a writers' pool of at least 10,000 Ink");
    }
    st.visibility = args.visibility;
    st.free_chapters = args.free_chapters;
    st.opener_last_active = this.now();
    this.addToCategory(args.category_1, args.story_id);
    if (args.category_2 != 0) this.addToCategory(args.category_2, args.story_id);
    this.putStory(args.story_id, st);
    const ev = new stories.story_updated_event(args.story_id, st.title, st.category_1, st.category_2, st.visibility, st.free_chapters);
    System.event("stories.story_updated_event", Protobuf.encode(ev, stories.story_updated_event.encode), [opener]);
    this.leave();
    return new stories.empty_object();
  }

  set_editor(args: stories.set_editor_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const account = this.requireAddress(args.account, "STORIES: invalid editor address");
    System.require(!Arrays.equal(account, opener), "STORIES: the opener is already in charge");
    const key = this.idAddrKey(args.story_id, account);
    const already = this.editors.get(key)!.value;
    if (args.allowed) {
      System.require(!already, "STORIES: already an editor");
      System.require(st.editor_count < MAX_EDITORS, "STORIES: a story can have at most 10 editors");
      this.editors.put(key, new stories.boole(true));
      st.editor_count = st.editor_count + 1;
    } else {
      System.require(already, "STORIES: not an editor");
      this.editors.remove(key);
      st.editor_count = st.editor_count - 1;
    }
    st.opener_last_active = this.now();
    this.putStory(args.story_id, st);
    const ev = new stories.editor_event(args.story_id, account, args.allowed);
    System.event("stories.editor_event", Protobuf.encode(ev, stories.editor_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  set_allowed(args: stories.set_allowed_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const actor = this.requireAddress(args.actor, "STORIES: invalid address");
    this.requireSigner(actor, "STORIES: caller has not authorized this");
    const st = this.requireStory(args.story_id);
    System.require(this.isPrivileged(args.story_id, st, actor), "STORIES: only the opener or an editor may change the allow-list");
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const list = args.accounts;
    System.require(list.length > 0 && list.length <= MAX_ACCOUNTS_PER_CALL, "STORIES: send 1 to 20 wallets per call");
    for (let i = 0; i < list.length; i++) {
      const account = this.requireAddress(list[i], "STORIES: invalid wallet address");
      const key = this.idAddrKey(args.story_id, account);
      if (args.allowed) {
        this.allowed.put(key, new stories.boole(true));
        this.removed.remove(key);
      } else {
        this.allowed.remove(key);
        this.removed.put(key, new stories.boole(true));
      }
      const ev = new stories.allowed_event(args.story_id, account, args.allowed, 0);
      System.event("stories.allowed_event", Protobuf.encode(ev, stories.allowed_event.encode), [account]);
    }
    if (Arrays.equal(actor, st.opener!)) {
      st.opener_last_active = this.now();
      this.putStory(args.story_id, st);
    }
    this.leave();
    return new stories.empty_object();
  }

  create_invite(args: stories.create_invite_arguments): stories.uint64 {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    this.requireJoinable(st);
    const linkSigner = this.requireAddress(args.link_signer, "STORIES: invite needs a link key address");
    System.require(args.max_uses >= 1 && args.max_uses <= MAX_INVITE_USES, "STORIES: invite uses must be 1 to 1000");
    const now = this.now();
    System.require(args.expires_at > now, "STORIES: invite expiry must be in the future");
    System.require(args.expires_at <= now + MAX_INVITE_DAYS * DAY_SECONDS, "STORIES: invite expiry can be at most 365 days away");

    let inviteId = st.next_invite_id;
    if (inviteId == 0) inviteId = 1;
    st.next_invite_id = SafeMath.add(inviteId, 1);
    st.opener_last_active = now;
    this.putStory(args.story_id, st);
    this.invites.put(this.pairKey(args.story_id, inviteId), new stories.invite(linkSigner, args.max_uses, 0, args.expires_at, false));
    const ev = new stories.invite_event(args.story_id, inviteId, args.max_uses, args.expires_at, false);
    System.event("stories.invite_event", Protobuf.encode(ev, stories.invite_event.encode), [opener]);
    this.leave();
    return new stories.uint64(inviteId);
  }

  revoke_invite(args: stories.revoke_invite_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    const key = this.pairKey(args.story_id, args.invite_id);
    const inv = this.invites.get(key);
    System.require(inv != null, "STORIES: unknown invite");
    inv!.revoked = true;
    this.invites.put(key, inv!);
    const ev = new stories.invite_event(args.story_id, args.invite_id, inv!.max_uses, inv!.expires_at, true);
    System.event("stories.invite_event", Protobuf.encode(ev, stories.invite_event.encode), [opener]);
    this.leave();
    return new stories.empty_object();
  }

  join_with_invite(args: stories.join_with_invite_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const account = this.requireAddress(args.account, "STORIES: invalid wallet address");
    this.requireSigner(account, "STORIES: wallet has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireJoinable(st);
    const key = this.pairKey(args.story_id, args.invite_id);
    const inv = this.invites.get(key);
    System.require(inv != null, "STORIES: unknown invite");
    const row = inv!;
    System.require(!row.revoked, "STORIES: invite was revoked");
    System.require(this.now() < row.expires_at, "STORIES: invite has expired");
    System.require(row.uses < row.max_uses, "STORIES: invite has no uses left");
    this.requireLinkSignature(
      this.requireAddress(row.link_signer, "STORIES: invite link rejected"),
      this.inviteDigest(args.story_id, args.invite_id, account),
      args.signature,
      "STORIES: invite link rejected"
    );
    const allowKey = this.idAddrKey(args.story_id, account);
    System.require(!this.allowed.get(allowKey)!.value, "STORIES: already on the allow-list");
    System.require(!this.removed.get(allowKey)!.value, "STORIES: the opener or an editor removed this wallet from the story; only they can add it back");
    this.allowed.put(allowKey, new stories.boole(true));
    row.uses = row.uses + 1;
    this.invites.put(key, row);
    const ev = new stories.allowed_event(args.story_id, account, true, args.invite_id);
    System.event("stories.allowed_event", Protobuf.encode(ev, stories.allowed_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Writing and editing
  // ===================================================================

  contribute(args: stories.contribute_arguments): stories.uint64 {
    this.enter();
    this.requireNotPaused();
    const author = this.requireAddress(args.author, "STORIES: invalid author address");
    this.requireSigner(author, "STORIES: author has not authorized this");
    this.requireNotBlocked(author);
    const cfg = this.config.get()!;
    const ink = this.requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: story is not open for writing");

    const text = this.text(args.text);
    const cost = <u64>this.requireText(text, true);
    System.require(cost == args.expected_ink, "STORIES: Ink cost does not match expected_ink");
    System.require(cost <= <u64>cfg.contribution_cap, "STORIES: text is over the per-submission cap");
    System.require(SafeMath.add(st.used_chars, cost) <= st.max_chars, "STORIES: not enough space left in this story");
    System.require(
      cost >= this.minContribution(cfg) || SafeMath.add(st.used_chars, cost) == st.max_chars,
      "STORIES: text is shorter than the minimum (only the piece that fills the story may be shorter)"
    );
    this.requireRightsAndTerms(author, args.rights_confirmed, args.terms_version, cfg);
    let insertAfter = args.insert_after;
    if (args.after_my_last) {
      // The next piece of a multi-part addition: right after this writer's
      // previous part in this story.
      const count = this.authorCount.get(author)!.value;
      System.require(count > 0, "STORIES: you have no earlier part in this story");
      const last = this.authorList.get(this.addrIdxKey(author, count - 1))!;
      System.require(last.story_id == args.story_id, "STORIES: you have no earlier part in this story");
      insertAfter = last.seq;
    }
    if (insertAfter != 0) {
      // Text added between parts: it is read right after the part it follows.
      System.require(insertAfter <= st.segment_count, "STORIES: unknown part to add text after");
      const target = this.segments.get(this.pairKey(args.story_id, insertAfter));
      System.require(target != null && target!.status == stories.segment_status.SEGMENT_ACTIVE,
        "STORIES: you can only add text after a part that is still in the story");
    }

    const inviteOnly = st.visibility != stories.visibility.VISIBILITY_PUBLIC;
    const trial = this.checkWriter(args.story_id, st, author, cost, cfg);

    // Paid from the story's fund when it has enough; otherwise by the writer.
    const fromFund = inviteOnly && st.fund >= cost;
    if (fromFund) st.fund = st.fund - cost;
    const seq = this.writeSegment(args.story_id, st, author, text, cost, args.starts_chapter, args.ai_assisted, trial, ink, args.terms_version, insertAfter, fromFund, this.requireCitation(args.citation));
    this.leave();
    return new stories.uint64(seq);
  }

  edit_segment(args: stories.edit_segment_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const editor = this.requireAddress(args.editor, "STORIES: invalid editor address");
    this.requireSigner(editor, "STORIES: editor has not authorized this");
    const ink = this.requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: text can only be edited while the story is open");
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    // Private stories: the opener and editors edit anyone's part. Public
    // stories: only the part's own writer; everyone else uses revise_part.
    // Only the part's own writer edits it here (free, light edits). Anyone
    // else changes it with revise_part, which costs Ink.
    System.require(Arrays.equal(editor, seg.author!), "STORIES: only the part's writer may edit it for free; others can change it for Ink");

    const text = this.text(args.new_text);
    const newCost = <u64>this.requireText(text, true);
    System.require(newCost == args.expected_cost, "STORIES: Ink cost does not match expected_cost");
    System.require(newCost <= SafeMath.add(seg.charged, this.allowance(seg.original_cost)), "STORIES: edit grows the text too much (light edits only)");
    const oldCost = seg.current_cost;
    const nextUsed = SafeMath.add(SafeMath.sub(st.used_chars, oldCost), newCost);
    if (newCost > oldCost) System.require(nextUsed <= st.max_chars, "STORIES: not enough space left in this story");

    const refund = seg.charged > newCost ? seg.charged - newCost : 0;
    const now = this.now();
    seg.text = text;
    seg.text_hash = this.sha256(StringBytes.stringToBytes(text));
    seg.current_cost = newCost;
    seg.charged = seg.charged - refund;
    seg.last_edited_by = editor;
    seg.last_edited_at = now;
    this.segments.put(key, seg);

    st.used_chars = nextUsed;
    st.last_activity_at = now;
    if (Arrays.equal(editor, st.opener!)) st.opener_last_active = now;
    const mint = this.settleRefund(args.story_id, st, seg, refund);
    this.maybeAutoLock(args.story_id, st, editor);
    this.putStory(args.story_id, st);

    this.emitChange(args.story_id, args.seq, editor, oldCost, newCost, refund, false, false, seg.author!);
    if (mint) this.refundInk(ink, seg.author!, refund, args.story_id, args.seq);
    this.leave();
    return new stories.empty_object();
  }

  remove_segment(args: stories.remove_segment_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const editor = this.requireAddress(args.editor, "STORIES: invalid editor address");
    this.requireSigner(editor, "STORIES: editor has not authorized this");
    const ink = this.requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: text can only be removed while the story is open");
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    // The part's own writer removes it for free. The opener or an editor may
    // remove a part that is hidden (moderation). Anyone else uses revise_part.
    System.require(Arrays.equal(editor, seg.author!) || (seg.hidden && this.isPrivileged(args.story_id, st, editor)),
      "STORIES: only the part's writer may remove it for free; others can remove it for Ink");

    // A part the admin or the copy checker hid is not refunded; one hidden
    // only by writer reports is (AB-012).
    const refund = this.refundable(seg) ? seg.charged : 0;
    if (seg.hidden) this.unhideCount(st);
    const oldCost = seg.current_cost;
    const now = this.now();
    this.clearSegment(seg, editor, now);
    this.segments.put(key, seg);

    st.used_chars = SafeMath.sub(st.used_chars, oldCost);
    st.last_activity_at = now;
    if (Arrays.equal(editor, st.opener!)) st.opener_last_active = now;
    const mint = this.settleRefund(args.story_id, st, seg, refund);
    this.putStory(args.story_id, st);

    this.emitChange(args.story_id, args.seq, editor, oldCost, 0, refund, true, false, seg.author!);
    if (mint) this.refundInk(ink, seg.author!, refund, args.story_id, args.seq);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Closing and the final edit
  // ===================================================================

  close_story(args: stories.close_story_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    // Closing is free (October 2026): the open price already paid for the
    // story. The token argument is kept for older callers and ignored.
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(
      st.status == stories.story_status.STATUS_LOCKED ||
        (st.status == stories.story_status.STATUS_OPEN && this.closeReady(st)),
      "STORIES: story cannot be closed yet"
    );
    const now = this.now();
    st.status = stories.story_status.STATUS_EDITING;
    st.finalizer_is_admin = false;
    st.close_fee_paid = true;
    if (st.locked_at == 0) st.locked_at = now;
    st.opener_last_active = now;
    this.putStory(args.story_id, st);
    this.emitStatus(args.story_id, st.status, "closed", opener);
    this.leave();
    return new stories.empty_object();
  }

  request_admin_finalize(args: stories.request_admin_finalize_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(
      st.status == stories.story_status.STATUS_OPEN ||
        st.status == stories.story_status.STATUS_LOCKED ||
        st.status == stories.story_status.STATUS_EDITING,
      "STORIES: story is not active"
    );
    st.admin_finalize_requested = args.requested;
    st.opener_last_active = this.now();
    this.putStory(args.story_id, st);
    const ev = new stories.admin_finalize_request_event(args.story_id, args.requested);
    System.event("stories.admin_finalize_request_event", Protobuf.encode(ev, stories.admin_finalize_request_event.encode), [opener]);
    this.leave();
    return new stories.empty_object();
  }

  // Anyone may push the final edit past a long run of removed text (fix M2).
  advance_final_cursor(args: stories.advance_final_cursor_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_EDITING, "STORIES: story is not in the final edit");
    const before = st.final_cursor;
    this.skipRemoved(args.story_id, st);
    System.require(st.final_cursor > before, "STORIES: nothing to skip; the next segment still needs the finalizer");
    this.putStory(args.story_id, st);
    const ev = new stories.final_batch_event(args.story_id, st.final_cursor, st.running_hash);
    System.event("stories.final_batch_event", Protobuf.encode(ev, stories.final_batch_event.encode), [st.opener!]);
    this.leave();
    return new stories.empty_object();
  }

  admin_take_over(args: stories.admin_take_over_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const st = this.requireStory(args.story_id);
    const eligible =
      st.status == stories.story_status.STATUS_LOCKED ||
      (st.status == stories.story_status.STATUS_OPEN && this.closeReady(st)) ||
      (st.status == stories.story_status.STATUS_EDITING && !st.finalizer_is_admin);
    System.require(eligible, "STORIES: story is not ready for an admin finalize");
    const now = this.now();
    const wait = SafeMath.mul(<u64>this.config.get()!.inactivity_days, DAY_SECONDS);
    System.require(
      st.admin_finalize_requested || now >= SafeMath.add(st.opener_last_active, wait),
      "STORIES: the opener has not asked and has not been inactive long enough"
    );
    st.status = stories.story_status.STATUS_EDITING;
    st.finalizer_is_admin = true;
    if (st.locked_at == 0) st.locked_at = now;
    this.putStory(args.story_id, st);
    this.emitStatus(args.story_id, st.status, "admin-take-over", this.getAdmin());
    this.leave();
    return new stories.empty_object();
  }

  submit_final_batch(args: stories.submit_final_batch_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const finalizer = this.requireAddress(args.finalizer, "STORIES: invalid finalizer address");
    const ink = this.requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_EDITING, "STORIES: story is not in the final edit");
    this.requireFinalizer(st, finalizer);
    const items = args.items;
    System.require(items.length > 0 && items.length <= MAX_BATCH_ITEMS, "STORIES: send 1 to 20 items per batch");

    let units: u64 = 0;
    const now = this.now();
    for (let i = 0; i < items.length; i++) {
      this.skipRemoved(args.story_id, st);
      const item = items[i];
      const next = st.final_cursor + 1;
      System.require(next <= st.segment_count, "STORIES: more items than segments");
      System.require(
        this.skipBudget > 0 || this.segments.get(this.pairKey(args.story_id, next))!.status != stories.segment_status.SEGMENT_REMOVED,
        "STORIES: a long run of removed text is next; call advance_final_cursor first"
      );
      System.require(item.seq == next, "STORIES: items must be in order, starting at the next unprocessed segment");
      const key = this.pairKey(args.story_id, next);
      const seg = this.segments.get(key)!;
      const oldCost = seg.current_cost;
      let refund: u64 = 0;
      let removed = false;
      System.require(
        !seg.hidden || item.mode == stories.final_mode.FINAL_REMOVED,
        "STORIES: a hidden part can only be removed in the final edit (or unhidden first)"
      );

      if (item.mode == stories.final_mode.FINAL_UNCHANGED) {
        seg.surviving = oldCost < seg.charged ? oldCost : seg.charged;
      } else if (item.mode == stories.final_mode.FINAL_EDITED) {
        const text = this.text(item.text);
        const newCost = <u64>this.requireText(text, true);
        System.require(newCost == item.expected_cost, "STORIES: Ink cost does not match expected_cost");
        System.require(newCost <= SafeMath.add(seg.charged, this.allowance(seg.original_cost)), "STORIES: edit grows the text too much (light edits only)");
        units = SafeMath.add(units, newCost);
        System.require(units <= MAX_BATCH_UNITS, "STORIES: batch text is over 20,000 Ink units");
        refund = seg.charged > newCost ? seg.charged - newCost : 0;
        this.recordChanger(key, seg, finalizer);
        seg.text = text;
        seg.text_hash = this.sha256(StringBytes.stringToBytes(text));
        seg.current_cost = newCost;
        seg.charged = seg.charged - refund;
        seg.last_edited_by = finalizer;
        seg.last_edited_at = now;
        seg.surviving = newCost < seg.charged ? newCost : seg.charged;
        // The final pass may grow text a little past max_chars (grammar
        // fixes in a full book). Growth stays inside the light-edit allowance.
        st.used_chars = SafeMath.add(SafeMath.sub(st.used_chars, oldCost), newCost);
      } else if (item.mode == stories.final_mode.FINAL_REMOVED) {
        refund = this.refundable(seg) ? seg.charged : 0;
        if (seg.hidden) this.unhideCount(st);
        this.clearSegment(seg, finalizer, now);
        st.used_chars = SafeMath.sub(st.used_chars, oldCost);
        removed = true;
      } else {
        System.require(false, "STORIES: unknown final mode");
      }

      seg.final_mode = item.mode;
      this.segments.put(key, seg);
      const mint = this.settleRefund(args.story_id, st, seg, refund);
      this.addSurviving(args.story_id, seg.author!, seg.surviving);
      st.running_hash = this.foldHash(st.running_hash, next, <u8>item.mode, removed ? new Uint8Array(32) : seg.text_hash!);
      st.final_cursor = next;
      if (item.mode != stories.final_mode.FINAL_UNCHANGED) {
        this.emitChange(args.story_id, next, finalizer, oldCost, seg.current_cost, refund, removed, true, seg.author!);
      }
      if (mint) this.refundInk(ink, seg.author!, refund, args.story_id, next);
    }
    this.skipRemoved(args.story_id, st);
    if (!st.finalizer_is_admin) st.opener_last_active = now;
    this.putStory(args.story_id, st);
    const ev = new stories.final_batch_event(args.story_id, st.final_cursor, st.running_hash);
    System.event("stories.final_batch_event", Protobuf.encode(ev, stories.final_batch_event.encode), [st.opener!]);
    this.leave();
    return new stories.empty_object();
  }

  finalize(args: stories.finalize_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const finalizer = this.requireAddress(args.finalizer, "STORIES: invalid finalizer address");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_EDITING, "STORIES: story is not in the final edit");
    this.requireFinalizer(st, finalizer);
    this.skipRemoved(args.story_id, st);
    System.require(st.final_cursor == st.segment_count, "STORIES: some segments are not processed yet");
    System.require(st.hidden_count == 0, "STORIES: some parts are hidden while they are checked; unhide or remove them first");
    const uri = this.text(args.pdf_uri);
    System.require(uri.length >= 1 && uri.length <= MAX_PDF_URI && this.isPlainAscii(uri), "STORIES: PDF link must be 1 to 200 plain characters");
    const hash = args.pdf_hash;
    System.require(hash != null && hash.length >= MIN_PDF_HASH && hash.length <= MAX_PDF_HASH, "STORIES: PDF hash must be 32 to 64 bytes");

    st.status = stories.story_status.STATUS_FINALIZED;
    st.pdf_uri = uri;
    st.pdf_hash = hash;
    if (!st.finalizer_is_admin) st.opener_last_active = this.now();
    this.decrementOpen(st.opener!);
    const back = this.takeFundBack(args.story_id, st);
    this.putStory(args.story_id, st);
    if (back > 0) this.returnFund(args.story_id, st, back);
    this.emitStatus(args.story_id, st.status, "finalized", finalizer);
    const ev = new stories.story_finalized_event(args.story_id, uri, hash, st.running_hash);
    System.event("stories.story_finalized_event", Protobuf.encode(ev, stories.story_finalized_event.encode), [st.opener!]);
    this.leave();
    return new stories.empty_object();
  }

  // Opener adds Ink to an invite-only story's fund.
  top_up_fund(args: stories.top_up_fund_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const ink = this.requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: a fund can only be topped up while the story is open");
    System.require(st.visibility != stories.visibility.VISIBILITY_PUBLIC, "STORIES: only unlisted and private stories have a fund");
    System.require(args.amount > 0, "STORIES: add at least 1 Ink");
    st.opener_last_active = this.now();
    this.depositFund(args.story_id, st, opener, args.amount, ink);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Moderation
  // ===================================================================

  // Admin or moderator hides or unhides a live part, at any stage. Works
  // while paused, so moderation never waits for an unpause.
  set_segment_hidden(args: stories.set_segment_hidden_arguments): stories.empty_object {
    this.enter();
    const actor = this.requireAddress(args.actor, "STORIES: invalid address");
    this.requireModeratorOrAdmin(actor);
    const st = this.requireStory(args.story_id);
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    const note = this.requireNote(args.note);
    if (args.hidden) {
      System.require(!seg.hidden, "STORIES: part is already hidden");
      System.require(args.reason != stories.moderation_reason.REASON_UNSPECIFIED, "STORIES: give a reason");
      seg.hidden = true;
      seg.moderation_reason = args.reason;
      st.hidden_count = st.hidden_count + 1;
    } else {
      System.require(seg.hidden, "STORIES: part is not hidden");
      seg.hidden = false;
      seg.hidden_by_reports = false;
      seg.moderation_reason = stories.moderation_reason.REASON_UNSPECIFIED;
      // Old reports do not hide it again; it takes new ones.
      seg.report_count = 0;
      this.unhideCount(st);
    }
    this.segments.put(key, seg);
    this.putStory(args.story_id, st);
    this.emitModeration(args.story_id, args.seq,
      args.hidden ? stories.moderation_action.ACTION_HIDE : stories.moderation_action.ACTION_UNHIDE,
      args.hidden ? args.reason : stories.moderation_reason.REASON_UNSPECIFIED, actor, seg, note);
    this.leave();
    return new stories.empty_object();
  }

  // Change someone's part while the story is open: anyone who can write in
  // the story (the opener and editors too) pays for the letters they add
  // and remove, at least 10, times 2. The multiplier doubles with every
  // change to the same part (2x, 4x, 8x, ...), with no limit. The part stays
  // its writer's; letters removed from it are refunded to whoever paid for
  // them. Empty text removes the part (the writer gets all their Ink back).
  // Every version is kept and can be read back. There are no free changes.
  revise_part(args: stories.revise_part_arguments): stories.uint32 {
    this.enter();
    this.requireNotPaused();
    const writer = this.requireAddress(args.writer, "STORIES: invalid writer address");
    this.requireSigner(writer, "STORIES: writer has not authorized this");
    this.requireNotBlocked(writer);
    const cfg = this.config.get()!;
    const ink = this.requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: parts can only be changed while the story is open");
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(!seg.hidden, "STORIES: a hidden part can't be changed");
    this.requireRightsAndTerms(writer, args.rights_confirmed, args.terms_version, cfg);

    const text = this.text(args.text);
    const removing = text.length == 0;
    const newCost: u64 = removing ? 0 : <u64>this.requireText(text, true);
    System.require(newCost <= <u64>cfg.contribution_cap, "STORIES: text is over the per-submission cap");
    const oldText = seg.text != null ? seg.text! : "";
    System.require(text != oldText, "STORIES: the text is unchanged");

    // What changed: everything between the common start and the common end.
    let pre = 0;
    const maxPre = min<i32>(oldText.length, text.length);
    while (pre < maxPre && oldText.charCodeAt(pre) == text.charCodeAt(pre)) pre++;
    // Never split an emoji (a surrogate pair) between "same" and "changed".
    if (pre > 0 && ((pre < oldText.length && this.isLowSurrogate(oldText.charCodeAt(pre))) ||
      (pre < text.length && this.isLowSurrogate(text.charCodeAt(pre))))) pre--;
    let suf = 0;
    const maxSuf = min<i32>(oldText.length, text.length) - pre;
    while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) == text.charCodeAt(text.length - 1 - suf)) suf++;
    if (suf > 0 && (this.isLowSurrogate(oldText.charCodeAt(oldText.length - suf)) || this.isLowSurrogate(text.charCodeAt(text.length - suf)))) suf--;
    const removed = <u64>(oldText.length - pre - suf);
    const added = <u64>(text.length - pre - suf);

    const changes: u32 = seg.version_count == 0 ? 0 : seg.version_count - 1;
    System.require(changes < 60, "STORIES: changing this part again would cost more Ink than exists");
    const units = removed + added < MIN_CHANGE_UNITS ? MIN_CHANGE_UNITS : removed + added;
    const price = SafeMath.mul(units, (<u64>1) << (<u64>changes + 1));
    System.require(args.expected_ink == price, "STORIES: the change price does not match expected_ink (2x the letters added and removed, at least 10, doubling each time)");
    this.checkWriter(args.story_id, st, writer, added, cfg);

    const now = this.now();
    const oldCost = seg.current_cost;
    const nextUsed = SafeMath.add(SafeMath.sub(st.used_chars, oldCost), newCost);
    if (newCost > oldCost) System.require(nextUsed <= st.max_chars, "STORIES: not enough space left in this story");

    // Keep the original as version 1 the first time a part is changed.
    if (seg.version_count == 0) {
      this.versions.put(this.versionKey(args.story_id, args.seq, 1), new stories.segment_version(
        1, seg.author, oldText, seg.original_cost, seg.created_at, VERSION_ORIGINAL, seg.author));
      seg.version_count = 1;
    }
    const version = seg.version_count + 1;
    this.recordChanger(key, seg, writer);
    const owner = seg.author!;

    // Removed letters go back to whoever paid for them.
    const refund = removing ? seg.charged : (removed < seg.charged ? removed : seg.charged);
    const mint = this.settleRefund(args.story_id, st, seg, refund);

    // The changer pays: from the pool in private stories while it has enough.
    const inviteOnly = st.visibility != stories.visibility.VISIBILITY_PUBLIC;
    const fromFund = inviteOnly && st.fund >= price;
    if (fromFund) st.fund = st.fund - price;
    else st.total_burned = SafeMath.add(st.total_burned, price);

    if (removing) {
      this.versions.put(this.versionKey(args.story_id, args.seq, version), new stories.segment_version(
        version, owner, "", 0, now, VERSION_REMOVED, writer));
      seg.version_count = version;
      this.clearSegment(seg, writer, now);
    } else {
      if (!Arrays.equal(writer, owner)) {
        // The changer's added words count toward their part of the story.
        const totalKey = this.idAddrKey(args.story_id, writer);
        const total = this.contributorTotals.get(totalKey);
        if (total == null) {
          st.contributor_count = st.contributor_count + 1;
          this.contributorTotals.put(totalKey, new stories.uint64(added));
        } else {
          total.value = SafeMath.add(total.value, added);
          this.contributorTotals.put(totalKey, total);
        }
        const count = this.authorCount.get(writer)!;
        this.authorList.put(this.addrIdxKey(writer, count.value), new stories.segment_ref(args.story_id, args.seq));
        count.value = count.value + 1;
        this.authorCount.put(writer, count);
      }
      seg.charged = seg.charged - refund;
      seg.text = text;
      seg.text_hash = this.sha256(StringBytes.stringToBytes(text));
      seg.current_cost = newCost;
      seg.last_edited_by = writer;
      seg.last_edited_at = now;
      seg.source_note = "";
      seg.version_count = version;
      this.versions.put(this.versionKey(args.story_id, args.seq, version), new stories.segment_version(
        version, owner, text, newCost, now, VERSION_CHANGED, writer));
    }
    this.segments.put(key, seg);
    st.used_chars = nextUsed;
    st.last_activity_at = now;
    if (Arrays.equal(writer, st.opener!)) st.opener_last_active = now;
    this.maybeAutoLock(args.story_id, st, writer);
    this.putStory(args.story_id, st);
    const ev = new stories.revise_event(args.story_id, args.seq, writer, removing ? VERSION_REMOVED : VERSION_CHANGED, version, price, owner, refund);
    System.event("stories.revise_event", Protobuf.encode(ev, stories.revise_event.encode), [writer, owner]);
    if (!fromFund) {
      const burn = new stories.ink_burn_call(writer, price, BURN_CONTRIBUTION, "c:" + args.story_id.toString() + ":" + args.seq.toString());
      this.callOut(ink, INK_BURN_ENTRY, Protobuf.encode(burn, stories.ink_burn_call.encode), [writer], "STORIES: Ink burn failed");
    }
    if (mint) this.refundInk(ink, owner, refund, args.story_id, args.seq);
    this.leave();
    return new stories.uint32(version);
  }

  private isLowSurrogate(c: i32): bool {
    return c >= 0xdc00 && c <= 0xdfff;
  }

  // "The story so far": the opener, an editor, or anyone who has written in
  // the story keeps a short summary up to date.
  set_story_summary(args: stories.set_story_summary_arguments): stories.empty_object {
    this.enter();
    const account = this.requireAddress(args.account, "STORIES: invalid address");
    this.requireSigner(account, "STORIES: account has not authorized this");
    this.requireNotBlocked(account);
    const st = this.requireStory(args.story_id);
    System.require(
      this.isPrivileged(args.story_id, st, account) || this.contributorTotals.get(this.idAddrKey(args.story_id, account)) != null,
      "STORIES: only the opener, an editor or a writer of this story may update its summary"
    );
    const summary = this.text(args.summary);
    System.require(summary.length <= MAX_SUMMARY, "STORIES: the summary must be at most 1,500 characters");
    if (summary.length > 0) this.requireText(summary, false);
    st.summary = summary;
    st.summary_by = account;
    st.summary_at = this.now();
    this.putStory(args.story_id, st);
    const ev = new stories.summary_event(args.story_id, account, summary);
    System.event("stories.summary_event", Protobuf.encode(ev, stories.summary_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  // A reader saves their place (bookmark) so it follows their wallet. Anyone
  // may read any story, so any wallet may save a place in any existing story.
  set_reading_place(args: stories.set_reading_place_arguments): stories.empty_object {
    const reader = this.requireAddress(args.reader, "STORIES: invalid address");
    this.requireSigner(reader, "STORIES: reader has not authorized this");
    const st = this.requireStory(args.story_id);
    System.require(args.seq <= st.segment_count, "STORIES: unknown segment");
    System.require(args.percent <= 100, "STORIES: percent must be 0 to 100");
    const key = this.idAddrKey(args.story_id, reader);
    const existing = this.readingPlace.get(key);
    if (existing == null) {
      // First place in this story: add it to the reader's list.
      const count = this.readingCount.get(reader)!;
      this.readingList.put(this.addrIdxKey(reader, count.value), new stories.uint64(args.story_id));
      count.value = count.value + 1;
      this.readingCount.put(reader, count);
    }
    this.readingPlace.put(key, new stories.reading_place(args.story_id, args.seq, args.chapter, args.percent, this.now()));
    return new stories.empty_object();
  }

  // The part's writer, the opener or an editor sets the part's citation:
  // what it quotes. The copy checker leaves cited quotes alone.
  set_citation(args: stories.set_citation_arguments): stories.empty_object {
    this.enter();
    const account = this.requireAddress(args.account, "STORIES: invalid address");
    this.requireSigner(account, "STORIES: account has not authorized this");
    const st = this.requireStory(args.story_id);
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(Arrays.equal(account, seg.author!) || this.isPrivileged(args.story_id, st, account),
      "STORIES: only the part's writer, the opener or an editor may do this");
    const citation = this.requireCitation(args.citation);
    seg.citation = citation;
    this.segments.put(key, seg);
    const ev = new stories.citation_event(args.story_id, args.seq, account, citation, false);
    System.event("stories.citation_event", Protobuf.encode(ev, stories.citation_event.encode), [seg.author!]);
    this.leave();
    return new stories.empty_object();
  }

  // Admin or moderator (the copy checker) notes where parts of a text also
  // appear. Shown under the part; it does not hide anything.
  set_source_note(args: stories.set_source_note_arguments): stories.empty_object {
    this.enter();
    const actor = this.requireAddress(args.actor, "STORIES: invalid address");
    this.requireModeratorOrAdmin(actor);
    this.requireStory(args.story_id);
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    const note = this.requireNote(args.note);
    seg.source_note = note;
    this.segments.put(key, seg);
    const ev = new stories.citation_event(args.story_id, args.seq, actor, note, true);
    System.event("stories.citation_event", Protobuf.encode(ev, stories.citation_event.encode), [seg.author!]);
    this.leave();
    return new stories.empty_object();
  }

  // The story's opener or an editor brings back a hidden part (the checker or
  // writer reports hid it). A part taken down by the admin stays removed.
  restore_segment(args: stories.restore_segment_arguments): stories.empty_object {
    this.enter();
    const actor = this.requireAddress(args.actor, "STORIES: invalid address");
    this.requireSigner(actor, "STORIES: actor has not authorized this");
    const st = this.requireStory(args.story_id);
    System.require(this.isPrivileged(args.story_id, st, actor), "STORIES: only the opener or an editor may do this");
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(seg.hidden, "STORIES: part is not hidden");
    const note = this.requireNote(args.note);
    seg.hidden = false;
    seg.hidden_by_reports = false;
    seg.restored = true;
    seg.moderation_reason = stories.moderation_reason.REASON_UNSPECIFIED;
    seg.report_count = 0;
    this.unhideCount(st);
    this.segments.put(key, seg);
    this.putStory(args.story_id, st);
    this.emitModeration(args.story_id, args.seq, stories.moderation_action.ACTION_RESTORE,
      stories.moderation_reason.REASON_UNSPECIFIED, actor, seg, note.length ? note : "restored by the story's opener or an editor");
    this.leave();
    return new stories.empty_object();
  }

  // Admin removes a part's text for good, at any stage. No Ink refund.
  takedown_segment(args: stories.takedown_segment_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const admin = this.getAdmin();
    const st = this.requireStory(args.story_id);
    const key = this.pairKey(args.story_id, args.seq);
    const found = this.segments.get(key);
    System.require(found != null, "STORIES: unknown segment");
    const seg = found!;
    System.require(!seg.taken_down, "STORIES: part was already taken down");
    System.require(args.reason != stories.moderation_reason.REASON_UNSPECIFIED, "STORIES: give a reason");
    const note = this.requireNote(args.note);
    const fingerprint = seg.text_hash != null ? seg.text_hash! : new Uint8Array(0);
    const now = this.now();
    // Who gets the strike (AB-001, AB-028, AB-029). A part nobody else
    // changed strikes its writer. Once anyone else changed it, even with a
    // one-letter fix or a cut, no rule can tell who made it infringing, so
    // the admin compares the versions and names the writer or a wallet that
    // changed the part, or chooses no strike. Removing a part is not a
    // change of its words. version_count also catches parts revised before
    // edited_by_others existed (it is also set when the writer revises their own).
    const changed = seg.edited_by_others || seg.version_count > 0;
    const named = args.strike != null && args.strike!.length > 0;
    System.require(!(named && args.no_strike), "STORIES: name a wallet to strike or choose no strike, not both");
    let struck: Uint8Array = new Uint8Array(0);
    if (named) {
      struck = args.strike!;
      const changer = this.partEditors.get(this.join(key, struck))!.value;
      System.require(Arrays.equal(struck, seg.author!) || changer,
        "STORIES: strike the part's writer or a wallet that changed it");
    } else if (!args.no_strike) {
      System.require(!changed, "STORIES: someone other than the writer changed this part; name who gets the strike, or choose no strike");
      struck = seg.author!;
    }

    if (seg.status == stories.segment_status.SEGMENT_ACTIVE) {
      const author = seg.author!;
      // The writer's live and surviving totals lose this part; nothing is refunded.
      const totalKey = this.idAddrKey(args.story_id, author);
      const total = this.contributorTotals.get(totalKey);
      if (total != null) {
        total.value = total.value > seg.charged ? total.value - seg.charged : 0;
        this.contributorTotals.put(totalKey, total);
      }
      if (seg.surviving > 0) {
        const surv = this.survivingTotals.get(totalKey)!;
        surv.value = surv.value > seg.surviving ? surv.value - seg.surviving : 0;
        this.survivingTotals.put(totalKey, surv);
      }
      if (seg.hidden) this.unhideCount(st);
      st.used_chars = SafeMath.sub(st.used_chars, seg.current_cost);
      this.clearSegment(seg, admin, now);
      seg.hidden = false;
      // A takedown also wipes every kept version of the part.
      for (let v: u32 = 1; v <= seg.version_count; v++) this.versions.remove(this.versionKey(args.story_id, args.seq, v));
      seg.version_count = 0;
      // Already processed by the final edit: record it as removed there too.
      if (args.seq <= st.final_cursor) seg.final_mode = stories.final_mode.FINAL_REMOVED;
      if (st.status == stories.story_status.STATUS_FINALIZED) st.needs_new_pdf = true;
      if (st.status == stories.story_status.STATUS_LOCKED && st.used_chars < st.max_chars) {
        // Space opened up again: the story takes new parts.
        st.status = stories.story_status.STATUS_OPEN;
        st.locked_at = 0;
        this.emitStatus(args.story_id, st.status, "reopened-after-takedown", admin);
      }
    }
    seg.taken_down = true;
    seg.moderation_reason = args.reason;
    this.segments.put(key, seg);
    this.putStory(args.story_id, st);
    if (struck.length > 0) this.addStrike(struck, admin);

    const ev = new stories.moderation_event(args.story_id, args.seq, stories.moderation_action.ACTION_TAKEDOWN,
      args.reason, admin, seg.author, note, fingerprint, struck);
    const impacted = struck.length == 0 || Arrays.equal(struck, seg.author!) ? [seg.author!] : [seg.author!, struck];
    System.event("stories.moderation_event", Protobuf.encode(ev, stories.moderation_event.encode), impacted);
    this.leave();
    return new stories.empty_object();
  }

  // Any wallet may report a live part once. Only reports from wallets that
  // have written on SwarmTales count toward hiding it.
  report_segment(args: stories.report_segment_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const reporter = this.requireAddress(args.reporter, "STORIES: invalid reporter address");
    this.requireSigner(reporter, "STORIES: reporter has not authorized this");
    this.requireNotBlocked(reporter);
    const st = this.requireStory(args.story_id);
    const key = this.pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(!seg.hidden, "STORIES: this part is already hidden while it is checked");
    System.require(!Arrays.equal(reporter, seg.author!), "STORIES: you cannot report your own part");
    System.require(args.reason != stories.moderation_reason.REASON_UNSPECIFIED, "STORIES: give a reason");
    const note = this.requireNote(args.note);
    const rkey = this.reportKey(args.story_id, args.seq, reporter);
    System.require(!this.reports.get(rkey)!.value, "STORIES: you already reported this part");
    this.reports.put(rkey, new stories.boole(true));

    const counted = this.authorCount.get(reporter)!.value > 0;
    if (counted) seg.report_count = seg.report_count + 1;
    const ev = new stories.report_event(args.story_id, args.seq, reporter, args.reason, note, counted, seg.report_count);
    System.event("stories.report_event", Protobuf.encode(ev, stories.report_event.encode), [seg.author!]);

    if (counted && seg.report_count >= this.reportThreshold(this.config.get()!)) {
      seg.hidden = true;
      seg.hidden_by_reports = true;
      seg.moderation_reason = args.reason;
      st.hidden_count = st.hidden_count + 1;
      this.putStory(args.story_id, st);
      this.emitModeration(args.story_id, args.seq, stories.moderation_action.ACTION_REPORT_HIDE, args.reason, reporter, seg,
        "hidden after " + seg.report_count.toString() + " writer reports");
    }
    this.segments.put(key, seg);
    this.leave();
    return new stories.empty_object();
  }

  // After a takedown in a finalized story, the admin publishes the new PDF.
  replace_pdf(args: stories.replace_pdf_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_FINALIZED && st.needs_new_pdf, "STORIES: this story does not need a new PDF");
    const uri = this.text(args.pdf_uri);
    System.require(uri.length >= 1 && uri.length <= MAX_PDF_URI && this.isPlainAscii(uri), "STORIES: PDF link must be 1 to 200 plain characters");
    const hash = args.pdf_hash;
    System.require(hash != null && hash.length >= MIN_PDF_HASH && hash.length <= MAX_PDF_HASH, "STORIES: PDF hash must be 32 to 64 bytes");
    st.pdf_uri = uri;
    st.pdf_hash = hash;
    st.needs_new_pdf = false;
    this.putStory(args.story_id, st);
    this.emitStatus(args.story_id, st.status, "pdf-replaced", this.getAdmin());
    const ev = new stories.story_finalized_event(args.story_id, uri, hash, st.running_hash);
    System.event("stories.story_finalized_event", Protobuf.encode(ev, stories.story_finalized_event.encode), [st.opener!]);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Archive
  // ===================================================================

  archive_if_stale(args: stories.archive_if_stale_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: only an open story can be archived");
    const wait = SafeMath.mul(<u64>this.config.get()!.archive_days, DAY_SECONDS);
    System.require(this.now() >= SafeMath.add(st.last_activity_at, wait), "STORIES: story has been active recently");
    st.status = stories.story_status.STATUS_ARCHIVED;
    this.decrementOpen(st.opener!);
    const back = this.takeFundBack(args.story_id, st);
    this.putStory(args.story_id, st);
    if (back > 0) this.returnFund(args.story_id, st, back);
    this.emitStatus(args.story_id, st.status, "archived", new Uint8Array(0));
    this.leave();
    return new stories.empty_object();
  }

  revive(args: stories.revive_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = this.requireAddress(args.opener, "STORIES: invalid opener address");
    this.requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status == stories.story_status.STATUS_ARCHIVED, "STORIES: story is not archived");
    System.require(!st.revived, "STORIES: the free revive was already used");
    const open = this.openCount.get(opener)!;
    System.require(open.value < this.config.get()!.open_limit, "STORIES: you already have the maximum number of open projects");
    open.value = open.value + 1;
    this.openCount.put(opener, open);
    const now = this.now();
    st.status = stories.story_status.STATUS_OPEN;
    st.revived = true;
    st.last_activity_at = now;
    st.opener_last_active = now;
    this.putStory(args.story_id, st);
    this.emitStatus(args.story_id, st.status, "revived", opener);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Admin
  // ===================================================================

  set_addresses(args: stories.set_addresses_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const ink = this.requireAddress(args.ink, "STORIES: invalid Ink address");
    const shopId = this.requireAddress(args.shop, "STORIES: invalid Shop address");
    System.require(!Arrays.equal(ink, this.contractId) && !Arrays.equal(shopId, this.contractId), "STORIES: Ink and Shop cannot be the Stories contract");
    System.require(!Arrays.equal(ink, shopId), "STORIES: Ink and Shop must be different contracts");
    const cfg = this.config.get()!;
    cfg.ink = ink;
    cfg.shop = shopId;
    this.saveConfig(cfg);
    const ev = new stories.addresses_event(ink, shopId);
    System.event("stories.addresses_event", Protobuf.encode(ev, stories.addresses_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  set_limits(args: stories.set_limits_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    System.require(args.contribution_cap >= CAP_MIN && args.contribution_cap <= CAP_MAX, "STORIES: per-submission cap must be 100 to 10000");
    System.require(args.trial_limit <= TRIAL_MAX, "STORIES: trial limit must be 0 to 5000");
    System.require(args.open_limit >= OPEN_LIMIT_MIN && args.open_limit <= OPEN_LIMIT_MAX, "STORIES: open-project limit must be 1 to 10");
    System.require(args.archive_days >= ARCHIVE_DAYS_MIN && args.archive_days <= DAYS_MAX, "STORIES: archive period must be 30 to 365 days");
    System.require(args.inactivity_days >= INACTIVITY_DAYS_MIN && args.inactivity_days <= DAYS_MAX, "STORIES: admin-finalize wait must be 30 to 365 days");
    const fullPrice = args.full_price_projects == 0 ? DEFAULT_FULL_PRICE_PROJECTS : args.full_price_projects;
    System.require(fullPrice <= OPEN_LIMIT_MAX, "STORIES: normal-price projects must be 1 to 10");
    const maxMult = args.max_price_multiplier == 0 ? DEFAULT_MAX_PRICE_MULTIPLIER : args.max_price_multiplier;
    System.require(maxMult <= MAX_PRICE_MULTIPLIER, "STORIES: the price ceiling must be 1 to 1024 times");
    const cfg = this.config.get()!;
    cfg.contribution_cap = args.contribution_cap;
    cfg.trial_limit = args.trial_limit;
    cfg.open_limit = args.open_limit;
    cfg.archive_days = args.archive_days;
    cfg.inactivity_days = args.inactivity_days;
    cfg.full_price_projects = fullPrice;
    cfg.max_price_multiplier = maxMult;
    this.saveConfig(cfg);
    const ev = new stories.limits_event(args.contribution_cap, args.trial_limit, args.open_limit, args.archive_days, args.inactivity_days, fullPrice, maxMult);
    System.event("stories.limits_event", Protobuf.encode(ev, stories.limits_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  set_min_contribution(args: stories.set_min_contribution_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    System.require(
      args.min_contribution >= 1 && args.min_contribution <= MIN_CONTRIBUTION_MAX,
      "STORIES: minimum text length must be 1 to 200"
    );
    const cfg = this.config.get()!;
    cfg.min_contribution = args.min_contribution;
    this.saveConfig(cfg);
    const ev = new stories.min_contribution_event(args.min_contribution);
    System.event("stories.min_contribution_event", Protobuf.encode(ev, stories.min_contribution_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  add_category(args: stories.add_category_arguments): stories.uint32 {
    this.enter();
    this.requireAdmin();
    const name = this.text(args.name);
    this.requireTextIn(name, MAX_CATEGORY_NAME, "STORIES: category name must be 1 to 32 characters");
    const cfg = this.config.get()!;
    const id: u32 = cfg.next_category_id == 0 ? 1 : cfg.next_category_id;
    System.require(id <= MAX_CATEGORIES, "STORIES: too many categories");
    cfg.next_category_id = id + 1;
    this.saveConfig(cfg);
    this.categories.put(this.u32Key(id), new stories.category(name, true));
    const ev = new stories.category_event(id, name, true);
    System.event("stories.category_event", Protobuf.encode(ev, stories.category_event.encode), []);
    this.leave();
    return new stories.uint32(id);
  }

  set_category_active(args: stories.set_category_active_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const key = this.u32Key(args.category_id);
    const found = this.categories.get(key);
    System.require(found != null, "STORIES: unknown category");
    found!.active = args.active;
    this.categories.put(key, found!);
    const ev = new stories.category_event(args.category_id, found!.name, args.active);
    System.event("stories.category_event", Protobuf.encode(ev, stories.category_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  set_paused(args: stories.set_paused_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const cfg = this.config.get()!;
    cfg.paused = args.paused;
    this.saveConfig(cfg);
    const ev = new stories.paused_event(args.paused);
    System.event("stories.paused_event", Protobuf.encode(ev, stories.paused_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  set_moderation(args: stories.set_moderation_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const mod = args.moderator;
    const off = mod == null || mod.length == 0;
    if (!off) {
      this.requireAddress(mod, "STORIES: invalid moderator address");
      System.require(!Arrays.equal(mod!, this.contractId), "STORIES: the moderator cannot be the Stories contract");
    }
    System.require(args.report_threshold >= 1 && args.report_threshold <= REPORT_THRESHOLD_MAX, "STORIES: report threshold must be 1 to 20");
    System.require(args.strike_limit >= 1 && args.strike_limit <= STRIKE_LIMIT_MAX, "STORIES: strike limit must be 1 to 20");
    const cfg = this.config.get()!;
    cfg.moderator = off ? new Uint8Array(0) : mod;
    cfg.report_threshold = args.report_threshold;
    cfg.strike_limit = args.strike_limit;
    this.saveConfig(cfg);
    const ev = new stories.moderation_settings_event(cfg.moderator, args.report_threshold, args.strike_limit);
    System.event("stories.moderation_settings_event", Protobuf.encode(ev, stories.moderation_settings_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  set_blocked(args: stories.set_blocked_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const account = this.requireAddress(args.account, "STORIES: invalid wallet address");
    const note = this.requireNote(args.note);
    const status = this.accountStatus.get(account)!;
    System.require(status.blocked != args.blocked, args.blocked ? "STORIES: wallet is already blocked" : "STORIES: wallet is not blocked");
    status.blocked = args.blocked;
    this.accountStatus.put(account, status);
    const ev = new stories.account_blocked_event(account, args.blocked, status.strikes, this.getAdmin(), note);
    System.event("stories.account_blocked_event", Protobuf.encode(ev, stories.account_blocked_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  set_terms(args: stories.set_terms_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const cfg = this.config.get()!;
    System.require(args.version > cfg.terms_version, "STORIES: a new Terms of Use version must be higher than the current one");
    const hash = args.terms_hash;
    System.require(hash != null && hash.length == TERMS_HASH_LENGTH, "STORIES: Terms of Use hash must be 32 bytes");
    const uri = this.text(args.terms_uri);
    System.require(uri.length >= 1 && uri.length <= MAX_TERMS_URI && this.isPlainAscii(uri), "STORIES: Terms of Use link must be 1 to 200 plain characters");
    cfg.terms_version = args.version;
    cfg.terms_hash = hash;
    cfg.terms_uri = uri;
    this.saveConfig(cfg);
    const ev = new stories.terms_event(args.version, hash, uri);
    System.event("stories.terms_event", Protobuf.encode(ev, stories.terms_event.encode), []);
    this.leave();
    return new stories.empty_object();
  }

  // Step 1 of 2 (AB-016): propose. Admin moves only when the proposed
  // address accepts, so a typo cannot strand it.
  set_admin(args: stories.set_admin_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const proposed = this.requireAddress(args.new_admin, "STORIES: invalid admin address");
    const admin = this.getAdmin();
    const cfg = this.config.get()!;
    // Proposing the current admin cancels a pending handover.
    cfg.pending_admin = Arrays.equal(proposed, admin) ? null : proposed;
    this.config.put(cfg);
    const ev = new stories.admin_proposed_event(admin, cfg.pending_admin);
    System.event("stories.admin_proposed_event", Protobuf.encode(ev, stories.admin_proposed_event.encode), [proposed]);
    this.leave();
    return new stories.empty_object();
  }

  // Step 2 of 2: the proposed admin signs to take over.
  accept_admin(args: stories.accept_admin_arguments): stories.empty_object {
    this.enter();
    const cfg = this.config.get()!;
    const pending = cfg.pending_admin;
    System.require(pending != null && pending.length == ADDRESS_LENGTH, "STORIES: no admin handover is pending");
    this.requireSigner(pending!, "STORIES: only the proposed admin can accept");
    const oldAdmin = this.getAdmin();
    cfg.admin = pending;
    cfg.pending_admin = null;
    this.config.put(cfg);
    const ev = new stories.admin_changed_event(oldAdmin, pending);
    System.event("stories.admin_changed_event", Protobuf.encode(ev, stories.admin_changed_event.encode), [pending!]);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Writing helpers
  // ===================================================================

  // Append a new segment, update the story, then burn the Ink.
  private writeSegment(
    storyId: u64, st: stories.story, author: Uint8Array, text: string, cost: u64,
    startsChapter: bool, aiAssisted: bool, trial: bool, ink: Uint8Array, termsVersion: u32, insertAfter: u64, fromFund: bool,
    citation: string
  ): u64 {
    const now = this.now();
    const seq = st.segment_count + 1;
    const chapter = startsChapter || seq == 1;
    const hash = this.sha256(StringBytes.stringToBytes(text));
    // The same exact text cannot go into one story twice.
    const dupKey = this.join(this.u64Key(storyId), hash);
    System.require(!this.textHashes.get(dupKey)!.value, "STORIES: this exact text is already in this story");
    this.textHashes.put(dupKey, new stories.boole(true));
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
    this.segments.put(this.pairKey(storyId, seq), seg);

    st.segment_count = seq;
    st.used_chars = SafeMath.add(st.used_chars, cost);
    // Fund Ink was already burned when it was deposited.
    if (!fromFund) st.total_burned = SafeMath.add(st.total_burned, cost);
    if (chapter) st.chapter_count = st.chapter_count + 1;
    st.last_activity_at = now;
    if (Arrays.equal(author, st.opener!)) st.opener_last_active = now;

    const totalKey = this.idAddrKey(storyId, author);
    const total = this.contributorTotals.get(totalKey);
    if (total == null) {
      st.contributor_count = st.contributor_count + 1;
      this.contributorTotals.put(totalKey, new stories.uint64(cost));
    } else {
      total.value = SafeMath.add(total.value, cost);
      this.contributorTotals.put(totalKey, total);
    }
    const count = this.authorCount.get(author)!;
    this.authorList.put(this.addrIdxKey(author, count.value), new stories.segment_ref(storyId, seq));
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
  private checkWriter(storyId: u64, st: stories.story, author: Uint8Array, units: u64, cfg: stories.config): bool {
    const privileged = this.isPrivileged(storyId, st, author);
    const inviteOnly = st.visibility != stories.visibility.VISIBILITY_PUBLIC;
    if (inviteOnly) {
      System.require(
        privileged || this.allowed.get(this.idAddrKey(storyId, author))!.value,
        st.visibility == stories.visibility.VISIBILITY_PRIVATE ? "STORIES: this story is private" : "STORIES: only invited writers can write in this story"
      );
      // Everyone but the opener needs a Writer month here (no promo trial).
      if (!Arrays.equal(author, st.opener!)) {
        System.require(this.isActiveWriter(author), "STORIES: an active Writer month is required to write in invite-only stories");
      }
      return false;
    }
    if (privileged || this.isActiveWriter(author)) return false;
    System.require(this.promoClaimed(author), "STORIES: an active Writer membership is required");
    if (units > 0) {
      const used = this.trialUsed.get(author)!;
      System.require(SafeMath.add(used.value, units) <= <u64>cfg.trial_limit, "STORIES: trial writing limit reached");
      used.value = used.value + units;
      this.trialUsed.put(author, used);
    }
    return true;
  }

  private maybeAutoLock(storyId: u64, st: stories.story, by: Uint8Array): void {
    if (st.status == stories.story_status.STATUS_OPEN && st.used_chars >= st.max_chars) {
      st.status = stories.story_status.STATUS_LOCKED;
      st.locked_at = this.now();
      this.emitStatus(storyId, st.status, "auto-lock", by);
    }
  }

  // Record a refund on the story and the author's live total. A refund
  // can never take a story past the Ink it actually burned.
  private applyRefund(storyId: u64, st: stories.story, author: Uint8Array, refund: u64): void {
    if (refund == 0) return;
    st.total_refunded = SafeMath.add(st.total_refunded, refund);
    System.require(st.total_refunded <= st.total_burned, "STORIES: refund would exceed the Ink burned for this story");
    const key = this.idAddrKey(storyId, author);
    const total = this.contributorTotals.get(key)!;
    total.value = SafeMath.sub(total.value, refund);
    this.contributorTotals.put(key, total);
  }

  private refundInk(ink: Uint8Array, author: Uint8Array, amount: u64, storyId: u64, seq: u64): void {
    const mint = new stories.ink_mint_call(author, amount, MINT_REFUND, "r:" + storyId.toString() + ":" + seq.toString());
    this.callOut(ink, INK_MINT_ENTRY, Protobuf.encode(mint, stories.ink_mint_call.encode), [author], "STORIES: Ink refund failed");
  }

  // Remembers that `by` changed someone else's part, even only by cutting
  // words, so the admin can strike them on a takedown (AB-028). One entry
  // per part and wallet: nothing grows and nothing is looped over. The
  // writer can always be struck, so their own changes are not recorded.
  private recordChanger(key: Uint8Array, seg: stories.segment, by: Uint8Array): void {
    if (Arrays.equal(by, seg.author!)) return;
    this.partEditors.put(this.join(key, by), new stories.boole(true));
    seg.edited_by_others = true;
  }

  // Removing a part refunds it unless the admin or the moderator hid it.
  // Writer reports alone never cost the writer their Ink (AB-012).
  private refundable(seg: stories.segment): bool {
    return !seg.hidden || seg.hidden_by_reports;
  }

  private clearSegment(seg: stories.segment, by: Uint8Array, now: u64): void {
    seg.text = "";
    seg.citation = "";
    seg.source_note = "";
    seg.charged = 0;
    seg.current_cost = 0;
    seg.surviving = 0;
    seg.status = stories.segment_status.SEGMENT_REMOVED;
    seg.last_edited_by = by;
    seg.last_edited_at = now;
  }

  // Free growth for a light edit: 10% of the original, or up to 20 for
  // short text, but never more than doubling. Fixed per segment and
  // measured from what is still paid for, so it cannot stack.
  private allowance(original: u64): u64 {
    const tenth = original / 10;
    const small = original < 20 ? original : 20;
    return tenth > small ? tenth : small;
  }

  // Segments removed before the lock are folded into the final hash
  // automatically, so the finalizer only submits live text.
  private skipRemoved(storyId: u64, st: stories.story): void {
    while (st.final_cursor < st.segment_count && this.skipBudget > 0) {
      const next = st.final_cursor + 1;
      const key = this.pairKey(storyId, next);
      const seg = this.segments.get(key)!;
      if (seg.status != stories.segment_status.SEGMENT_REMOVED) return;
      this.skipBudget = this.skipBudget - 1;
      if (seg.final_mode == stories.final_mode.FINAL_PENDING) {
        seg.final_mode = stories.final_mode.FINAL_REMOVED;
        this.segments.put(key, seg);
      }
      st.running_hash = this.foldHash(st.running_hash, next, <u8>stories.final_mode.FINAL_REMOVED, new Uint8Array(32));
      st.final_cursor = next;
    }
  }

  private addSurviving(storyId: u64, author: Uint8Array, amount: u64): void {
    const key = this.idAddrKey(storyId, author);
    const total = this.survivingTotals.get(key)!;
    total.value = SafeMath.add(total.value, amount);
    this.survivingTotals.put(key, total);
  }

  private foldHash(prev: Uint8Array | null, seq: u64, mode: u8, textHash: Uint8Array): Uint8Array {
    const p = prev != null ? prev! : new Uint8Array(0);
    const buf = new Uint8Array(p.length + 8 + 1 + textHash.length);
    memory.copy(buf.dataStart, p.dataStart, p.length);
    const seqBytes = this.u64Key(seq);
    memory.copy(buf.dataStart + p.length, seqBytes.dataStart, 8);
    buf[p.length + 8] = mode;
    memory.copy(buf.dataStart + p.length + 9, textHash.dataStart, textHash.length);
    return this.sha256(buf);
  }

  private closeReady(st: stories.story): bool {
    const min = st.kind == stories.story_kind.KIND_BOOK ? BOOK_MIN : SHORT_MIN;
    return st.used_chars >= min || SafeMath.add(st.used_chars, CLOSE_SLACK) >= st.max_chars;
  }

  private minContribution(cfg: stories.config): u64 {
    return cfg.min_contribution == 0 ? <u64>DEFAULT_MIN_CONTRIBUTION : <u64>cfg.min_contribution;
  }

  private decrementOpen(opener: Uint8Array): void {
    const open = this.openCount.get(opener)!;
    if (open.value > 0) open.value = open.value - 1;
    this.openCount.put(opener, open);
  }

  // ===================================================================
  // Story fund helpers
  // ===================================================================

  // 1 for the first few open projects, then 2, 4, 8... up to the ceiling.
  private openMultiplier(openNow: u32, cfg: stories.config): u32 {
    const full = cfg.full_price_projects == 0 ? DEFAULT_FULL_PRICE_PROJECTS : cfg.full_price_projects;
    if (openNow < full) return 1;
    const ceiling = cfg.max_price_multiplier == 0 ? DEFAULT_MAX_PRICE_MULTIPLIER : cfg.max_price_multiplier;
    const steps = openNow - full + 1;
    const doubled: u32 = steps >= 10 ? MAX_PRICE_MULTIPLIER : (<u32>1) << steps;
    return doubled < ceiling ? doubled : ceiling;
  }

  // Burn the opener's Ink into the story's fund.
  private depositFund(storyId: u64, st: stories.story, opener: Uint8Array, amount: u64, ink: Uint8Array): void {
    st.fund = SafeMath.add(st.fund, amount);
    st.fund_added = SafeMath.add(st.fund_added, amount);
    st.total_burned = SafeMath.add(st.total_burned, amount);
    this.putStory(storyId, st);
    const ev = new stories.fund_event(storyId, opener, "deposit", amount, st.fund);
    System.event("stories.fund_event", Protobuf.encode(ev, stories.fund_event.encode), [opener]);
    const burn = new stories.ink_burn_call(opener, amount, BURN_CONTRIBUTION, "fund:" + storyId.toString());
    this.callOut(ink, INK_BURN_ENTRY, Protobuf.encode(burn, stories.ink_burn_call.encode), [opener], "STORIES: Ink burn failed");
  }

  // A refund for a part: back to the fund if the fund paid for it (no mint),
  // otherwise to the writer (returns true: mint it after saving).
  private settleRefund(storyId: u64, st: stories.story, seg: stories.segment, refund: u64): bool {
    if (refund == 0) return false;
    if (seg.fund_paid) {
      const key = this.idAddrKey(storyId, seg.author!);
      const total = this.contributorTotals.get(key)!;
      total.value = SafeMath.sub(total.value, refund);
      this.contributorTotals.put(key, total);
      st.fund = SafeMath.add(st.fund, refund);
      return false;
    }
    this.applyRefund(storyId, st, seg.author!, refund);
    return true;
  }

  // Empty the fund for its return to the opener (call before saving the story).
  private takeFundBack(storyId: u64, st: stories.story): u64 {
    const back = st.fund;
    if (back == 0) return 0;
    st.fund = 0;
    st.total_refunded = SafeMath.add(st.total_refunded, back);
    System.require(st.total_refunded <= st.total_burned, "STORIES: refund would exceed the Ink burned for this story");
    return back;
  }

  private returnFund(storyId: u64, st: stories.story, back: u64): void {
    const ink = this.requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
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
  private requireRightsAndTerms(account: Uint8Array, rights: bool, version: u32, cfg: stories.config): void {
    System.require(rights, "STORIES: confirm that you wrote this text or have the right to use it");
    System.require(version == cfg.terms_version, "STORIES: the Terms of Use have changed; reload the page and accept the current version");
    const accepted = this.termsAccepted.get(account)!;
    if (accepted.value == version) return;
    accepted.value = version;
    this.termsAccepted.put(account, accepted);
    const ev = new stories.terms_accepted_event(account, version);
    System.event("stories.terms_accepted_event", Protobuf.encode(ev, stories.terms_accepted_event.encode), [account]);
  }

  private requireNotBlocked(account: Uint8Array): void {
    System.require(!this.accountStatus.get(account)!.blocked, "STORIES: this wallet can no longer write on SwarmTales (repeated takedowns)");
  }

  // Repeat-infringer policy: every takedown is a strike; at the limit the
  // wallet is blocked automatically.
  private addStrike(author: Uint8Array, by: Uint8Array): void {
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

  private requireModeratorOrAdmin(actor: Uint8Array): void {
    if (Arrays.equal(actor, this.getAdmin())) {
      this.requireAdmin();
      return;
    }
    const mod = this.config.get()!.moderator;
    System.require(mod != null && mod.length == ADDRESS_LENGTH && Arrays.equal(actor, mod!), "STORIES: only the admin or the moderator may do this");
    this.requireSigner(actor, "STORIES: moderator has not authorized this");
  }

  private requireCitation(value: string | null): string {
    const citation = this.text(value);
    System.require(citation.length <= MAX_NOTE, "STORIES: a citation must be at most 200 characters");
    if (citation.length > 0) this.requireText(citation, false);
    return citation;
  }

  private requireNote(value: string | null): string {
    const note = this.text(value);
    System.require(note.length <= MAX_NOTE, "STORIES: note must be at most 200 characters");
    if (note.length > 0) this.requireText(note, false);
    return note;
  }

  private reportThreshold(cfg: stories.config): u32 {
    return cfg.report_threshold == 0 ? DEFAULT_REPORT_THRESHOLD : cfg.report_threshold;
  }

  private unhideCount(st: stories.story): void {
    if (st.hidden_count > 0) st.hidden_count = st.hidden_count - 1;
  }

  private reportKey(storyId: u64, seq: u64, account: Uint8Array): Uint8Array {
    return this.join(this.pairKey(storyId, seq), account);
  }

  private emitModeration(storyId: u64, seq: u64, action: stories.moderation_action, reason: stories.moderation_reason,
    by: Uint8Array, seg: stories.segment, note: string): void {
    const ev = new stories.moderation_event(storyId, seq, action, reason, by, seg.author, note,
      seg.text_hash != null ? seg.text_hash! : new Uint8Array(0));
    System.event("stories.moderation_event", Protobuf.encode(ev, stories.moderation_event.encode), [seg.author!]);
  }

  // ===================================================================
  // Shop reads
  // ===================================================================

  private isActiveWriter(account: Uint8Array): bool {
    const shopId = this.requireAddress(this.config.get()!.shop, "STORIES: Shop contract is not set");
    const call = new stories.shop_account_call(account);
    const raw = this.readCall(shopId, SHOP_MEMBERSHIP_ENTRY, Protobuf.encode(call, stories.shop_account_call.encode), "STORIES: could not read membership");
    if (raw.length == 0) return false;
    const m = Protobuf.decode<stories.shop_membership>(raw, stories.shop_membership.decode);
    return m.tier == SHOP_TIER_WRITER && m.paid_until > this.now();
  }

  private promoClaimed(account: Uint8Array): bool {
    const shopId = this.requireAddress(this.config.get()!.shop, "STORIES: Shop contract is not set");
    const call = new stories.shop_account_call(account);
    const raw = this.readCall(shopId, SHOP_PROMO_ENTRY, Protobuf.encode(call, stories.shop_account_call.encode), "STORIES: could not read promo status");
    if (raw.length == 0) return false;
    return Protobuf.decode<stories.uint64>(raw, stories.uint64.decode).value != 0;
  }

  // ===================================================================
  // Calls out
  // ===================================================================

  // Field 1, wire type 0, value 0: the protobuf encoding of `bool value = false`.
  private resultIsFalse(raw: Uint8Array): bool {
    return raw.length >= 2 && raw[0] == 8 && raw[1] == 0;
  }

  // Every write to Ink or Shop must exit with code 0 AND must not answer
  // "false". The exact bytes sent are published in an event.
  private callOut(contractId: Uint8Array, entryPoint: u32, payload: Uint8Array, impacted: Uint8Array[], message: string): void {
    const res = System.call(contractId, entryPoint, payload);
    System.require(res.code == 0, message);
    const raw = res.res.object;
    if (raw != null && this.resultIsFalse(raw!)) System.require(false, message);
    const ev = new stories.external_call_event(contractId, entryPoint, payload);
    System.event("stories.external_call_event", Protobuf.encode(ev, stories.external_call_event.encode), impacted);
  }

  private readCall(contractId: Uint8Array, entryPoint: u32, payload: Uint8Array, message: string): Uint8Array {
    const res = System.call(contractId, entryPoint, payload);
    System.require(res.code == 0, message);
    const raw = res.res.object;
    return raw != null ? raw! : new Uint8Array(0);
  }

  // ===================================================================
  // Text rules
  // ===================================================================

  // Returns the Ink cost (UTF-16 code units) or stops with the reason.
  private requireText(text: string, allowNewline: bool): i32 {
    const n = text.length;
    System.require(n > 0, "STORIES: text is empty");
    let visible = false;
    let run = 0;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c == 0x0a) {
        System.require(allowNewline, "STORIES: line breaks are not allowed here");
        run++;
        System.require(run <= MAX_NEWLINE_RUN, "STORIES: too many line breaks in a row (max 3)");
        continue;
      }
      run = 0;
      System.require(c >= 0x20 && !(c >= 0x7f && c <= 0x9f), "STORIES: control characters are not allowed");
      if (c >= 0xd800 && c <= 0xdbff) {
        System.require(i + 1 < n, "STORIES: broken character in text");
        const d = text.charCodeAt(i + 1);
        System.require(d >= 0xdc00 && d <= 0xdfff, "STORIES: broken character in text");
        i++;
        visible = true;
        continue;
      }
      System.require(!(c >= 0xdc00 && c <= 0xdfff) && c != 0xfffd, "STORIES: broken character in text");
      System.require(
        !(c == 0x200b || c == 0xfeff || c == 0x2028 || c == 0x2029 ||
          (c >= 0x2060 && c <= 0x2064) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)),
        "STORIES: invisible or direction-control characters are not allowed"
      );
      if (!(c == 0x20 || c == 0xa0 || c == 0x3000 || (c >= 0x2000 && c <= 0x200a) ||
            c == 0x200c || c == 0x200d || c == 0xfe0e || c == 0xfe0f)) {
        visible = true;
      }
    }
    System.require(visible, "STORIES: text has no visible characters");
    return n;
  }

  private requireTextIn(text: string, max: i32, message: string): void {
    System.require(text.length >= 1 && text.length <= max, message);
    this.requireText(text, false);
  }

  private requireTitle(value: string | null): string {
    const title = this.text(value);
    this.requireTextIn(title, MAX_TITLE, "STORIES: title must be 1 to 100 characters");
    return title;
  }

  private isPlainAscii(value: string): bool {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 0x21 || c > 0x7e) return false;
    }
    return true;
  }

  private requireCategories(c1: u32, c2: u32): void {
    System.require(this.isActiveCategory(c1), "STORIES: pick an active category");
    if (c2 != 0) {
      System.require(c2 != c1, "STORIES: the two categories must be different");
      System.require(this.isActiveCategory(c2), "STORIES: second category is not active");
    }
  }

  private isActiveCategory(id: u32): bool {
    if (id == 0) return false;
    const found = this.categories.get(this.u32Key(id));
    return found != null && found!.active;
  }

  private requireVisibility(v: stories.visibility): void {
    System.require(
      v == stories.visibility.VISIBILITY_PUBLIC || v == stories.visibility.VISIBILITY_UNLISTED || v == stories.visibility.VISIBILITY_PRIVATE,
      "STORIES: visibility must be Public, Unlisted or Private"
    );
  }

  // ===================================================================
  // Access helpers
  // ===================================================================

  private requireStory(storyId: u64): stories.story {
    const found = this.stories.get(this.u64Key(storyId));
    System.require(found != null, "STORIES: unknown story");
    return found!;
  }

  private putStory(storyId: u64, st: stories.story): void {
    this.stories.put(this.u64Key(storyId), st);
  }

  private requireActiveSegment(key: Uint8Array): stories.segment {
    const seg = this.segments.get(key);
    System.require(seg != null, "STORIES: unknown segment");
    System.require(seg!.status == stories.segment_status.SEGMENT_ACTIVE, "STORIES: segment was already removed");
    return seg!;
  }

  private requireOpener(st: stories.story, account: Uint8Array): void {
    System.require(Arrays.equal(account, st.opener!), "STORIES: only the opener may do this");
  }

  private isPrivileged(storyId: u64, st: stories.story, account: Uint8Array): bool {
    if (Arrays.equal(account, st.opener!)) return true;
    return this.editors.get(this.idAddrKey(storyId, account))!.value;
  }

  private requireJoinable(st: stories.story): void {
    System.require(
      st.status != stories.story_status.STATUS_FINALIZED && st.status != stories.story_status.STATUS_ARCHIVED,
      "STORIES: story is not accepting new writers"
    );
  }

  // The finalizer is either the opener (after close_story) or whoever is
  // admin at the time of the call (after admin_take_over), so handing
  // admin to a new wallet does not strand a book mid-edit.
  private requireFinalizer(st: stories.story, finalizer: Uint8Array): void {
    if (st.finalizer_is_admin) {
      System.require(Arrays.equal(finalizer, this.getAdmin()), "STORIES: only the admin may finalize this story");
      this.requireAdmin();
    } else {
      System.require(Arrays.equal(finalizer, st.opener!), "STORIES: only the opener may finalize this story");
      this.requireSigner(finalizer, "STORIES: finalizer has not authorized this");
    }
  }

  // Until set_admin is called, the contract's own address is the admin.
  // checkAuthority still requires a signature from that address.
  private getAdmin(): Uint8Array {
    const stored = this.config.get()!.admin;
    if (stored != null && stored.length > 0) return stored;
    return this.contractId;
  }

  private requireAdmin(): void {
    System.require(
      System.checkAuthority(authority.authorization_type.contract_call, this.getAdmin()),
      "STORIES: admin authority required"
    );
  }

  private requireSigner(account: Uint8Array, message: string): void {
    System.require(System.checkAuthority(authority.authorization_type.contract_call, account), message);
  }

  private requireNotPaused(): void {
    System.require(!this.config.get()!.paused, "STORIES: stories are paused");
  }

  private saveConfig(cfg: stories.config): void {
    if (cfg.admin == null || cfg.admin!.length == 0) cfg.admin = this.contractId;
    this.config.put(cfg);
  }

  // Held across the whole call, so a token, Shop, Ink or authority
  // contract cannot call back into Stories mid-transaction.
  private enter(): void {
    // Fix H1: Stories is only ever called directly by a transaction. A
    // call that arrives from another contract is some other app acting in
    // a user's (or the admin's) name, and is refused before anything else.
    const caller = System.getCaller().caller;
    System.require(
      caller == null || caller.length == 0,
      "STORIES: call SwarmTales directly from your wallet, not through another contract"
    );
    this.skipBudget = MAX_SKIP_PER_CALL;
    const flag = this.lock.get()!;
    System.require(!flag.value, "STORIES: reentrant call");
    flag.value = true;
    this.lock.put(flag);
  }

  private leave(): void {
    const flag = this.lock.get()!;
    flag.value = false;
    this.lock.put(flag);
  }

  private emitStatus(storyId: u64, status: stories.story_status, why: string, by: Uint8Array): void {
    const ev = new stories.status_event(storyId, status, why, by);
    System.event("stories.status_event", Protobuf.encode(ev, stories.status_event.encode), []);
  }

  private emitChange(storyId: u64, seq: u64, by: Uint8Array, oldCost: u64, newCost: u64, refund: u64, removed: bool, finalPass: bool, author: Uint8Array): void {
    const ev = new stories.segment_changed_event(storyId, seq, by, oldCost, newCost, refund, removed, finalPass);
    System.event("stories.segment_changed_event", Protobuf.encode(ev, stories.segment_changed_event.encode), [author]);
  }

  // ===================================================================
  // Small helpers
  // ===================================================================

  private now(): u64 {
    // head_block_time is in milliseconds.
    return System.getHeadInfo().head_block_time / 1000;
  }

  private text(value: string | null): string {
    return value != null ? value! : "";
  }

  private isAddress(account: Uint8Array | null): bool {
    return account != null && account.length == ADDRESS_LENGTH;
  }

  private requireAddress(account: Uint8Array | null, message: string): Uint8Array {
    System.require(account != null && account.length == ADDRESS_LENGTH, message);
    return account!;
  }

  private listLimit(limit: u32): u32 {
    return limit == 0 || limit > MAX_LIST ? MAX_LIST : limit;
  }

  private appendOpener(opener: Uint8Array, storyId: u64): void {
    const count = this.openerCount.get(opener)!;
    this.openerList.put(this.addrIdxKey(opener, count.value), new stories.uint64(storyId));
    count.value = count.value + 1;
    this.openerCount.put(opener, count);
  }

  // Each story enters a category list once, however often it is re-tagged.
  private addToCategory(categoryId: u32, storyId: u64): void {
    const memberKey = this.u32IdKey(categoryId, storyId);
    if (this.categoryMember.get(memberKey)!.value) return;
    this.categoryMember.put(memberKey, new stories.boole(true));
    const countKey = this.u32Key(categoryId);
    const count = this.categoryCount.get(countKey)!;
    this.categoryList.put(this.u32IdxKey(categoryId, count.value), new stories.uint64(storyId));
    count.value = count.value + 1;
    this.categoryCount.put(countKey, count);
  }

  private u64Key(value: u64): Uint8Array {
    const key = new Uint8Array(8);
    let v = value;
    for (let i = 7; i >= 0; i--) {
      key[i] = <u8>(v & 0xff);
      v = v >> 8;
    }
    return key;
  }

  private u32Key(value: u32): Uint8Array {
    const key = new Uint8Array(4);
    key[0] = <u8>(value >> 24);
    key[1] = <u8>(value >> 16);
    key[2] = <u8>(value >> 8);
    key[3] = <u8>value;
    return key;
  }

  private join(a: Uint8Array, b: Uint8Array): Uint8Array {
    const key = new Uint8Array(a.length + b.length);
    memory.copy(key.dataStart, a.dataStart, a.length);
    memory.copy(key.dataStart + a.length, b.dataStart, b.length);
    return key;
  }

  private pairKey(a: u64, b: u64): Uint8Array {
    return this.join(this.u64Key(a), this.u64Key(b));
  }

  private versionKey(storyId: u64, seq: u64, version: u32): Uint8Array {
    return this.join(this.pairKey(storyId, seq), this.u32Key(version));
  }

  private idAddrKey(storyId: u64, account: Uint8Array): Uint8Array {
    return this.join(this.u64Key(storyId), account);
  }

  private addrIdxKey(account: Uint8Array, index: u64): Uint8Array {
    return this.join(account, this.u64Key(index));
  }

  private u32IdxKey(categoryId: u32, index: u64): Uint8Array {
    return this.join(this.u32Key(categoryId), this.u64Key(index));
  }

  private u32IdKey(categoryId: u32, storyId: u64): Uint8Array {
    return this.join(this.u32Key(categoryId), this.u64Key(storyId));
  }

  // The 32-byte multihash digest an invite link key signs (fix H2).
  private inviteDigest(storyId: u64, inviteId: u64, account: Uint8Array): Uint8Array {
    const domain = StringBytes.stringToBytes(INVITE_DOMAIN);
    const msg = this.join(this.join(this.join(domain, this.contractId), this.pairKey(storyId, inviteId)), account);
    const digest = System.hash(Crypto.multicodec.sha2_256, msg);
    System.require(digest != null, "STORIES: could not hash");
    return digest!;
  }

  // The signature must recover to the invite's stored link key address.
  private requireLinkSignature(signer: Uint8Array, digest: Uint8Array, signature: Uint8Array | null, message: string): void {
    System.require(signature != null && signature.length == SIGNATURE_LENGTH, message);
    const pub = System.recoverPublicKey(signature!, digest);
    System.require(pub != null, message);
    System.require(Arrays.equal(Crypto.addressFromPublicKey(pub!), signer), message);
  }

  // System.hash returns a multihash (code, length, digest). Keep the raw
  // 32-byte sha256.
  private sha256(data: Uint8Array): Uint8Array {
    const wrapped = System.hash(Crypto.multicodec.sha2_256, data);
    System.require(wrapped != null, "STORIES: could not hash");
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
    System.require(size == 32 && i + 32 <= bytes.length, "STORIES: unexpected hash");
    return bytes.slice(i, i + 32);
  }
}
