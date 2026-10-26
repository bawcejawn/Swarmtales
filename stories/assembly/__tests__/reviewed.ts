// Shared by the specs (not a spec itself). Builds arguments the way the
// website and the deploy tool do after the 2026-10 audit:
//   - a takedown names the text_hash and version_count the admin reviewed;
//   - an own-part edit carries the rights confirmation and the current Terms.
import { Stories } from "../Stories";
import { stories } from "../proto/stories";

export function reviewedTakedown(
  storyId: u64, seq: u64, reason: stories.moderation_reason, note: string | null,
  strike: Uint8Array | null = null, noStrike: bool = false
): stories.takedown_segment_arguments {
  const seg = new Stories().get_segment(new stories.get_segment_arguments(storyId, seq));
  return new stories.takedown_segment_arguments(storyId, seq, reason, note, strike, noStrike, seg.text_hash, seg.version_count);
}

export function ownEditArgs(
  editor: Uint8Array | null, storyId: u64, seq: u64, text: string | null, expectedCost: u64, maxInk: u64 = 0
): stories.edit_segment_arguments {
  const terms = new Stories().get_config(new stories.get_config_arguments()).terms_version;
  return new stories.edit_segment_arguments(editor, storyId, seq, text, expectedCost, maxInk, true, terms);
}
