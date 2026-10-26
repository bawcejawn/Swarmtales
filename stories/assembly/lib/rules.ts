// Small rules shared by the entry points. Pure functions, no storage.
import { System, authority, SafeMath } from "@koinos/sdk-as";
import { stories } from "../proto/stories";
import { HIDDEN_BY_REPORTS, BOOK_MIN, BOOK_MAX, SHORT_MIN, SHORT_MAX, POEM_MIN, POEM_MAX, CLOSE_SLACK, POEM_CLOSE_SLACK, MAX_LIST, DEFAULT_MIN_CONTRIBUTION, DEFAULT_REPORT_THRESHOLD, DEFAULT_FULL_PRICE_PROJECTS, DEFAULT_MAX_PRICE_MULTIPLIER, MAX_PRICE_MULTIPLIER } from "./constants";
import { str } from "./text";

// Free growth for a light edit: 10% of the original, or up to 20 for
// short text, but never more than doubling. Fixed per segment and added
// to the part's live length; the final edit touches each part once, so it
// cannot stack.
export function allowance(original: u64): u64 {
  const tenth = original / 10;
  const small = original < 20 ? original : 20;
  return tenth > small ? tenth : small;
}

/** The smallest length a story of this kind may be closed at. */
export function kindMin(kind: stories.story_kind): u64 {
  if (kind == stories.story_kind.KIND_BOOK) return BOOK_MIN;
  if (kind == stories.story_kind.KIND_POEM) return POEM_MIN;
  return SHORT_MIN;
}

/** The largest size a story of this kind may have. */
export function kindMax(kind: stories.story_kind): u64 {
  if (kind == stories.story_kind.KIND_BOOK) return BOOK_MAX;
  if (kind == stories.story_kind.KIND_POEM) return POEM_MAX;
  return SHORT_MAX;
}

export function isKnownKind(kind: stories.story_kind): bool {
  return kind == stories.story_kind.KIND_BOOK || kind == stories.story_kind.KIND_SHORT || kind == stories.story_kind.KIND_POEM;
}

export function closeReady(st: stories.story): bool {
  const slack = st.kind == stories.story_kind.KIND_POEM ? POEM_CLOSE_SLACK : CLOSE_SLACK;
  return st.used_chars >= kindMin(st.kind) || SafeMath.add(st.used_chars, slack) >= st.max_chars;
}

export function minContribution(cfg: stories.config): u64 {
  return cfg.min_contribution == 0 ? <u64>DEFAULT_MIN_CONTRIBUTION : <u64>cfg.min_contribution;
}

// ===================================================================
// Story fund helpers
// ===================================================================
// 1 for the first few open projects, then 2, 4, 8... up to the ceiling.
export function openMultiplier(openNow: u32, cfg: stories.config): u32 {
  const full = cfg.full_price_projects == 0 ? DEFAULT_FULL_PRICE_PROJECTS : cfg.full_price_projects;
  if (openNow < full) return 1;
  const ceiling = cfg.max_price_multiplier == 0 ? DEFAULT_MAX_PRICE_MULTIPLIER : cfg.max_price_multiplier;
  const steps = openNow - full + 1;
  const doubled: u32 = steps >= 10 ? MAX_PRICE_MULTIPLIER : (<u32>1) << steps;
  return doubled < ceiling ? doubled : ceiling;
}

export function reportThreshold(cfg: stories.config): u32 {
  return cfg.report_threshold == 0 ? DEFAULT_REPORT_THRESHOLD : cfg.report_threshold;
}

export function listLimit(limit: u32): u32 {
  return limit == 0 || limit > MAX_LIST ? MAX_LIST : limit;
}

// Unlisted was merged into Private (October 2026).
export function requireVisibility(v: stories.visibility): void {
  System.require(v == stories.visibility.VISIBILITY_PUBLIC || v == stories.visibility.VISIBILITY_PRIVATE,
    "STORIES: visibility must be Public or Private");
}

// A private story's writers' pool must at least cover a story long enough
// to close.
export function requirePool(kind: stories.story_kind, fund: u64): void {
  const msg = kind == stories.story_kind.KIND_BOOK
    ? "STORIES: a private Book needs a writers' pool of at least 100,000 Ink"
    : kind == stories.story_kind.KIND_POEM
      ? "STORIES: a private Poem needs a writers' pool of at least 50 Ink"
      : "STORIES: a private Short Story needs a writers' pool of at least 10,000 Ink";
  System.require(fund >= kindMin(kind), msg);
}

// Ink refunded when a part gets shorter. `charged` is what the writer (or
// the pool) paid for the part and has not had back; letters others added
// with revise_part are never in it. A cut below that refunds the
// difference, so nobody gets back more than they paid (AB-035), and a cut
// after someone else's change still returns the writer's own Ink, so
// trimming and growing back never charges twice (AB-044). A part whose
// checker hide its opener or an editor undid gives nothing back (AB-062).
export function cutRefund(seg: stories.segment, newCost: u64): u64 {
  if (seg.refund_forfeited) return 0;
  return seg.charged > newCost ? seg.charged - newCost : 0;
}

// Removing a part refunds it unless the admin or the moderator hid it.
// Writer reports alone never cost the writer their Ink (AB-012). If the
// checker unhides its own hide, the part is refundable again; if the opener
// or an editor restored it instead, it never is (AB-062).
export function refundable(seg: stories.segment): bool {
  return (!seg.hidden || seg.hidden_by == HIDDEN_BY_REPORTS) && !seg.refund_forfeited;
}

export function clearSegment(seg: stories.segment, by: Uint8Array, now: u64): void {
  seg.text = "";
  seg.citation = "";
  seg.source_note = "";
  seg.charged = 0;
  seg.own_paid = 0;
  seg.current_cost = 0;
  seg.surviving = 0;
  seg.status = stories.segment_status.SEGMENT_REMOVED;
  seg.last_edited_by = by;
  seg.last_edited_at = now;
}

// ===================================================================
// Small helpers
// ===================================================================
export function nowSeconds(): u64 {
  // head_block_time is in milliseconds.
  return System.getHeadInfo().head_block_time / 1000;
}

export function requireSigner(account: Uint8Array, message: string): void {
  System.require(System.checkAuthority(authority.authorization_type.contract_call, account), message);
}

// ===================================================================
// Calls out
// ===================================================================
// Field 1, wire type 0, value 0: the protobuf encoding of `bool value = false`.
export function resultIsFalse(raw: Uint8Array): bool {
  return raw.length >= 2 && raw[0] == 8 && raw[1] == 0;
}
