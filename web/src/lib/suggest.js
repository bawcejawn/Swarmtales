/**
 * Suggested changes (Wave 2), the rules the page needs without a browser.
 * The contract holds the same rules; these only decide what to offer.
 */

export const MAX_PENDING_SUGGESTIONS = 5;
export const MAX_SUGGESTIONS = 20;
export const SUGGESTION_STATUS = ["waiting", "accepted", "declined", "withdrawn", "removed by moderation"];

/** Is this suggestion still based on the part as it is now? (Otherwise accepting would undo a later change.) */
export function isCurrent(sug, segment) {
  return String(sug.base_hash || "") === String(segment.text_hash || "") && Number(sug.base_versions || 0) === Number(segment.version_count || 0);
}

/** What each person may do with a waiting suggestion: accept, decline, withdraw or close. */
export function suggestionActions(sug, segment, me, storyOpen) {
  if (Number(sug.status) !== 0 || !storyOpen || !me) return [];
  const current = isCurrent(sug, segment);
  const out = [];
  if (me === segment.author && current) out.push("accept");
  if (me === segment.author) out.push("decline");
  else if (me === sug.proposer) out.push("withdraw");
  else if (!current) out.push("close");
  return out;
}
