/**
 * SwarmTales copy checker: the pure parts (no network), so they can be tested.
 *
 * Text fingerprints: every run of 8 words is hashed (FNV-1a, 32 bits).
 * About half of the hashes are kept (those with an even value). Both sides
 * keep the same half, so comparing the kept sets estimates how much of a
 * part also appears in another part, without storing whole texts.
 */

export const SHINGLE_WORDS = 8;
export const MIN_SHINGLES = 6;           // parts with fewer kept hashes are too short to judge
export const DUPLICATE_RATIO = 0.5;      // at least half of a part matches one other part
export const PHRASE_WORDS = 12;
export const WEB_MIN_CHARS = 300;        // only longer parts are checked on the web
export const WEB_MATCHES_TO_HIDE = 2;    // of 3 phrases
export const REASON = { COPYRIGHT: 1, DUPLICATE: 2 };

const STOPWORDS = new Set((
  "a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our " +
  "she so that the their them then there they this to was we were what when which who will with you your " +
  "said says just like all one out up down over very can could would should do did does been than too"
).split(" "));

export function words(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The kept fingerprint hashes of a text, as a sorted array of unique numbers. */
export function fingerprint(text) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + SHINGLE_WORDS <= w.length; i++) {
    const h = fnv1a(w.slice(i, i + SHINGLE_WORDS).join(" "));
    if ((h & 1) === 0) out.add(h);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** An inverted index: hash -> set of part keys ("story:seq"). */
export class Index {
  constructor() {
    this.byHash = new Map();
    this.parts = new Map(); // key -> { author, hashes }
  }

  static fromJSON(obj) {
    const idx = new Index();
    for (const [key, entry] of Object.entries(obj || {})) idx.add(key, entry.author, entry.hashes);
    return idx;
  }

  toJSON() {
    const out = {};
    for (const [key, entry] of this.parts) out[key] = entry;
    return out;
  }

  add(key, author, hashes) {
    this.parts.set(key, { author, hashes });
    for (const h of hashes) {
      let set = this.byHash.get(h);
      if (!set) this.byHash.set(h, (set = new Set()));
      set.add(key);
    }
  }

  /**
   * The other part that shares the most fingerprint with `hashes`, ignoring
   * parts by `author` (a writer may reuse their own words).
   */
  bestMatch(hashes, author, exceptKey) {
    const counts = new Map();
    for (const h of hashes) {
      const keys = this.byHash.get(h);
      if (!keys) continue;
      for (const key of keys) {
        if (key === exceptKey) continue;
        const entry = this.parts.get(key);
        if (!entry || entry.author === author) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    let best = null;
    for (const [key, shared] of counts) if (!best || shared > best.shared) best = { key, shared };
    if (!best) return null;
    return { key: best.key, shared: best.shared, ratio: hashes.length ? best.shared / hashes.length : 0 };
  }
}

/** Is a match strong enough to hide the newer part automatically? */
export function isDuplicate(hashes, match) {
  return !!match && hashes.length >= MIN_SHINGLES && match.shared >= MIN_SHINGLES && match.ratio >= DUPLICATE_RATIO;
}

/**
 * Up to 3 distinctive phrases of about 12 words, taken from the start,
 * middle and end of a part, in its original spelling, for an exact web search.
 */
export function pickPhrases(text, count = 3) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim().split(" ");
  if (raw.length < PHRASE_WORDS + 4) return [];
  const spots = count === 1 ? [0.5] : Array.from({ length: count }, (_, i) => 0.15 + (0.7 * i) / (count - 1));
  const out = [];
  for (const spot of spots) {
    let start = Math.min(raw.length - PHRASE_WORDS, Math.max(0, Math.floor(raw.length * spot) - PHRASE_WORDS / 2));
    const phrase = raw.slice(start, start + PHRASE_WORDS)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter(Boolean);
    const plain = phrase.map((w) => w.toLowerCase());
    const meaningful = plain.filter((w) => !STOPWORDS.has(w) && w.length > 2);
    if (phrase.length >= PHRASE_WORDS - 2 && meaningful.length >= 4) out.push(phrase.join(" "));
  }
  return Array.from(new Set(out));
}

/**
 * Did one web result really contain the phrase? Most of the phrase's words
 * must appear in the result's title or snippet, and the result must not be
 * SwarmTales itself.
 */
export function resultMatches(phrase, result, ignoreHosts) {
  let host = "";
  try {
    host = new URL(result.url).host.toLowerCase();
  } catch {
    return false;
  }
  if ((ignoreHosts || []).some((h) => host === h || host.endsWith("." + h))) return false;
  const want = words(phrase);
  const have = new Set(words(String(result.title || "") + " " + String(result.description || "").replace(/<[^>]+>/g, " ")));
  const found = want.filter((w) => have.has(w)).length;
  return want.length > 0 && found / want.length >= 0.7;
}

/** Monthly search budget, kept in the checker's state. */
export function budget(state, now, monthlyLimit) {
  const month = now.toISOString().slice(0, 7);
  if (!state.search || state.search.month !== month) state.search = { month, used: 0 };
  return {
    left: () => Math.max(0, monthlyLimit - state.search.used),
    spend: () => { state.search.used += 1; },
  };
}
