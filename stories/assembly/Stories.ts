// =====================================================================
// SwarmTales Stories — smart contract (AssemblyScript, Koinos SDK)
//
// WHAT THIS CONTRACT DOES
//   - Holds every Book, Short Story and Poem: who wrote what, when, and for
//     how much Ink.
//   - Opening: Shop collects the open fee (99/1 split) and mints the
//     starter Ink, then Stories burns Ink for the opening text. One
//     transaction: if any part fails, nothing happens.
//   - Writing burns the writer's own Ink (Ink checks their signature).
//   - While a story is OPEN, a part's own writer may reword it for free
//     (letters beyond its current length cost the normal Ink rate) or
//     remove it. Anyone else who can write in the story changes it with
//     revise_part, which costs the changer Ink. Every change to a part's
//     text is kept as a version naming who made it. Refunds go to whoever
//     paid, through Ink mint, reason REFUND, the only mint reason Stories
//     is allowed. A cut refunds only Ink the writer (or the pool) paid for
//     the part and has not had back, never letters someone else paid for;
//     removing it refunds all of that.
//   - Closing (free), the final edit in ordered batches, surviving
//     characters, and finalize.
//   - The open-projects limit and price doubling, the promo trial, private
//     allow-lists with invite links, the archive and the admin-finalize rule.
//   - Pausing stops the inactivity clocks: time spent paused never counts
//     toward archiving a story or an admin take-over (audit M-1).
//
// MODERATION (added October 2026, for copied text and abuse)
//   - Every new part carries the writer's "I wrote this, or I have the
//     right to use it" confirmation and the Terms of Use version they
//     accepted. The contract refuses a part without both.
//   - The same exact text goes into one story once (audit F-03): a new part
//     may not repeat any text the story ever had, even edited away, removed
//     or taken down, and an edit or a paid change may not copy another part's
//     text. A part may go back to its own earlier wording.
//   - Any wallet may report a part of a story that is not finalized, once.
//     Reports from wallets that have written on SwarmTales count; enough of
//     them hide the part. Finished books are reported off-chain (audit M-3).
//   - The admin, or a narrow "moderator" key used by the automated copy
//     checker, may hide and unhide parts at any stage. Hidden parts stay
//     on the record but block finalizing until unhidden or removed. A part
//     the admin or moderator hid is not refunded when removed; one hidden
//     by writer reports alone is. The opener or an editor may restore a part
//     the checker or reports hid, never one the admin hid, and may remove
//     only a part reports hid (its writer keeps the refund, audit F-05);
//     only its writer removes a part the admin or the checker hid. A part restored
//     after a checker hide gives no Ink back when cut or removed, but one
//     the checker unhides itself does. Only the admin unhides the admin's
//     hide, and the admin may take over any other hide in place.
//   - A wallet the opener or an editor takes off a story's allow-list
//     cannot rejoin with an invite; only they can add it back. Until then it
//     can't edit its parts there either, only remove them (audit M-4).
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
//     from opening, writing, editing, joining, reviving and reporting (the
//     repeat-infringer policy). It may still remove its own parts.
//     The admin can also block or unblock by hand.
//   - Every report, hide, unhide, takedown and block is a public event.
//
// INVITE-ONLY STORIES AND STORY FUNDS (October 2026)
//   - Private stories are invite-only for writing: the opener, editors and
//     invited wallets. Everyone except the opener needs an active Writer
//     month there (no promo trial). A story can only switch to private
//     while its pool holds the minimum.
//   - The opener must set Ink aside in the story's fund (the writers'
//     pool) when opening: at least the kind's minimum length (10,000 for a
//     Short Story, 100,000 for a Book, 50 for a Poem). It can be topped up later. Parts are paid from the fund while it has enough; otherwise
//     the writer pays. The pool pays only for new parts, never for changes
//     to a part: the changer, or the writer adding letters, pays. Refunds
//     of fund-paid parts go back to the fund (after any Ink the writer
//     added themselves), and what is left returns to the opener when the
//     story is finalized or archived.
//   - Opening costs the normal price for the first few open projects
//     (default 3); each one beyond doubles it, until it reaches the
//     ceiling (default 4x), up to the open limit. A free revive is only
//     possible while the next project would be at the normal price
//     (audit S2-03). Separate wallets avoid the doubling; that is accepted.
//
// WHAT THIS CONTRACT DOES NOT DO
//   - It never moves stablecoins and holds no money.
//   - It does not hide text from the chain: a hidden part is left out of
//     the site and the book, but its text stays readable on-chain until it
//     is taken down. The only refund cap is per story: refunds never
//     exceed the Ink that story burned.
//   - The admin cannot move or burn Ink, refund outside the rules, or
//     finalize except under the admin rule. The Ink and Shop addresses are
//     set once and can never be changed (AB-037, AB-050). It edits text only as the
//     finalizer after admin_take_over, under the same light-edit limits
//     (recorded as a change to the part); otherwise it can only remove text
//     through a recorded takedown.
//   - The moderator can only hide parts, unhide any the admin didn't hide, add source notes and
//     clear a story's summary. It cannot remove a part's text, touch Ink,
//     or change any setting.
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

import { System, Protobuf, SafeMath, Arrays } from "@koinos/sdk-as";
import { stories } from "./proto/stories";
import { MAX_SUMMARY, MAX_NOTES, MAX_WANTED, MAX_PENDING_SUGGESTIONS, MAX_SUGGESTIONS, MAX_SUGGESTION_READ, SUGGESTION_WAITING, SUGGESTION_ACCEPTED, SUGGESTION_DECLINED, SUGGESTION_WITHDRAWN, SUGGESTION_CLEARED, VERSION_SUGGESTED, VERSION_CHANGED, VERSION_REMOVED, VERSION_EDITED, VERSION_FINAL, MIN_CHANGE_UNITS, MAX_PAID_CHANGES, MAX_VERSION_READ, MAX_VERSION_READ_BYTES, HIDDEN_BY_REPORTS, DAY_SECONDS, MAX_EDITORS, MAX_ACCOUNTS_PER_CALL, MAX_FREE_CHAPTERS, MAX_BATCH_ITEMS, MAX_BATCH_UNITS, MAX_SEGMENT_READ, MAX_SEGMENT_READ_BYTES, MAX_INVITE_USES, MAX_INVITE_DAYS, MAX_PDF_URI, MIN_PDF_HASH, MAX_PDF_HASH, INK_BURN_ENTRY, SHOP_OPEN_FEE_ENTRY, BURN_CONTRIBUTION } from "./lib/constants";
import { u64Key, u32Key, pairKey, versionKey, idAddrKey, addrIdxKey, u32IdxKey, reportKey, foldHash } from "./lib/keys";
import { str, utf8, isLowSurrogate, requireText, requireTitle, isPlainAscii, isAddress, requireAddress, requireCitation, requireNote } from "./lib/text";
import { allowance, closeReady, isKnownKind, kindMin, kindMax, minContribution, openMultiplier, listLimit, requireVisibility, requirePool, cutRefund, refundable, clearSegment, nowSeconds, requireSigner } from "./lib/rules";
import { StoriesAdmin } from "./StoriesAdmin";

// Story text, final batches and stored segments are larger than the
// SDK's default 1 KB system buffer. This runs once when the contract
// loads, before any entry point reads its arguments.
const SYSTEM_BUFFER_SIZE: u32 = 65536;
System.setSystemBufferSize(SYSTEM_BUFFER_SIZE);

// Reads, opening, writing, the final edit and the archive. Moderation and
// settings are in StoriesAdmin.ts, storage and shared helpers in
// StoriesBase.ts, and the fixed rules in lib/.
export class Stories extends StoriesAdmin {

  // ===================================================================
  // Reads
  // ===================================================================

  get_config(args: stories.get_config_arguments): stories.config {
    const cfg = this.config.get()!;
    cfg.admin = this.getAdmin();
    return cfg;
  }

  get_story(args: stories.get_story_arguments): stories.story {
    const found = this.stories.get(u64Key(args.story_id));
    return found != null ? found! : new stories.story();
  }

  get_segment(args: stories.get_segment_arguments): stories.segment {
    const found = this.segments.get(pairKey(args.story_id, args.seq));
    return found != null ? found! : new stories.segment();
  }

