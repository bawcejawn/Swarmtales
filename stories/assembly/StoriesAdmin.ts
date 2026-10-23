// Stories entry points for moderation and the admin settings.
import { System, Protobuf, SafeMath, Arrays } from "@koinos/sdk-as";
import { stories } from "./proto/stories";
import { HIDDEN_BY_REPORTS, HIDDEN_BY_MODERATOR, HIDDEN_BY_ADMIN, ADDRESS_LENGTH, MAX_CATEGORY_NAME, MAX_CATEGORIES, MIN_CONTRIBUTION_MAX, MAX_PDF_URI, MIN_PDF_HASH, MAX_PDF_HASH, MAX_TERMS_URI, TERMS_HASH_LENGTH, REPORT_THRESHOLD_MAX, STRIKE_LIMIT_MAX, CAP_MIN, CAP_MAX, TRIAL_MAX, DEFAULT_FULL_PRICE_PROJECTS, DEFAULT_MAX_PRICE_MULTIPLIER, MAX_PRICE_MULTIPLIER, OPEN_LIMIT_MIN, OPEN_LIMIT_MAX, ARCHIVE_DAYS_MIN, INACTIVITY_DAYS_MIN, DAYS_MAX } from "./lib/constants";
import { u32Key, join, pairKey, versionKey, idAddrKey, reportKey } from "./lib/keys";
import { str, requireTextIn, isPlainAscii, requireAddress, requireNote } from "./lib/text";
import { reportThreshold, clearSegment, nowSeconds, requireSigner } from "./lib/rules";
import { StoriesBase } from "./StoriesBase";

export class StoriesAdmin extends StoriesBase {

  // ===================================================================
  // Moderation
  // ===================================================================

