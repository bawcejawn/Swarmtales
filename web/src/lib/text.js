/**
 * Ink cost and the Stories text rules.
 *
 * Cost is the number of UTF-16 code units, which is JavaScript's string
 * length. A letter is 1. Most emoji are 2. An older emoji such as ⭐ is 1.
 * A skin-tone emoji or a flag is 4. A family such as 👨‍👩‍👧 is 8.
 * Stories counts the same way and refuses the write if expected_ink differs.
 */

export const MAX_NEWLINE_RUN = 3;
export const MAX_TITLE = 100;
export const HARD_SUBMISSION_CAP = 4000;
export const SHORT_MIN = 10000;
export const SHORT_MAX = 99999;

export function inkCost(text) {
  return String(text ?? "").length;
}

function isInvisibleOrDirection(code) {
  return code === 0x200b || code === 0xfeff || code === 0x2028 || code === 0x2029 ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069);
}

function isSpaceLike(code) {
  return code === 0x20 || code === 0xa0 || code === 0x3000 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x200c || code === 0x200d || code === 0xfe0e || code === 0xfe0f;
}

/**
 * Same checks as Stories.requireText. Returns { ok, cost } or { ok:false, reason }.
 * `allowNewline` is true for story text and false for titles.
 */
export function checkStoryText(value, allowNewline) {
  const text = value == null ? "" : String(value);
  const n = text.length;
  if (n === 0) return { ok: false, reason: "The text is empty." };
  let visible = false;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      if (!allowNewline) return { ok: false, reason: "Line breaks are not allowed here." };
      run++;
      if (run > MAX_NEWLINE_RUN) {
        return { ok: false, reason: "Too many line breaks in a row (max 3)." };
      }
      continue;
    }
    run = 0;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
      return { ok: false, reason: "Control characters are not allowed." };
    }
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= n) return { ok: false, reason: "Broken character in text." };
      const d = text.charCodeAt(i + 1);
      if (d < 0xdc00 || d > 0xdfff) return { ok: false, reason: "Broken character in text." };
      i++;
      visible = true;
      continue;
    }
    if ((c >= 0xdc00 && c <= 0xdfff) || c === 0xfffd) {
      return { ok: false, reason: "Broken character in text." };
    }
    if (isInvisibleOrDirection(c)) {
      return { ok: false, reason: "Invisible or direction-control characters are not allowed." };
    }
    if (!isSpaceLike(c)) visible = true;
  }
  if (!visible) return { ok: false, reason: "The text has no visible characters." };
  return { ok: true, cost: n };
}

export function checkTitle(value) {
  const text = value == null ? "" : String(value);
  if (text.length < 1 || text.length > MAX_TITLE) {
    return { ok: false, reason: "The title must be 1 to 100 characters." };
  }
  return checkStoryText(text, false);
}

/** A one-line description of why this text costs what it costs. */
export function costNote(text) {
  const cost = inkCost(text);
  let pairs = 0;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) pairs++;
  }
  if (pairs === 0) return cost + " Ink. Letters and most older symbols cost 1.";
  return cost + " Ink. " + pairs + " of those are emoji halves (most emoji cost 2, a skin tone or flag costs 4, a family costs 8).";
}