  get_segments(args: stories.get_segments_arguments): stories.segment_list {
    const out = new stories.segment_list();
    const found = this.stories.get(u64Key(args.story_id));
    if (found == null) return out;
    const limit = args.limit == 0 || args.limit > MAX_SEGMENT_READ ? MAX_SEGMENT_READ : args.limit;
    let seq = args.start == 0 ? 1 : args.start;
    let bytes: i32 = 0;
    for (let n: u32 = 0; n < limit && seq <= found!.segment_count; n++) {
      const seg = this.segments.get(pairKey(args.story_id, seq))!;
      const size = utf8(seg.text) + utf8(seg.citation) + utf8(seg.source_note);
      if (out.values.length > 0 && bytes + size > MAX_SEGMENT_READ_BYTES) break;
      bytes += size;
      out.values.push(seg);
      seq++;
    }
    out.next = seq <= found!.segment_count ? seq : 0;
    return out;
  }

  get_contributor_total(args: stories.get_contributor_total_arguments): stories.uint64 {
    if (!isAddress(args.account)) return new stories.uint64(0);
    const found = this.contributorTotals.get(idAddrKey(args.story_id, args.account!));
    return found != null ? found! : new stories.uint64(0);
  }

  get_surviving_total(args: stories.get_surviving_total_arguments): stories.uint64 {
    if (!isAddress(args.account)) return new stories.uint64(0);
    return this.survivingTotals.get(idAddrKey(args.story_id, args.account!))!;
  }

  is_editor(args: stories.is_editor_arguments): stories.boole {
    if (!isAddress(args.account)) return new stories.boole(false);
    return this.editors.get(idAddrKey(args.story_id, args.account!))!;
  }

  is_allowed(args: stories.is_allowed_arguments): stories.boole {
    if (!isAddress(args.account)) return new stories.boole(false);
    return this.allowed.get(idAddrKey(args.story_id, args.account!))!;
  }

  get_invite(args: stories.get_invite_arguments): stories.invite {
    const found = this.invites.get(pairKey(args.story_id, args.invite_id));
    return found != null ? found! : new stories.invite();
  }

  get_trial_used(args: stories.get_trial_used_arguments): stories.uint64 {
    if (!isAddress(args.account)) return new stories.uint64(0);
    return this.trialUsed.get(args.account!)!;
  }

  get_open_count(args: stories.get_open_count_arguments): stories.uint32 {
    if (!isAddress(args.account)) return new stories.uint32(0);
    return this.openCount.get(args.account!)!;
  }

  get_category(args: stories.get_category_arguments): stories.category {
    const found = this.categories.get(u32Key(args.category_id));
    return found != null ? found! : new stories.category();
  }