  // Admin or moderator hides or unhides a live part, at any stage. Works
  // while paused, so moderation never waits for an unpause.
  set_segment_hidden(args: stories.set_segment_hidden_arguments): stories.empty_object {
    this.enter();
    const actor = requireAddress(args.actor, "STORIES: invalid address");
    this.requireModeratorOrAdmin(actor);
    const st = this.requireStory(args.story_id);
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    const note = requireNote(args.note);
    const byAdmin = Arrays.equal(actor, this.getAdmin());
    if (args.hidden) {
      // The admin may take over a hide the checker or reports made, in place:
      // the part is never visible or refundable in between (AB-062). The
      // moderator (the copy checker) may take over a hide writer reports
      // made, once it finds the part copied: removing it then refunds nothing
      // and restoring it forfeits the refund, as if the checker had hidden it
      // first (AB-071).
      System.require(!seg.hidden || (byAdmin ? seg.hidden_by != HIDDEN_BY_ADMIN : seg.hidden_by == HIDDEN_BY_REPORTS), "STORIES: part is already hidden");
      System.require(args.reason != stories.moderation_reason.REASON_UNSPECIFIED, "STORIES: give a reason");
      if (!seg.hidden) st.hidden_count = st.hidden_count + 1;
      seg.hidden = true;
      seg.hidden_by = byAdmin ? HIDDEN_BY_ADMIN : HIDDEN_BY_MODERATOR;
      seg.moderation_reason = args.reason;
    } else {
      System.require(seg.hidden, "STORIES: part is not hidden");
      // The moderator key is the copy checker's: it never undoes the admin's
      // hide (AB-061).
      System.require(seg.hidden_by != HIDDEN_BY_ADMIN || byAdmin, "STORIES: the admin hid this part; only the admin can unhide it");
      seg.hidden = false;
      seg.hidden_by = 0;
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

  // Admin or moderator (the copy checker) notes where parts of a text also
  // appear. Shown under the part; it does not hide anything.
  set_source_note(args: stories.set_source_note_arguments): stories.empty_object {
    this.enter();
    const actor = requireAddress(args.actor, "STORIES: invalid address");
    this.requireModeratorOrAdmin(actor);
    this.requireStory(args.story_id);
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    const note = requireNote(args.note);
    seg.source_note = note;
    this.segments.put(key, seg);
    const ev = new stories.citation_event(args.story_id, args.seq, actor, note, true);
    System.event("stories.citation_event", Protobuf.encode(ev, stories.citation_event.encode), [seg.author!]);
    this.leave();
    return new stories.empty_object();
  }

  // The story's opener or an editor brings back a hidden part (the checker or
  // writer reports hid it). A part the admin hid stays hidden until the admin
  // unhides it, so an opener who wrote it cannot restore it and remove it for
  // a refund (AB-053, AB-061). Restoring a part the checker hid gives up its
  // refund: cutting or removing it later gives no Ink back (AB-062). A part
  // taken down stays removed.
  restore_segment(args: stories.restore_segment_arguments): stories.empty_object {
    this.enter();
    this.requireNotPaused();
    const actor = requireAddress(args.actor, "STORIES: invalid address");
    requireSigner(actor, "STORIES: actor has not authorized this");
    this.requireNotBlocked(actor);
    const st = this.requireStory(args.story_id);
    System.require(this.isPrivileged(args.story_id, st, actor), "STORIES: only the opener or an editor may do this");
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: a finalized story cannot be changed");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(seg.hidden, "STORIES: part is not hidden");
    System.require(seg.hidden_by == HIDDEN_BY_REPORTS || seg.hidden_by == HIDDEN_BY_MODERATOR,
      "STORIES: the admin hid this part; only the admin can unhide it");
    const note = requireNote(args.note);
    if (seg.hidden_by == HIDDEN_BY_MODERATOR) seg.refund_forfeited = true;
    seg.hidden = false;
    seg.hidden_by = 0;
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
    const key = pairKey(args.story_id, args.seq);
    const found = this.segments.get(key);
    System.require(found != null, "STORIES: unknown segment");
    const seg = found!;
    System.require(!seg.taken_down, "STORIES: part was already taken down");
    System.require(args.reason != stories.moderation_reason.REASON_UNSPECIFIED, "STORIES: give a reason");
    const note = requireNote(args.note);
    const fingerprint = seg.text_hash != null ? seg.text_hash! : new Uint8Array(0);
    // The takedown and its strike are for the text the admin reviewed: if the
    // part changed since, nothing happens (audit Info: bound to a review).
    System.require(args.reviewed_hash != null && Arrays.equal(args.reviewed_hash!, fingerprint) &&
      args.reviewed_versions == seg.version_count, "STORIES: the part changed since you reviewed it; review it again");
    const now = nowSeconds();
    // Who gets the strike (AB-001, AB-028, AB-029). A part nobody else
    // changed strikes its writer. Once anyone else changed it, even with a
    // one-letter fix, a cut or a citation, no rule can tell who made it
    // infringing, so the admin compares the versions and names the writer or
    // a wallet that changed the part, or chooses no strike. Removing a part
    // is not a change of its words, and the writer's own edits don't count.
    // The flags answer this without reading any version text, so a takedown
    // never grows with the versions (AB-059).
    const named = args.strike != null && args.strike!.length > 0;
    System.require(!(named && args.no_strike), "STORIES: name a wallet to strike or choose no strike, not both");
    let struck: Uint8Array = new Uint8Array(0);
    if (named) {
      struck = args.strike!;
      System.require(Arrays.equal(struck, seg.author!) || this.partEditors.get(join(key, struck))!.value,
        "STORIES: strike the part's writer or a wallet that changed it");
    } else if (!args.no_strike) {
      System.require(!seg.edited_by_others && seg.paid_changes == 0,
        "STORIES: someone other than the writer changed this part; name who gets the strike, or choose no strike");
      struck = seg.author!;
    }

    if (seg.status == stories.segment_status.SEGMENT_ACTIVE) {
      const author = seg.author!;
      // The writer's live and surviving totals lose this part; nothing is refunded.
      const totalKey = idAddrKey(args.story_id, author);
      this.dropTotal(args.story_id, author, seg.charged);
      if (seg.surviving > 0) {
        const surv = this.survivingTotals.get(totalKey)!;
        surv.value = surv.value > seg.surviving ? surv.value - seg.surviving : 0;
        this.survivingTotals.put(totalKey, surv);
      }
      if (seg.hidden) this.unhideCount(st);
      st.used_chars = SafeMath.sub(st.used_chars, seg.current_cost);
      this.dropLivePart(args.story_id, seg);
      clearSegment(seg, admin, now);
      seg.hidden = false;
      seg.hidden_by = 0;
      // Already processed by the final edit: record it as removed there too.
      if (args.seq <= st.final_cursor) seg.final_mode = stories.final_mode.FINAL_REMOVED;
      if (st.status == stories.story_status.STATUS_FINALIZED) st.needs_new_pdf = true;
      if (st.status == stories.story_status.STATUS_LOCKED && st.used_chars < st.max_chars) {
        // Space opened up again: the story takes new parts. The archive wait
        // starts now, so nobody can archive it the moment it reopens (AB-051).
        st.status = stories.story_status.STATUS_OPEN;
        st.locked_at = 0;
        st.last_activity_at = this.clock();
        this.emitStatus(args.story_id, st.status, "reopened-after-takedown", admin);
      }
    }
    // A takedown wipes every kept version of the part, live or already
    // removed (AB-032). MAX_VERSIONS bounds this loop.
    for (let v: u32 = 1; v <= seg.version_count; v++) this.versions.remove(versionKey(args.story_id, args.seq, v));
    seg.version_count = 0;
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
    const reporter = requireAddress(args.reporter, "STORIES: invalid reporter address");
    requireSigner(reporter, "STORIES: reporter has not authorized this");
    this.requireNotBlocked(reporter);
    const st = this.requireStory(args.story_id);
    // A finished book can't be restored by its opener, so reports alone must
    // not hide parts of it; they go to the admin off-chain (audit M-3).
    System.require(st.status != stories.story_status.STATUS_FINALIZED, "STORIES: finished books are reported to the SwarmTales team, not on-chain");
    const key = pairKey(args.story_id, args.seq);
    const seg = this.requireActiveSegment(key);
    System.require(!seg.hidden, "STORIES: this part is already hidden while it is checked");
    System.require(!Arrays.equal(reporter, seg.author!), "STORIES: you cannot report your own part");
    System.require(args.reason != stories.moderation_reason.REASON_UNSPECIFIED, "STORIES: give a reason");
    const note = requireNote(args.note);
    const rkey = reportKey(args.story_id, args.seq, reporter);
    System.require(!this.reports.get(rkey)!.value, "STORIES: you already reported this part");
    this.reports.put(rkey, new stories.boole(true));

    const counted = this.authorCount.get(reporter)!.value > 0;
    if (counted) seg.report_count = seg.report_count + 1;
    const ev = new stories.report_event(args.story_id, args.seq, reporter, args.reason, note, counted, seg.report_count);
    System.event("stories.report_event", Protobuf.encode(ev, stories.report_event.encode), [seg.author!]);

    if (counted && seg.report_count >= reportThreshold(this.config.get()!)) {
      seg.hidden = true;
      seg.hidden_by = HIDDEN_BY_REPORTS;
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
    const uri = str(args.pdf_uri);
    System.require(uri.length >= 1 && uri.length <= MAX_PDF_URI && isPlainAscii(uri), "STORIES: PDF link must be 1 to 200 plain characters");
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
  // Admin
  // ===================================================================

  set_addresses(args: stories.set_addresses_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const ink = requireAddress(args.ink, "STORIES: invalid Ink address");
    const shopId = requireAddress(args.shop, "STORIES: invalid Shop address");
    System.require(!Arrays.equal(ink, this.contractId) && !Arrays.equal(shopId, this.contractId), "STORIES: Ink and Shop cannot be the Stories contract");
    System.require(!Arrays.equal(ink, shopId), "STORIES: Ink and Shop must be different contracts");
    const cfg = this.config.get()!;
    // Ink is set once (AB-037). Pointing Stories at another Ink and back
    // would let refunds mint real Ink for burns that happened elsewhere.
    System.require(cfg.ink == null || cfg.ink!.length == 0 || Arrays.equal(cfg.ink!, ink),
      "STORIES: the Ink address is already set and can never be changed");
    // Shop is set once too (AB-050). Stories calls it inside openers' and
    // writers' own signed transactions, so a Shop swapped in by the admin key
    // would act with their signatures. Moving to a new Shop needs a reviewed
    // code upload with the Stories contract key.
    System.require(cfg.shop == null || cfg.shop!.length == 0 || Arrays.equal(cfg.shop!, shopId),
      "STORIES: the Shop address is already set and can never be changed");
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
    System.require(args.contribution_cap >= CAP_MIN && args.contribution_cap <= CAP_MAX, "STORIES: per-submission cap must be 100 to 6000");
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
    const name = str(args.name);
    requireTextIn(name, MAX_CATEGORY_NAME, "STORIES: category name must be 1 to 32 characters");
    const cfg = this.config.get()!;
    const id: u32 = cfg.next_category_id == 0 ? 1 : cfg.next_category_id;
    System.require(id <= MAX_CATEGORIES, "STORIES: too many categories");
    cfg.next_category_id = id + 1;
    this.saveConfig(cfg);
    this.categories.put(u32Key(id), new stories.category(name, true));
    const ev = new stories.category_event(id, name, true);
    System.event("stories.category_event", Protobuf.encode(ev, stories.category_event.encode), []);
    this.leave();
    return new stories.uint32(id);
  }

  set_category_active(args: stories.set_category_active_arguments): stories.empty_object {
    this.enter();
    this.requireAdmin();
    const key = u32Key(args.category_id);
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
    // The inactivity clocks stop while paused (audit M-1): remember when the
    // pause began, and add its length to paused_seconds when it ends.
    const now = nowSeconds();
    if (args.paused && !cfg.paused) cfg.paused_at = now;
    if (!args.paused && cfg.paused) {
      cfg.paused_seconds = SafeMath.add(cfg.paused_seconds, this.pausedNow(cfg, now));
      cfg.paused_at = 0;
    }
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
      requireAddress(mod, "STORIES: invalid moderator address");
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
    const account = requireAddress(args.account, "STORIES: invalid wallet address");
    const note = requireNote(args.note);
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
    const uri = str(args.terms_uri);
    System.require(uri.length >= 1 && uri.length <= MAX_TERMS_URI && isPlainAscii(uri), "STORIES: Terms of Use link must be 1 to 200 plain characters");
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
    const proposed = requireAddress(args.new_admin, "STORIES: invalid admin address");
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
    requireSigner(pending!, "STORIES: only the proposed admin can accept");
    const oldAdmin = this.getAdmin();
    cfg.admin = pending;
    cfg.pending_admin = null;
    this.config.put(cfg);
    const ev = new stories.admin_changed_event(oldAdmin, pending);
    System.event("stories.admin_changed_event", Protobuf.encode(ev, stories.admin_changed_event.encode), [pending!]);
    this.leave();
    return new stories.empty_object();
  }
}
