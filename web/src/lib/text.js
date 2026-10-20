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
export const BOOK_MIN = 100000;
export const BOOK_MAX = 1000000;

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

/**
 * Tidy pasted text so it passes the Stories rules: Windows line endings
 * and tabs become plain line breaks and spaces, and runs of more than
 * three line breaks shrink to two.
 */
export function normalizePasted(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{4,}/g, "\n\n");
}

export const MAX_PARTS_PER_SIGNATURE = 10;

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Cut `text` at most `max` units long without splitting an emoji, preferring a space. */
function cutAt(text, max) {
  if (text.length <= max) return [text, ""];
  let at = text.lastIndexOf(" ", max);
  if (at < max * 0.5) at = max;
  if (isHighSurrogate(text.charCodeAt(at - 1))) at -= 1;
  return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()];
}

/** Pieces no longer than `cap`: whole paragraphs, else sentences, else words. */
function pieces(text, cap) {
  const out = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= cap) {
      out.push({ text: p, joiner: "\n\n" });
      continue;
    }
    const sentences = p.match(/[^.!?…]+(?:[.!?…]+["”’)\]]*)?\s*/g) || [p];
    let first = true;
    for (const raw of sentences) {
      let s = raw.trim();
      while (s.length > cap) {
        const [head, rest] = cutAt(s, cap);
        out.push({ text: head, joiner: first ? "\n\n" : " " });
        first = false;
        s = rest;
      }
      if (s) {
        out.push({ text: s, joiner: first ? "\n\n" : " " });
        first = false;
      }
    }
  }
  return out;
}

/**
 * Split text that is longer than the per-part cap into parts the contract
 * accepts: each at most `cap` units and at least `min` (the last part may
 * be shorter only if `lastMayBeShort`). Breaks fall between paragraphs when
 * possible, then between sentences, then between words.
 * Returns an array of strings. Text within the cap comes back as one part.
 */
export function splitIntoParts(value, cap, min, lastMayBeShort) {
  const text = normalizePasted(value).trim();
  const limit = Math.max(1, Number(cap) || 1);
  const minimum = Math.max(0, Number(min) || 0);
  if (!text) return [];
  if (text.length <= limit) return [text];
  const parts = [];
  let current = "";
  for (const piece of pieces(text, limit)) {
    const joined = current ? current + piece.joiner + piece.text : piece.text;
    if (joined.length <= limit) {
      current = joined;
    } else {
      parts.push(current);
      current = piece.text;
    }
  }
  if (current) parts.push(current);
  // A short last part joins the one before it if they fit together;
  // otherwise it borrows words from the end of the one before.
  const last = parts.length - 1;
  if (last > 0 && parts[last].length < minimum && !lastMayBeShort) {
    const merged = parts[last - 1] + "\n\n" + parts[last];
    if (merged.length <= limit) {
      parts.splice(last - 1, 2, merged);
    } else {
      let prev = parts[last - 1];
      let tail = parts[last];
      while (tail.length < minimum) {
        const at = prev.lastIndexOf(" ");
        if (at <= 0) break;
        tail = prev.slice(at + 1) + " " + tail;
        prev = prev.slice(0, at);
      }
      if (tail.length < minimum) {
        // No spaces left to break at: borrow characters, never half an emoji.
        let at = prev.length - (minimum - tail.length);
        if (at > 0 && isHighSurrogate(prev.charCodeAt(at - 1))) at -= 1;
        tail = prev.slice(at) + tail;
        prev = prev.slice(0, at);
      }
      parts[last - 1] = prev;
      parts[last] = tail;
    }
  }
  return parts;
}