  get_opener_stories(args: stories.get_opener_stories_arguments): stories.id_list {
    const out = new stories.id_list();
    if (!isAddress(args.account)) return out;
    const total = this.openerCount.get(args.account!)!.value;
    const limit = listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      out.values.push(this.openerList.get(addrIdxKey(args.account!, i))!.value);
    }
    return out;
  }

  get_reading_place(args: stories.get_reading_place_arguments): stories.reading_place {
    if (!isAddress(args.reader)) return new stories.reading_place();
    const found = this.readingPlace.get(idAddrKey(args.story_id, args.reader!));
    return found != null ? found : new stories.reading_place(args.story_id);
  }

  get_reading_places(args: stories.get_reading_places_arguments): stories.reading_place_list {
    const out = new stories.reading_place_list();
    if (!isAddress(args.reader)) return out;
    const total = this.readingCount.get(args.reader!)!.value;
    out.total = total;
    const limit = listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      const storyId = this.readingList.get(addrIdxKey(args.reader!, i))!.value;
      const place = this.readingPlace.get(idAddrKey(storyId, args.reader!));
      if (place != null && place.seq > 0) out.values.push(place);
    }
    return out;
  }

  get_versions(args: stories.get_versions_arguments): stories.version_list {
    const out = new stories.version_list();
    const seg = this.segments.get(pairKey(args.story_id, args.seq));
    if (seg == null || seg.taken_down) return out;
    // A few at a time: each version can hold a whole part, and reading many
    // in one call runs past a node's read limit (AB-060). The page also stops
    // at a size budget, so long text in a three-byte script still reads; next
    // says where to go on (AB-070).
    const limit = args.count == 0 || args.count > MAX_VERSION_READ ? MAX_VERSION_READ : args.count;
    let v: u32 = args.from == 0 ? 1 : args.from;
    let bytes: i32 = 0;
    for (let n: u32 = 0; n < limit && v <= seg.version_count; n++) {
      const found = this.versions.get(versionKey(args.story_id, args.seq, v));
      if (found != null) {
        const size = utf8(found.text);
        if (out.values.length > 0 && bytes + size > MAX_VERSION_READ_BYTES) break;
        bytes += size;
        out.values.push(found);
      }
      v++;
    }
    out.next = v <= seg.version_count ? v : 0;
    return out;
  }

  get_changers(args: stories.get_changers_arguments): stories.address_list {
    return this.partChangers.get(pairKey(args.story_id, args.seq))!;
  }

  get_category_stories(args: stories.get_category_stories_arguments): stories.id_list {
    const out = new stories.id_list();
    const total = this.categoryCount.get(u32Key(args.category_id))!.value;
    const limit = listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      out.values.push(this.categoryList.get(u32IdxKey(args.category_id, i))!.value);
    }
    return out;
  }

  get_author_segments(args: stories.get_author_segments_arguments): stories.segment_ref_list {
    const out = new stories.segment_ref_list();
    if (!isAddress(args.account)) return out;
    const total = this.authorCount.get(args.account!)!.value;
    const limit = listLimit(args.limit);
    for (let i = args.start; i < total && <u32>(i - args.start) < limit; i++) {
      out.values.push(this.authorList.get(addrIdxKey(args.account!, i))!);
    }
    return out;
  }

  has_reported(args: stories.has_reported_arguments): stories.boole {
    if (!isAddress(args.account)) return new stories.boole(false);
    return this.reports.get(reportKey(args.story_id, args.seq, args.account!))!;
  }

  get_account_status(args: stories.get_account_status_arguments): stories.account_status {
    if (!isAddress(args.account)) return new stories.account_status(false, 0);
    return this.accountStatus.get(args.account!)!;
  }

  get_open_multiplier(args: stories.get_open_multiplier_arguments): stories.uint32 {
    if (!isAddress(args.account)) return new stories.uint32(1);
    return new stories.uint32(openMultiplier(this.openCount.get(args.account!)!.value, this.config.get()!));
  }

  get_terms_accepted(args: stories.get_terms_accepted_arguments): stories.uint32 {
    if (!isAddress(args.account)) return new stories.uint32(0);
    return this.termsAccepted.get(args.account!)!;
  }

  quote_cost(args: stories.quote_cost_arguments): stories.uint64 {
    return new stories.uint64(requireText(str(args.text), true));
  }

  // ===================================================================
  // Opening and settings
  // ===================================================================

  open_story(args: stories.open_story_arguments): stories.uint64 {
    this.enter();
    this.requireNotPaused();
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    this.requireNotBlocked(opener);
    const cfg = this.config.get()!;
    const ink = requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const shopId = requireAddress(cfg.shop, "STORIES: Shop contract is not set");
    const token = requireAddress(args.token, "STORIES: invalid token address");

    const kind = args.kind;
    System.require(isKnownKind(kind), "STORIES: kind must be Book, Short Story or Poem");
    const lo = kindMin(kind);
    const hi = kindMax(kind);
    // 0 = no fixed size: the story may grow to its kind's maximum, and the
    // opener can close it any time after it reaches the kind's minimum.
    if (args.max_chars == 0) args.max_chars = hi;
    System.require(args.max_chars >= lo && args.max_chars <= hi,
      kind == stories.story_kind.KIND_BOOK ? "STORIES: a Book must be 100,000 to 1,000,000 characters"
        : kind == stories.story_kind.KIND_POEM ? "STORIES: a Poem must be 50 to 25,000 characters"
          : "STORIES: a Short Story must be 10,000 to 99,999 characters");

    const title = requireTitle(args.title);
    this.requireCategories(args.category_1, args.category_2);
    requireVisibility(args.visibility);
    System.require(args.free_chapters <= MAX_FREE_CHAPTERS, "STORIES: free chapters must be 0 to 5");
    System.require(args.contributor_edition_min <= args.max_chars, "STORIES: Contributor Edition minimum is above the story size");

    const text = str(args.opening_text);
    const cost = <u64>requireText(text, true);
    System.require(cost == args.expected_ink, "STORIES: Ink cost does not match expected_ink");
    System.require(cost <= <u64>cfg.contribution_cap, "STORIES: text is over the per-submission cap");
    System.require(cost >= minContribution(cfg), "STORIES: opening text is shorter than the minimum");
    // A story is never born over its own size (audit L-2: a Poem's opening
    // could be up to the per-submission cap, far above its max_chars).
    System.require(cost <= args.max_chars, "STORIES: the opening text is longer than the story");
    this.requireRightsAndTerms(opener, args.rights_confirmed, args.terms_version, cfg);

    const open = this.openCount.get(opener)!;
    System.require(open.value < cfg.open_limit, "STORIES: you already have the maximum number of open projects");
    if (args.visibility == stories.visibility.VISIBILITY_PUBLIC) {
      System.require(args.fund == 0, "STORIES: only private stories have a fund");
    } else {
      // The writers' pool must at least cover a story long enough to close.
      requirePool(kind, args.fund);
    }
    const multiplier = openMultiplier(open.value, cfg);

    let storyId = cfg.next_story_id;
    if (storyId == 0) storyId = 1;
    cfg.next_story_id = SafeMath.add(storyId, 1);
    this.saveConfig(cfg);

    const now = nowSeconds();
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
    this.touch(st, opener, true);
    st.next_invite_id = 1;

    open.value = open.value + 1;
    this.openCount.put(opener, open);
    this.appendOpener(opener, storyId);
    this.addToCategory(args.category_1, storyId);
    if (args.category_2 != 0) this.addToCategory(args.category_2, storyId);

    const ev = new stories.story_opened_event(storyId, opener, kind, args.max_chars, token);
    System.event("stories.story_opened_event", Protobuf.encode(ev, stories.story_opened_event.encode), [opener]);

    // 1) Shop takes the fee and mints the starter Ink to the opener.
    const fee = new stories.shop_fee_call(opener, <u32>kind, token, multiplier, args.max_price, args.min_ink);
    this.callOut(shopId, SHOP_OPEN_FEE_ENTRY, Protobuf.encode(fee, stories.shop_fee_call.encode), [opener], "STORIES: open fee payment failed");

    // 2) The opening text is segment 1, paid in Ink like any other text.
    this.writeSegment(storyId, st, opener, text, cost, true, args.ai_assisted, false, ink, args.terms_version, 0, false, requireCitation(args.citation));
    // 3) Optional: Ink set aside for everyone's writing in this story.
    if (args.fund > 0) this.depositFund(storyId, st, opener, args.fund, ink);
    this.leave();
    return new stories.uint64(storyId);
  }

  update_story(args: stories.update_story_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    // The title is visible text too (AB-046).
    this.requireNotBlocked(opener);
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    st.title = requireTitle(args.title);
    this.requireCategories(args.category_1, args.category_2);
    requireVisibility(args.visibility);
    System.require(args.free_chapters <= MAX_FREE_CHAPTERS, "STORIES: free chapters must be 0 to 5");
    st.category_1 = args.category_1;
    st.category_2 = args.category_2;
    if (st.visibility == stories.visibility.VISIBILITY_PUBLIC && args.visibility != stories.visibility.VISIBILITY_PUBLIC) {
      // Invite-only stories pay their writers from the pool, so switching
      // from public needs the same pool as opening one (AB-011). A story
      // that is already invite-only keeps its pool as writers use it (AB-022).
      requirePool(st.kind, st.fund);
    }
    st.visibility = args.visibility;
    st.free_chapters = args.free_chapters;
    this.touch(st, opener, false);
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
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    // A blocked opener can't hand out editing powers either (AB-046).
    this.requireNotBlocked(opener);
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const account = requireAddress(args.account, "STORIES: invalid editor address");
    System.require(!Arrays.equal(account, opener), "STORIES: the opener is already in charge");
    const key = idAddrKey(args.story_id, account);
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
    this.touch(st, opener, false);
    this.putStory(args.story_id, st);
    const ev = new stories.editor_event(args.story_id, account, args.allowed);
    System.event("stories.editor_event", Protobuf.encode(ev, stories.editor_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  set_allowed(args: stories.set_allowed_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const actor = requireAddress(args.actor, "STORIES: invalid address");
    requireSigner(actor, "STORIES: caller has not authorized this");
    // Nor change who may write (AB-046).
    this.requireNotBlocked(actor);
    const st = this.requireStory(args.story_id);
    System.require(this.isPrivileged(args.story_id, st, actor), "STORIES: only the opener or an editor may change the allow-list");
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const list = args.accounts;
    System.require(list.length > 0 && list.length <= MAX_ACCOUNTS_PER_CALL, "STORIES: send 1 to 20 wallets per call");
    for (let i = 0; i < list.length; i++) {
      const account = requireAddress(list[i], "STORIES: invalid wallet address");
      const key = idAddrKey(args.story_id, account);
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
      this.touch(st, actor, false);
      this.putStory(args.story_id, st);
    }
    this.leave();
    return new stories.empty_object();
  }

  create_invite(args: stories.create_invite_arguments): stories.uint64 {
    this.enter();
    this.requireNotPaused();
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    // An invite adds wallets to the allow-list like set_allowed (AB-072).
    this.requireNotBlocked(opener);
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    this.requireJoinable(st);
    const linkSigner = requireAddress(args.link_signer, "STORIES: invite needs a link key address");
    System.require(args.max_uses >= 1 && args.max_uses <= MAX_INVITE_USES, "STORIES: invite uses must be 1 to 1000");
    const now = nowSeconds();
    System.require(args.expires_at > now, "STORIES: invite expiry must be in the future");
    System.require(args.expires_at <= now + MAX_INVITE_DAYS * DAY_SECONDS, "STORIES: invite expiry can be at most 365 days away");

    let inviteId = st.next_invite_id;
    if (inviteId == 0) inviteId = 1;
    st.next_invite_id = SafeMath.add(inviteId, 1);
    this.touch(st, opener, false);
    this.putStory(args.story_id, st);
    this.invites.put(pairKey(args.story_id, inviteId), new stories.invite(linkSigner, args.max_uses, 0, args.expires_at, false));
    const ev = new stories.invite_event(args.story_id, inviteId, args.max_uses, args.expires_at, false);
    System.event("stories.invite_event", Protobuf.encode(ev, stories.invite_event.encode), [opener]);
    this.leave();
    return new stories.uint64(inviteId);
  }

  revoke_invite(args: stories.revoke_invite_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    const key = pairKey(args.story_id, args.invite_id);
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
    const account = requireAddress(args.account, "STORIES: invalid wallet address");
    requireSigner(account, "STORIES: wallet has not authorized this");
    // A blocked wallet can't get itself onto an allow-list (audit F-09).
    this.requireNotBlocked(account);
    const st = this.requireStory(args.story_id);
    this.requireJoinable(st);
    // Invite links are the opener's: once the opener is blocked, the links
    // they made stop working too (AB-081). Editors can still add wallets.
    System.require(!this.accountStatus.get(st.opener!)!.blocked, "STORIES: this story's opener can no longer invite writers");
    const key = pairKey(args.story_id, args.invite_id);
    const inv = this.invites.get(key);
    System.require(inv != null, "STORIES: unknown invite");
    const row = inv!;
    System.require(!row.revoked, "STORIES: invite was revoked");
    System.require(nowSeconds() < row.expires_at, "STORIES: invite has expired");
    System.require(row.uses < row.max_uses, "STORIES: invite has no uses left");
    this.requireLinkSignature(
      requireAddress(row.link_signer, "STORIES: invite link rejected"),
      this.inviteDigest(args.story_id, args.invite_id, account),
      args.signature,
      "STORIES: invite link rejected"
    );
    const allowKey = idAddrKey(args.story_id, account);
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
    const author = requireAddress(args.author, "STORIES: invalid author address");
    requireSigner(author, "STORIES: author has not authorized this");
    this.requireNotBlocked(author);
    const cfg = this.config.get()!;
    const ink = requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: story is not open for writing");

    const text = str(args.text);
    const cost = <u64>requireText(text, true);
    System.require(cost == args.expected_ink, "STORIES: Ink cost does not match expected_ink");
    System.require(cost <= <u64>cfg.contribution_cap, "STORIES: text is over the per-submission cap");
    System.require(SafeMath.add(st.used_chars, cost) <= st.max_chars, "STORIES: not enough space left in this story");
    System.require(
      cost >= minContribution(cfg) || SafeMath.add(st.used_chars, cost) == st.max_chars,
      "STORIES: text is shorter than the minimum (only the piece that fills the story may be shorter)"
    );
    this.requireRightsAndTerms(author, args.rights_confirmed, args.terms_version, cfg);
    let insertAfter = args.insert_after;
    if (args.after_my_last) {
      // The next piece of a multi-part addition: right after this writer's
      // previous part in this story.
      const count = this.authorCount.get(author)!.value;
      System.require(count > 0, "STORIES: you have no earlier part in this story");
      const last = this.authorList.get(addrIdxKey(author, count - 1))!;
      System.require(last.story_id == args.story_id, "STORIES: you have no earlier part in this story");
      insertAfter = last.seq;
    }
    if (insertAfter != 0) {
      // Text added between parts: it is read right after the part it follows.
      System.require(insertAfter <= st.segment_count, "STORIES: unknown part to add text after");
      const target = this.segments.get(pairKey(args.story_id, insertAfter));
      System.require(target != null && target!.status == stories.segment_status.SEGMENT_ACTIVE,
        "STORIES: you can only add text after a part that is still in the story");
    }

    const inviteOnly = st.visibility != stories.visibility.VISIBILITY_PUBLIC;
    const trial = this.checkWriter(args.story_id, st, author, cost, cfg);

    // Paid from the story's fund when it has enough; otherwise by the writer.
    const fromFund = inviteOnly && st.fund >= cost;
    if (fromFund) st.fund = st.fund - cost;
    const seq = this.writeSegment(args.story_id, st, author, text, cost, args.starts_chapter, args.ai_assisted, trial, ink, args.terms_version, insertAfter, fromFund, requireCitation(args.citation));
    this.leave();
    return new stories.uint64(seq);
  }

  edit_segment(args: stories.edit_segment_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const editor = requireAddress(args.editor, "STORIES: invalid editor address");
    requireSigner(editor, "STORIES: editor has not authorized this");
    this.ownEdit(args.story_id, args.seq, editor, str(args.new_text), args.expected_cost, args.max_ink,
      args.rights_confirmed, args.terms_version, VERSION_EDITED, editor, "", false, null);
    this.leave();
    return new stories.empty_object();
  }

  // The part's writer changes its text: their own edit, or a suggestion they
  // accept (Wave 2). `kind` and `by` say what the kept version records.
  private ownEdit(storyId: u64, seq: u64, editor: Uint8Array, text: string, expectedCost: u64, maxInk: u64,
    rightsConfirmed: bool, termsVersion: u32, kind: u32, by: Uint8Array, citation: string, aiAssisted: bool,
    proposer: Uint8Array | null = null): u32 {
    this.requireNotBlocked(editor);
    const cfg = this.config.get()!;
    const ink = requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(storyId);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: text can only be edited while the story is open");
    const key = pairKey(storyId, seq);
    const seg = this.requireActiveSegment(key);
    // Only the part's own writer edits it here. Anyone else changes it with
    // revise_part, which costs Ink.
    System.require(Arrays.equal(editor, seg.author!), "STORIES: only the part's writer may edit it for free; others can change it for Ink");
    // The text is evidence while the admin or the checker looks at it (AB-036).
    System.require(!seg.hidden, "STORIES: a hidden part can't be edited while it is checked; you can remove it instead");
    // A writer taken off a private story's allow-list can't change its text
    // there any more; it can still remove its parts for a refund (audit M-4).
    this.requireMember(storyId, st, editor);
    // Rewritten text is new text: the same rights confirmation and current
    // Terms as a new part (audit F-04).
    this.requireRightsAndTerms(editor, rightsConfirmed, termsVersion, cfg);

    const newCost = <u64>requireText(text, true);
    System.require(newCost == expectedCost, "STORIES: Ink cost does not match expected_cost");
    const oldText = seg.text != null ? seg.text! : "";
    System.require(text != oldText, "STORIES: the text is unchanged");
    const oldCost = seg.current_cost;
    // The cap stops growth only, so a part written under a higher cap can
    // still be trimmed (audit S2-05).
    System.require(newCost <= <u64>cfg.contribution_cap || newCost <= oldCost, "STORIES: text is over the per-submission cap");
    const nextUsed = SafeMath.add(SafeMath.sub(st.used_chars, oldCost), newCost);

    // Rewording is free. Letters beyond the part's current length cost the
    // normal Ink rate, paid by the writer (the pool pays only for new parts).
    // Shortening (AB-040) refunds only Ink the writer or the pool paid
    // (AB-035, AB-044).
    const growth: u64 = newCost > oldCost ? newCost - oldCost : 0;
    // The page shows the price from the part as it was; if someone shortened
    // it since, the same text costs more, and the writer never agreed (AB-049).
    System.require(growth <= maxInk, "STORIES: this edit now costs more Ink than you agreed to; reload the part and try again");
    if (growth > 0) {
      System.require(nextUsed <= st.max_chars, "STORIES: not enough space left in this story");
      this.checkWriter(storyId, st, editor, growth, cfg);
    }
    const refund = cutRefund(seg, newCost);
    const now = nowSeconds();
    const version = this.keepVersion(storyId, seq, seg, oldText, kind, by, text, newCost, now, citation, aiAssisted);
    const mint = this.settleRefund(storyId, st, seg, refund);
    seg.charged = SafeMath.add(seg.charged - refund, growth);
    if (growth > 0) {
      if (seg.fund_paid) seg.own_paid = SafeMath.add(seg.own_paid, growth);
      const totalKey = idAddrKey(storyId, editor);
      const total = this.contributorTotals.get(totalKey)!;
      total.value = SafeMath.add(total.value, growth);
      this.contributorTotals.put(totalKey, total);
      st.total_burned = SafeMath.add(st.total_burned, growth);
    }
    seg.text = text;
    seg.text_hash = this.newTextHash(storyId, seq, text);
    seg.current_cost = newCost;
    seg.last_edited_by = editor;
    seg.last_edited_at = now;
    if (proposer != null) {
      // An accepted suggestion: its words came from someone else, so the
      // part counts as changed by them (strikes, AB-028), and their AI label
      // and citation carry over (AB-039).
      this.recordChanger(key, seg, proposer, false);
      if (aiAssisted) seg.ai_assisted = true;
      // Their citation names the source only where the part had none; it is
      // always kept with their version.
      if (citation.length > 0 && (seg.citation == null || seg.citation!.length == 0)) seg.citation = citation;
    }
    this.segments.put(key, seg);

    st.used_chars = nextUsed;
    this.touch(st, editor, true);
    this.maybeAutoLock(storyId, st, editor);
    this.putStory(storyId, st);

    this.emitChange(storyId, seq, editor, oldCost, newCost, refund, false, false, seg.author!);
    if (growth > 0) {
      const burn = new stories.ink_burn_call(editor, growth, BURN_CONTRIBUTION, "e:" + storyId.toString() + ":" + seq.toString());
      this.callOut(ink, INK_BURN_ENTRY, Protobuf.encode(burn, stories.ink_burn_call.encode), [editor], "STORIES: Ink burn failed");
    }
    if (mint > 0) this.refundInk(ink, seg.author!, mint, storyId, seq);
    return version;
  }

  remove_segment(args: stories.remove_segment_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const editor = requireAddress(args.editor, "STORIES: invalid editor address");
    requireSigner(editor, "STORIES: editor has not authorized this");
    const ink = requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: text can only be removed while the story is open");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    // The part's own writer removes it for free, even when blocked or taken
    // off the allow-list. The opener or an editor (not blocked) may remove a
    // part that writer reports hid; its writer keeps the refund. A part the
    // admin or the checker hid is still under review: only its writer may
    // withdraw it (audit F-05). Anyone else uses revise_part.
    const own = Arrays.equal(editor, seg.author!);
    System.require(own || (seg.hidden && seg.hidden_by == HIDDEN_BY_REPORTS && this.isPrivileged(args.story_id, st, editor)),
      "STORIES: only the part's writer may remove it for free; others can remove it for Ink");
    if (!own) this.requireNotBlocked(editor);

    // A part the admin or the copy checker hid is not refunded; one hidden
    // only by writer reports is (AB-012).
    const refund = refundable(seg) ? seg.charged : 0;
    // Without a refund the writer's total still loses the part, as in a
    // takedown, so they stop counting as a current writer (AB-057).
    if (refund == 0) this.dropTotal(args.story_id, seg.author!, seg.charged);
    const oldCost = seg.current_cost;
    const now = nowSeconds();
    this.removePart(args.story_id, args.seq, st, seg, editor, now);
    const mint = this.settleRefund(args.story_id, st, seg, refund);
    clearSegment(seg, editor, now);
    this.segments.put(key, seg);

    st.used_chars = SafeMath.sub(st.used_chars, oldCost);
    this.touch(st, editor, true);
    this.putStory(args.story_id, st);

    this.emitChange(args.story_id, args.seq, editor, oldCost, 0, refund, true, false, seg.author!);
    if (mint > 0) this.refundInk(ink, seg.author!, mint, args.story_id, args.seq);
    this.leave();
    return new stories.empty_object();
  }

  // ===================================================================
  // Closing and the final edit
  // ===================================================================

  close_story(args: stories.close_story_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    // Closing is free (October 2026): the open price already paid for the story.
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(
      st.status == stories.story_status.STATUS_LOCKED ||
        (st.status == stories.story_status.STATUS_OPEN && closeReady(st)),
      "STORIES: story cannot be closed yet"
    );
    const now = nowSeconds();
    st.status = stories.story_status.STATUS_EDITING;
    st.finalizer_is_admin = false;
    if (st.locked_at == 0) st.locked_at = now;
    this.touch(st, opener, false);
    this.putStory(args.story_id, st);
    this.emitStatus(args.story_id, st.status, "closed", opener);
    this.leave();
    return new stories.empty_object();
  }

  request_admin_finalize(args: stories.request_admin_finalize_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(
      st.status == stories.story_status.STATUS_OPEN ||
        st.status == stories.story_status.STATUS_LOCKED ||
        st.status == stories.story_status.STATUS_EDITING,
      "STORIES: story is not active"
    );
    st.admin_finalize_requested = args.requested;
    this.touch(st, opener, false);
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
    // Not while paused: openers can't act then, so nothing may be taken
    // from them (audit M-1).
    this.requireNotPaused();
    this.requireAdmin();
    const st = this.requireStory(args.story_id);
    const eligible =
      st.status == stories.story_status.STATUS_LOCKED ||
      (st.status == stories.story_status.STATUS_OPEN && closeReady(st)) ||
      (st.status == stories.story_status.STATUS_EDITING && !st.finalizer_is_admin);
    System.require(eligible, "STORIES: story is not ready for an admin finalize");
    const now = nowSeconds();
    // Inactivity is measured on the activity clock, which stops while
    // Stories is paused (audit M-1).
    const wait = SafeMath.mul(<u64>this.config.get()!.inactivity_days, DAY_SECONDS);
    System.require(
      st.admin_finalize_requested || this.clock() >= SafeMath.add(st.opener_last_active, wait),
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
    const finalizer = requireAddress(args.finalizer, "STORIES: invalid finalizer address");
    const ink = requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_EDITING, "STORIES: story is not in the final edit");
    this.requireFinalizer(st, finalizer);
    const items = args.items;
    System.require(items.length > 0 && items.length <= MAX_BATCH_ITEMS, "STORIES: send 1 to 20 items per batch");

    let units: u64 = 0;
    const now = nowSeconds();
    for (let i = 0; i < items.length; i++) {
      this.skipRemoved(args.story_id, st);
      const item = items[i];
      const next = st.final_cursor + 1;
      System.require(next <= st.segment_count, "STORIES: more items than segments");
      System.require(
        this.skipBudget > 0 || this.segments.get(pairKey(args.story_id, next))!.status != stories.segment_status.SEGMENT_REMOVED,
        "STORIES: a long run of removed text is next; call advance_final_cursor first"
      );
      System.require(item.seq == next, "STORIES: items must be in order, starting at the next unprocessed segment");
      const key = pairKey(args.story_id, next);
      const seg = this.segments.get(key)!;
      const oldCost = seg.current_cost;
      let refund: u64 = 0;
      let mint: u64 = 0;
      let removed = false;
      System.require(
        !seg.hidden || item.mode == stories.final_mode.FINAL_REMOVED,
        "STORIES: a hidden part can only be removed in the final edit (or unhidden first)"
      );

      if (item.mode == stories.final_mode.FINAL_UNCHANGED) {
        seg.surviving = oldCost < seg.charged ? oldCost : seg.charged;
      } else if (item.mode == stories.final_mode.FINAL_EDITED) {
        // A blocked opener may still finish the book, but not change its text (AB-036).
        this.requireNotBlocked(finalizer);
        const text = str(item.text);
        const newCost = <u64>requireText(text, true);
        System.require(newCost == item.expected_cost, "STORIES: Ink cost does not match expected_cost");
        // Light edits only, measured from the part as it is now, so a part
        // others grew can still be trimmed (AB-056).
        System.require(newCost <= SafeMath.add(seg.current_cost, allowance(seg.original_cost)), "STORIES: edit grows the text too much (light edits only)");
        units = SafeMath.add(units, newCost);
        System.require(units <= MAX_BATCH_UNITS, "STORIES: batch text is over 20,000 Ink units");
        refund = cutRefund(seg, newCost);
        const oldText = seg.text != null ? seg.text! : "";
        // Saving the text unchanged changes nothing: no version, no changer (AB-048).
        if (text != oldText) {
          this.keepVersion(args.story_id, next, seg, oldText, VERSION_FINAL, finalizer, text, newCost, now, "", false);
          this.recordChanger(key, seg, finalizer, false);
        }
        seg.text = text;
        if (text != oldText) seg.text_hash = this.newTextHash(args.story_id, next, text);
        seg.current_cost = newCost;
        seg.charged = seg.charged - refund;
        seg.last_edited_by = finalizer;
        seg.last_edited_at = now;
        seg.surviving = newCost < seg.charged ? newCost : seg.charged;
        // The final pass may grow text a little past max_chars (grammar
        // fixes in a full book). Growth stays inside the light-edit allowance.
        st.used_chars = SafeMath.add(SafeMath.sub(st.used_chars, oldCost), newCost);
      } else if (item.mode == stories.final_mode.FINAL_REMOVED) {
        // A blocked finalizer may still clear hidden parts to finish the
        // book, but not remove anyone's visible text (audit F-08).
        if (!seg.hidden) this.requireNotBlocked(finalizer);
        refund = refundable(seg) ? seg.charged : 0;
        if (refund == 0) this.dropTotal(args.story_id, seg.author!, seg.charged);
        this.removePart(args.story_id, next, st, seg, finalizer, now);
        mint = this.settleRefund(args.story_id, st, seg, refund);
        clearSegment(seg, finalizer, now);
        st.used_chars = SafeMath.sub(st.used_chars, oldCost);
        removed = true;
      } else {
        System.require(false, "STORIES: unknown final mode");
      }

      if (!removed) mint = this.settleRefund(args.story_id, st, seg, refund);
      seg.final_mode = item.mode;
      this.segments.put(key, seg);
      this.addSurviving(args.story_id, seg.author!, seg.surviving);
      st.running_hash = foldHash(st.running_hash, next, <u8>item.mode, removed ? new Uint8Array(32) : seg.text_hash!);
      st.final_cursor = next;
      if (item.mode != stories.final_mode.FINAL_UNCHANGED) {
        this.emitChange(args.story_id, next, finalizer, oldCost, seg.current_cost, refund, removed, true, seg.author!);
      }
      if (mint > 0) this.refundInk(ink, seg.author!, mint, args.story_id, next);
    }
    this.skipRemoved(args.story_id, st);
    if (!st.finalizer_is_admin) this.touch(st, finalizer, false);
    this.putStory(args.story_id, st);
    const ev = new stories.final_batch_event(args.story_id, st.final_cursor, st.running_hash);
    System.event("stories.final_batch_event", Protobuf.encode(ev, stories.final_batch_event.encode), [st.opener!]);
    this.leave();
    return new stories.empty_object();
  }

  finalize(args: stories.finalize_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const finalizer = requireAddress(args.finalizer, "STORIES: invalid finalizer address");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_EDITING, "STORIES: story is not in the final edit");
    this.requireFinalizer(st, finalizer);
    this.skipRemoved(args.story_id, st);
    System.require(st.final_cursor == st.segment_count, "STORIES: some segments are not processed yet");
    System.require(st.hidden_count == 0, "STORIES: some parts are hidden while they are checked; unhide or remove them first");
    const uri = str(args.pdf_uri);
    System.require(uri.length >= 1 && uri.length <= MAX_PDF_URI && isPlainAscii(uri), "STORIES: PDF link must be 1 to 200 plain characters");
    const hash = args.pdf_hash;
    System.require(hash != null && hash.length >= MIN_PDF_HASH && hash.length <= MAX_PDF_HASH, "STORIES: PDF hash must be 32 to 64 bytes");

    st.status = stories.story_status.STATUS_FINALIZED;
    st.pdf_uri = uri;
    st.pdf_hash = hash;
    if (!st.finalizer_is_admin) this.touch(st, finalizer, false);
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
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    const ink = requireAddress(this.config.get()!.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: a fund can only be topped up while the story is open");
    System.require(st.visibility != stories.visibility.VISIBILITY_PUBLIC, "STORIES: only private stories have a fund");
    System.require(args.amount > 0, "STORIES: add at least 1 Ink");
    this.touch(st, opener, false);
    this.depositFund(args.story_id, st, opener, args.amount, ink);
    this.leave();
    return new stories.empty_object();
  }

  // Change someone else's part while the story is open: anyone who can
  // write in the story (the opener and editors too) pays for the letters
  // they add and remove, at least 10, times 2. The multiplier doubles with
  // every paid change to the same part (2x, 4x, 8x, ...), up to 60 changes.
  // The changer always pays, never the story's pool. A writer edits their
  // own part with edit_segment, never here. The part stays its writer's.
  // Cutting it refunds the writer only what they (or the pool) paid beyond
  // the new length, never letters someone else paid for; empty text removes
  // the part and refunds what its writer (or the pool) paid. Every version is
  // kept with the changer's citation and AI flag. There are no free changes.
  revise_part(args: stories.revise_part_arguments): stories.uint32 {
    this.enter();
    this.requireNotPaused();
    const writer = requireAddress(args.writer, "STORIES: invalid writer address");
    requireSigner(writer, "STORIES: writer has not authorized this");
    this.requireNotBlocked(writer);
    const cfg = this.config.get()!;
    const ink = requireAddress(cfg.ink, "STORIES: Ink contract is not set");
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: parts can only be changed while the story is open");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(!seg.hidden, "STORIES: a hidden part can't be changed");
    const owner = seg.author!;
    System.require(!Arrays.equal(writer, owner), "STORIES: edit your own part with edit_segment; revise_part is for someone else's part");
    this.requireRightsAndTerms(writer, args.rights_confirmed, args.terms_version, cfg);
    const citation = requireCitation(args.citation);

    const text = str(args.text);
    const removing = text.length == 0;
    const newCost: u64 = removing ? 0 : <u64>requireText(text, true);
    const oldText = seg.text != null ? seg.text! : "";
    System.require(text != oldText, "STORIES: the text is unchanged");
    // The cap stops growth only (audit S2-05).
    System.require(newCost <= <u64>cfg.contribution_cap || newCost <= seg.current_cost, "STORIES: text is over the per-submission cap");

    // What changed: everything between the common start and the common end.
    let pre = 0;
    const maxPre = min<i32>(oldText.length, text.length);
    while (pre < maxPre && oldText.charCodeAt(pre) == text.charCodeAt(pre)) pre++;
    // Never split an emoji (a surrogate pair) between "same" and "changed".
    if (pre > 0 && ((pre < oldText.length && isLowSurrogate(oldText.charCodeAt(pre))) ||
      (pre < text.length && isLowSurrogate(text.charCodeAt(pre))))) pre--;
    let suf = 0;
    const maxSuf = min<i32>(oldText.length, text.length) - pre;
    while (suf < maxSuf && oldText.charCodeAt(oldText.length - 1 - suf) == text.charCodeAt(text.length - 1 - suf)) suf++;
    if (suf > 0 && (isLowSurrogate(oldText.charCodeAt(oldText.length - suf)) || isLowSurrogate(text.charCodeAt(text.length - suf)))) suf--;
    const removed = <u64>(oldText.length - pre - suf);
    const added = <u64>(text.length - pre - suf);

    // MAX_VERSIONS always has room for every paid change, whatever the
    // writer's own edits did (AB-047).
    const changes: u32 = seg.paid_changes;
    System.require(changes < MAX_PAID_CHANGES, "STORIES: changing this part again would cost more Ink than exists");
    const units = removed + added < MIN_CHANGE_UNITS ? MIN_CHANGE_UNITS : removed + added;
    const price = SafeMath.mul(units, (<u64>1) << (<u64>changes + 1));
    System.require(args.expected_ink == price, "STORIES: the change price does not match expected_ink (2x the letters added and removed, at least 10, doubling each time)");
    this.checkWriter(args.story_id, st, writer, added, cfg);

    const now = nowSeconds();
    const oldCost = seg.current_cost;
    const nextUsed = SafeMath.add(SafeMath.sub(st.used_chars, oldCost), newCost);
    if (newCost > oldCost) System.require(nextUsed <= st.max_chars, "STORIES: not enough space left in this story");

    // Removing the part refunds what its writer (or the pool) paid for their
    // own letters (charged never holds letters others added). A cut refunds
    // only what they paid beyond the new length (AB-035, AB-044). A part whose
    // checker hide was undone gives nothing back either way, so a paid removal
    // can't return a refund the writer gave up (AB-068).
    const refund = removing ? (seg.refund_forfeited ? 0 : seg.charged) : cutRefund(seg, newCost);
    // Without a refund the writer's total still loses the part (AB-057).
    if (removing && refund == 0) this.dropTotal(args.story_id, owner, seg.charged);
    const version = this.keepVersion(args.story_id, args.seq, seg, oldText,
      removing ? VERSION_REMOVED : VERSION_CHANGED, writer, text, newCost, now, citation, args.ai_assisted);
    this.recordChanger(key, seg, writer, false);
    seg.paid_changes = changes + 1;
    const mint = this.settleRefund(args.story_id, st, seg, refund);

    // The changer always pays; the pool pays only for new parts.
    st.total_burned = SafeMath.add(st.total_burned, price);

    if (removing) {
      this.dropLivePart(args.story_id, seg);
      clearSegment(seg, writer, now);
    } else {
      // The changer's added words count toward their part of the story.
      // Changing a part doesn't make it theirs: a current writer owns a live
      // part (AB-066).
      const totalKey = idAddrKey(args.story_id, writer);
      const total = this.contributorTotals.get(totalKey);
      if (total == null) {
        st.contributor_count = st.contributor_count + 1;
        this.contributorTotals.put(totalKey, new stories.uint64(added));
      } else {
        total.value = SafeMath.add(total.value, added);
        this.contributorTotals.put(totalKey, total);
      }
      const count = this.authorCount.get(writer)!;
      this.authorList.put(addrIdxKey(writer, count.value), new stories.segment_ref(args.story_id, args.seq));
      count.value = count.value + 1;
      this.authorCount.put(writer, count);
      seg.charged = seg.charged - refund;
      seg.text = text;
      seg.text_hash = this.newTextHash(args.story_id, args.seq, text);
      seg.current_cost = newCost;
      seg.last_edited_by = writer;
      seg.last_edited_at = now;
      // The changer's AI-assisted words make the part AI-assisted (AB-039).
      // The copy checker's source note stays: only the admin or moderator sets it.
      if (args.ai_assisted) seg.ai_assisted = true;
    }
    this.segments.put(key, seg);
    st.used_chars = nextUsed;
    this.touch(st, writer, true);
    this.maybeAutoLock(args.story_id, st, writer);
    this.putStory(args.story_id, st);
    const ev = new stories.revise_event(args.story_id, args.seq, writer, removing ? VERSION_REMOVED : VERSION_CHANGED, version, price, owner, refund);
    System.event("stories.revise_event", Protobuf.encode(ev, stories.revise_event.encode), [writer, owner]);
    const burn = new stories.ink_burn_call(writer, price, BURN_CONTRIBUTION, "c:" + args.story_id.toString() + ":" + args.seq.toString());
    this.callOut(ink, INK_BURN_ENTRY, Protobuf.encode(burn, stories.ink_burn_call.encode), [writer], "STORIES: Ink burn failed");
    if (mint > 0) this.refundInk(ink, owner, mint, args.story_id, args.seq);
    this.leave();
    return new stories.uint32(version);
  }

  // ===================================================================
  // Suggestions (Wave 2): propose a change, the part's writer decides
  // ===================================================================

  suggest_change(args: stories.suggest_change_arguments): stories.uint32 {
    this.enter();
    this.requireNotPaused();
    const proposer = requireAddress(args.proposer, "STORIES: invalid address");
    requireSigner(proposer, "STORIES: proposer has not authorized this");
    this.requireNotBlocked(proposer);
    const cfg = this.config.get()!;
    const st = this.requireStory(args.story_id);
    System.require(st.status == stories.story_status.STATUS_OPEN, "STORIES: changes can only be suggested while the story is open");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(!seg.hidden, "STORIES: a hidden part can't be changed while it is checked");
    System.require(!Arrays.equal(proposer, seg.author!), "STORIES: this is your own part; edit it instead of suggesting");
    // Whoever may write here may suggest (no Ink is used now).
    this.checkWriter(args.story_id, st, proposer, 0, cfg);
    this.requireRightsAndTerms(proposer, args.rights_confirmed, args.terms_version, cfg);
    const citation = requireCitation(args.citation);
    const text = str(args.text);
    const cost = <u64>requireText(text, true);
    System.require(cost <= <u64>cfg.contribution_cap || cost <= seg.current_cost, "STORIES: text is over the per-submission cap");
    System.require(text != (seg.text != null ? seg.text! : ""), "STORIES: the text is unchanged");
    System.require(seg.pending_suggestions < MAX_PENDING_SUGGESTIONS, "STORIES: this part already has 5 suggestions waiting for its writer");
    // One waiting suggestion per wallet and part. While looking, find the
    // oldest closed suggestion: once a part keeps MAX_SUGGESTIONS, a new one
    // takes that slot, so suggesting and withdrawing can't use the part up
    // (and a takedown still wipes at most MAX_SUGGESTIONS).
    let reuse: u32 = 0;
    let reuseAt: u64 = u64.MAX_VALUE;
    for (let i: u32 = 1; i <= seg.suggestion_count; i++) {
      const other = this.suggestions.get(versionKey(args.story_id, args.seq, i));
      if (other == null) continue;
      System.require(other.status != SUGGESTION_WAITING || !Arrays.equal(other.proposer!, proposer),
        "STORIES: you already have a suggestion waiting on this part; withdraw it first");
      const closedAt = other.closed_at;
      if (other.status != SUGGESTION_WAITING && closedAt < reuseAt) {
        reuse = i;
        reuseAt = closedAt;
      }
    }
    // pending < 5 and 20 slots: when all 20 are taken, at least 15 are closed.
    const id = seg.suggestion_count < MAX_SUGGESTIONS ? seg.suggestion_count + 1 : reuse;
    System.require(id > 0, "STORIES: this part has no room for another suggestion");
    const hash = seg.text_hash != null ? seg.text_hash! : new Uint8Array(0);
    const sug = new stories.suggestion(id, proposer, text, hash, seg.version_count, citation, args.ai_assisted, nowSeconds(),
      SUGGESTION_WAITING, null, 0, "", cost);
    this.suggestions.put(versionKey(args.story_id, args.seq, id), sug);
    if (id > seg.suggestion_count) seg.suggestion_count = id;
    seg.pending_suggestions = seg.pending_suggestions + 1;
    this.segments.put(key, seg);
    this.emitSuggestion(args.story_id, args.seq, id, proposer, "suggested", proposer, 0, seg.author!);
    this.leave();
    return new stories.uint32(id);
  }

  accept_suggestion(args: stories.accept_suggestion_arguments): stories.uint32 {
    this.enter();
    this.requireNotPaused();
    const writer = requireAddress(args.writer, "STORIES: invalid writer address");
    requireSigner(writer, "STORIES: writer has not authorized this");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(Arrays.equal(writer, seg.author!), "STORIES: only the part's writer may accept a suggestion");
    const sKey = versionKey(args.story_id, args.seq, args.id);
    const found = this.suggestions.get(sKey);
    System.require(found != null, "STORIES: unknown suggestion");
    const sug = found!;
    System.require(sug.status == SUGGESTION_WAITING, "STORIES: that suggestion is no longer waiting");
    // Accepting applies the exact text the proposer wrote to the exact text
    // they saw: if the part changed since, it would undo that change.
    const hash = seg.text_hash != null ? seg.text_hash! : new Uint8Array(0);
    System.require(Arrays.equal(sug.base_hash!, hash) && sug.base_versions == seg.version_count,
      "STORIES: the part changed since this was suggested; ask for a new suggestion");
    // The proposer may have been blocked, or taken off a private story's
    // list of writers, since.
    this.requireNotBlocked(sug.proposer!);
    const st = this.requireStory(args.story_id);
    System.require(st.visibility == stories.visibility.VISIBILITY_PUBLIC || this.isPrivileged(args.story_id, st, sug.proposer!) ||
      this.allowed.get(idAddrKey(args.story_id, sug.proposer!))!.value,
      "STORIES: the person who suggested this is no longer one of this story's writers");
    const text = sug.text != null ? sug.text! : "";
    const version = this.ownEdit(args.story_id, args.seq, writer, text, args.expected_cost, args.max_ink,
      args.rights_confirmed, args.terms_version, VERSION_SUGGESTED, sug.proposer!, sug.citation != null ? sug.citation! : "", sug.ai_assisted,
      sug.proposer);
    sug.status = SUGGESTION_ACCEPTED;
    sug.closed_by = writer;
    sug.closed_at = nowSeconds();
    this.suggestions.put(sKey, sug);
    const after = this.segments.get(key)!;
    after.pending_suggestions = after.pending_suggestions > 0 ? after.pending_suggestions - 1 : 0;
    this.segments.put(key, after);
    this.emitSuggestion(args.story_id, args.seq, args.id, writer, "accepted", sug.proposer!, version, writer);
    this.leave();
    return new stories.uint32(version);
  }

  decline_suggestion(args: stories.decline_suggestion_arguments): stories.empty_object {
    this.enter();
    const account = requireAddress(args.account, "STORIES: invalid address");
    const key = pairKey(args.story_id, args.seq);
    const segFound = this.segments.get(key);
    System.require(segFound != null, "STORIES: unknown segment");
    const seg = segFound!;
    const sKey = versionKey(args.story_id, args.seq, args.id);
    const found = this.suggestions.get(sKey);
    System.require(found != null, "STORIES: unknown suggestion");
    const sug = found!;
    const note = requireNote(args.note);
    let action = "";
    if (args.moderate) {
      // Moderation: works while paused, on any suggestion, and wipes its text.
      this.requireModeratorOrAdmin(account);
      System.require(!sug.cleared, "STORIES: that suggestion was already cleared");
      action = "cleared";
    } else {
      this.requireNotPaused();
      requireSigner(account, "STORIES: account has not authorized this");
      System.require(sug.status == SUGGESTION_WAITING, "STORIES: that suggestion is no longer waiting");
      const st = this.requireStory(args.story_id);
      const hash = seg.text_hash != null ? seg.text_hash! : new Uint8Array(0);
      // Stale: the part changed or is gone, or the story is over. A story
      // that is only locked can reopen after a takedown, so it doesn't count.
      const stale = st.status == stories.story_status.STATUS_FINALIZED || st.status == stories.story_status.STATUS_ARCHIVED ||
        seg.status != stories.segment_status.SEGMENT_ACTIVE || !Arrays.equal(sug.base_hash!, hash) || sug.base_versions != seg.version_count;
      if (Arrays.equal(account, seg.author!)) action = "declined";
      else if (Arrays.equal(account, sug.proposer!)) action = "withdrawn";
      else {
        System.require(stale, "STORIES: only the part's writer or the person who suggested it may close this suggestion");
        action = "closed";
      }
    }
    const wasWaiting = sug.status == SUGGESTION_WAITING;
    if (action == "cleared") {
      // An accepted or declined suggestion keeps its status; a waiting one is closed.
      if (wasWaiting) sug.status = SUGGESTION_CLEARED;
      sug.text = "";
      sug.cleared = true;
      sug.note = note;
    } else {
      sug.status = action == "withdrawn" ? SUGGESTION_WITHDRAWN : SUGGESTION_DECLINED;
      sug.note = action == "declined" ? note : "";
    }
    sug.closed_by = account;
    sug.closed_at = nowSeconds();
    this.suggestions.put(sKey, sug);
    if (wasWaiting && seg.pending_suggestions > 0) {
      seg.pending_suggestions = seg.pending_suggestions - 1;
      this.segments.put(key, seg);
    }
    this.emitSuggestion(args.story_id, args.seq, args.id, account, action, sug.proposer!, 0, seg.author!);
    this.leave();
    return new stories.empty_object();
  }

  get_suggestions(args: stories.get_suggestions_arguments): stories.suggestion_list {
    const out = new stories.suggestion_list();
    const seg = this.segments.get(pairKey(args.story_id, args.seq));
    if (seg == null || seg.taken_down) return out;
    const limit = args.count == 0 || args.count > MAX_SUGGESTION_READ ? MAX_SUGGESTION_READ : args.count;
    let id: u32 = args.from == 0 ? 1 : args.from;
    let bytes: i32 = 0;
    for (let n: u32 = 0; n < limit && id <= seg.suggestion_count; n++) {
      const found = this.suggestions.get(versionKey(args.story_id, args.seq, id));
      if (found != null) {
        const size = utf8(found.text != null ? found.text! : "");
        if (out.values.length > 0 && bytes + size > MAX_VERSION_READ_BYTES) break;
        bytes += size;
        out.values.push(found);
      }
      id++;
    }
    out.next = id <= seg.suggestion_count ? id : 0;
    return out;
  }

  private emitSuggestion(storyId: u64, seq: u64, id: u32, by: Uint8Array, action: string, proposer: Uint8Array, version: u32,
    author: Uint8Array): void {
    const ev = new stories.suggestion_event(storyId, seq, id, by, action, proposer, version);
    System.event("stories.suggestion_event", Protobuf.encode(ev, stories.suggestion_event.encode), [proposer, author]);
  }

  // ===================================================================
  // The story guide (Wave 2): notes, who the story is looking for, blind round
  // ===================================================================

  set_story_guide(args: stories.set_story_guide_arguments): stories.empty_object {
    this.enter();
    const account = requireAddress(args.account, "STORIES: invalid address");
    const st = this.requireStory(args.story_id);
    const notes = str(args.notes);
    const wanted = str(args.wanted);
    let blind = args.blind;
    if (notes.length == 0 && wanted.length == 0 && this.isModeratorOrAdmin(account)) {
      // Moderation: clear the notes and the wanted line, even while paused.
      // The blind round is the opener's choice and stays as it is.
      this.requireModeratorOrAdmin(account);
      blind = st.blind;
    } else {
      this.requireNotPaused();
      requireSigner(account, "STORIES: account has not authorized this");
      this.requireNotBlocked(account);
      System.require(st.status == stories.story_status.STATUS_OPEN || st.status == stories.story_status.STATUS_LOCKED ||
        st.status == stories.story_status.STATUS_EDITING, "STORIES: the guide can't change once the story is finished or archived");
      System.require(this.isPrivileged(args.story_id, st, account), "STORIES: only the opener or an editor may change the story guide");
      System.require(args.blind == st.blind || Arrays.equal(account, st.opener!), "STORIES: only the opener may switch the blind round on or off");
    }
    System.require(notes.length <= MAX_NOTES, "STORIES: the notes must be at most 3,000 characters");
    System.require(wanted.length <= MAX_WANTED, "STORIES: the looking-for line must be at most 140 characters");
    if (notes.length > 0) requireText(notes, false);
    if (wanted.length > 0) requireText(wanted, false);
    st.notes = notes;
    st.wanted = wanted;
    st.blind = blind;
    st.guide_by = account;
    st.guide_at = nowSeconds();
    this.putStory(args.story_id, st);
    const ev = new stories.guide_event(args.story_id, account, notes, wanted, blind);
    System.event("stories.guide_event", Protobuf.encode(ev, stories.guide_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  // "The story so far": the opener, an editor, or a current writer of the
  // story keeps a short summary up to date while the story is being written.
  // The admin or the moderator may clear it at any time, even while paused
  // (AB-034).
  set_story_summary(args: stories.set_story_summary_arguments): stories.empty_object {
    this.enter();
    const account = requireAddress(args.account, "STORIES: invalid address");
    const st = this.requireStory(args.story_id);
    const summary = str(args.summary);
    if (summary.length == 0 && this.isModeratorOrAdmin(account)) {
      this.requireModeratorOrAdmin(account);
    } else {
      this.requireNotPaused();
      requireSigner(account, "STORIES: account has not authorized this");
      this.requireNotBlocked(account);
      System.require(
        st.status != stories.story_status.STATUS_FINALIZED && st.status != stories.story_status.STATUS_ARCHIVED,
        "STORIES: the summary can't change once the story is finalized or archived"
      );
      // Writers count only while a part they wrote is still in the story
      // (changing someone else's part doesn't count, AB-066) and, in a
      // private story, while they are still on its allow-list (AB-034).
      const key = idAddrKey(args.story_id, account);
      const writes = this.liveParts.get(key)!.value > 0;
      const member = st.visibility == stories.visibility.VISIBILITY_PUBLIC || this.allowed.get(key)!.value;
      System.require(
        this.isPrivileged(args.story_id, st, account) || (writes && member),
        "STORIES: only the opener, an editor or a current writer of this story may update its summary"
      );
    }
    System.require(summary.length <= MAX_SUMMARY, "STORIES: the summary must be at most 1,500 characters");
    if (summary.length > 0) requireText(summary, false);
    st.summary = summary;
    st.summary_by = account;
    st.summary_at = nowSeconds();
    this.putStory(args.story_id, st);
    const ev = new stories.summary_event(args.story_id, account, summary);
    System.event("stories.summary_event", Protobuf.encode(ev, stories.summary_event.encode), [account]);
    this.leave();
    return new stories.empty_object();
  }

  // A reader saves their place (bookmark) so it follows their wallet. Anyone
  // may read any story, so any wallet may save a place in any existing story.
  set_reading_place(args: stories.set_reading_place_arguments): stories.empty_object {
    // No lock (it calls nothing out), but the direct-call rule still holds
    // (AB-020), and like every user write it waits out a pause.
    this.requireDirectCall();
    this.requireNotPaused();
    const reader = requireAddress(args.reader, "STORIES: invalid address");
    requireSigner(reader, "STORIES: reader has not authorized this");
    const st = this.requireStory(args.story_id);
    System.require(args.seq <= st.segment_count, "STORIES: unknown segment");
    System.require(args.percent <= 100, "STORIES: percent must be 0 to 100");
    const key = idAddrKey(args.story_id, reader);
    const existing = this.readingPlace.get(key);
    if (existing == null) {
      // First place in this story: add it to the reader's list.
      const count = this.readingCount.get(reader)!;
      this.readingList.put(addrIdxKey(reader, count.value), new stories.uint64(args.story_id));
      count.value = count.value + 1;
      this.readingCount.put(reader, count);
    }
    this.readingPlace.put(key, new stories.reading_place(args.story_id, args.seq, args.chapter, args.percent, nowSeconds()));
    return new stories.empty_object();
  }

  // The part's writer, the opener or an editor sets the part's citation:
  // what it quotes. The copy checker leaves cited quotes alone, so a
  // citation by anyone but the writer counts as a change to the part: the
  // admin can strike them on a takedown (AB-038). Setting the citation it
  // already has changes nothing and records no one (AB-048). A blocked wallet
  // may only clear a citation (AB-046), and so may a writer taken off a
  // private story's list (audit L-1, as for edit_segment, M-4). Citations on
  // hidden parts stay allowed: they are the writer's appeal against a hide.
  set_citation(args: stories.set_citation_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const account = requireAddress(args.account, "STORIES: invalid address");
    requireSigner(account, "STORIES: account has not authorized this");
    const st = this.requireStory(args.story_id);
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(Arrays.equal(account, seg.author!) || this.isPrivileged(args.story_id, st, account),
      "STORIES: only the part's writer, the opener or an editor may do this");
    const citation = requireCitation(args.citation);
    if (citation.length > 0) {
      this.requireNotBlocked(account);
      this.requireMember(args.story_id, st, account);
    }
    const before = seg.citation != null ? seg.citation! : "";
    if (citation != before) this.recordChanger(key, seg, account, !Arrays.equal(account, st.opener!));
    seg.citation = citation;
    this.segments.put(key, seg);
    const ev = new stories.citation_event(args.story_id, args.seq, account, citation, false);
    System.event("stories.citation_event", Protobuf.encode(ev, stories.citation_event.encode), [seg.author!]);
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
    // Both its text and its opener must have been quiet for the archive
    // period, so a story its opener still manages stays open (audit S2-06),
    // measured on the activity clock, which stops while paused (audit M-1).
    const wait = SafeMath.mul(<u64>this.config.get()!.archive_days, DAY_SECONDS);
    const clock = this.clock();
    System.require(clock >= SafeMath.add(st.last_activity_at, wait) && clock >= SafeMath.add(st.opener_last_active, wait),
      "STORIES: story has been active recently");
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
    const opener = requireAddress(args.opener, "STORIES: invalid opener address");
    requireSigner(opener, "STORIES: opener has not authorized this");
    this.requireNotBlocked(opener);   // audit F-09
    const st = this.requireStory(args.story_id);
    this.requireOpener(st, opener);
    System.require(st.status == stories.story_status.STATUS_ARCHIVED, "STORIES: story is not archived");
    System.require(!st.revived, "STORIES: the free revive was already used");
    const cfg = this.config.get()!;
    const open = this.openCount.get(opener)!;
    System.require(open.value < cfg.open_limit, "STORIES: you already have the maximum number of open projects");
    // Free only while a new project would cost the normal price, so archiving
    // and reviving can't skip the price doubling (audit S2-03).
    System.require(openMultiplier(open.value, cfg) == 1,
      "STORIES: reviving is free only while your next project would be at the normal price; finish or archive another one first");
    open.value = open.value + 1;
    this.openCount.put(opener, open);
    st.status = stories.story_status.STATUS_OPEN;
    st.revived = true;
    this.touch(st, opener, true);
    this.putStory(args.story_id, st);
    this.emitStatus(args.story_id, st.status, "revived", opener);
    this.leave();
    return new stories.empty_object();
  }
}
