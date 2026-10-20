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
export const DUPLICATE_RATIO = 0.8;      // hide: at least 80% of a part matches one other part
export const DUPLICATE_NOTE_RATIO = 0.5; // note only: half or more matches
export const PHRASE_WORDS = 12;
export const WEB_MIN_CHARS = 400;        // only longer parts are searched outside SwarmTales
export const PHRASES = 5;                // phrases searched per part
export const HIDE_FOUND = 4;             // hide: at least 4 of the 5 phrases found...
export const HIDE_SAME_SOURCE = 3;       // ...and at least 3 of them in the same book or site
export const NOTE_FOUND = 2;             // note only: 2 or more found
export const WEB_MATCHES_TO_HIDE = HIDE_FOUND; // kept for older callers
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
    this.parts = new Map(); // key -> { author, hashes, at }
  }

  static fromJSON(obj) {
    const idx = new Index();
    for (const [key, entry] of Object.entries(obj || {})) idx.add(key, entry.author, entry.hashes, entry.at);
    return idx;
  }

  toJSON() {
    const out = {};
    for (const [key, entry] of this.parts) out[key] = entry;
    return out;
  }

  /** `at`: when the part was written (segment.created_at); 0 if unknown. */
  add(key, author, hashes, at = 0) {
    this.parts.set(key, { author, hashes, at: Number(at) || 0 });
    for (const h of hashes) {
      let set = this.byHash.get(h);
      if (!set) this.byHash.set(h, (set = new Set()));
      set.add(key);
    }
  }

  /**
   * The other part that shares the most fingerprint with `hashes`, ignoring
   * parts by `author` (a writer may reuse their own words). With `at`, only
   * parts written earlier count (AB-005): the later of two matching parts is
   * the copy, so the original is never flagged for a copy made after it.
   * Entries saved before `at` was kept count as earlier.
   */
  bestMatch(hashes, author, exceptKey, at) {
    const counts = new Map();
    const order = at ? partOrder(exceptKey, at) : null;
    for (const h of hashes) {
      const keys = this.byHash.get(h);
      if (!keys) continue;
      for (const key of keys) {
        if (key === exceptKey) continue;
        const entry = this.parts.get(key);
        if (!entry || entry.author === author) continue;
        if (order && entry.at && compareOrder(partOrder(key, entry.at), order) > 0) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    let best = null;
    for (const [key, shared] of counts) if (!best || shared > best.shared) best = { key, shared };
    if (!best) return null;
    return { key: best.key, shared: best.shared, ratio: hashes.length ? best.shared / hashes.length : 0 };
  }
}

function partOrder(key, at) {
  const [story, seq] = String(key).split(":").map(Number);
  return [Number(at) || 0, story || 0, seq || 0];
}

function compareOrder(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The order a run checks parts in (AB-005): oldest first by when they were
 * written (`at`, the segment's created_at), then story, then part. A copy is
 * always checked after the text it copied, whatever the story numbers, and
 * each story's parts stay in part order.
 * stories: [{ id, parts: [{ seq, at, ... }] }] -> [{ story, seq, at, ... }]
 */
export function checkOrder(stories) {
  const out = [];
  for (const s of stories) for (const p of s.parts) out.push({ story: s.id, ...p });
  return out.sort((a, b) => compareOrder(partOrder(a.story + ":" + a.seq, a.at), partOrder(b.story + ":" + b.seq, b.at)));
}

/** Is a match strong enough to hide the newer part automatically? */
export function isDuplicate(hashes, match) {
  return !!match && hashes.length >= MIN_SHINGLES && match.shared >= MIN_SHINGLES && match.ratio >= DUPLICATE_RATIO;
}

/** Strong enough for a public note ("much of this also appears in…"), but not to hide? */
export function isPartialDuplicate(hashes, match) {
  return !!match && hashes.length >= MIN_SHINGLES && match.shared >= MIN_SHINGLES &&
    match.ratio >= DUPLICATE_NOTE_RATIO && match.ratio < DUPLICATE_RATIO;
}

/**
 * Does the writer's citation name this source? Most of the source's
 * meaningful words (title, author) must appear in the citation.
 * source: { title, author } or a website host.
 */
export function citationCovers(citation, source) {
  const have = new Set(words(citation));
  if (!have.size || !source) return false;
  if (typeof source === "string") {
    const host = source.toLowerCase().replace(/^www\./, "");
    return String(citation).toLowerCase().includes(host) || words(host.split(".")[0]).every((w) => have.has(w));
  }
  const title = words(source.title || "").filter((w) => !STOPWORDS.has(w));
  const author = words(source.author || "").filter((w) => w.length > 2);
  const titleHits = title.filter((w) => have.has(w)).length;
  const authorHit = author.some((w) => have.has(w));
  if (title.length && titleHits / title.length >= 0.6) return true;
  return authorHit && titleHits >= 1;
}

/**
 * What to do with a part, given where each searched phrase was found.
 * found: one entry per phrase: a source key (book or site) or null.
 * Returns { action: "hide" | "note" | "none", source, found, same }.
 *   hide: HIDE_FOUND or more phrases found, HIDE_SAME_SOURCE or more in one source
 *   note: NOTE_FOUND or more found (shown under the part; nothing is hidden)
 */
export function decide(found) {
  const hits = found.filter(Boolean);
  const counts = new Map();
  for (const key of hits) counts.set(key, (counts.get(key) || 0) + 1);
  let source = null;
  let same = 0;
  for (const [key, n] of counts) if (n > same) { source = key; same = n; }
  if (hits.length >= HIDE_FOUND && same >= HIDE_SAME_SOURCE) return { action: "hide", source, found: hits.length, same };
  if (hits.length >= NOTE_FOUND) return { action: "note", source, found: hits.length, same };
  return { action: "none", source, found: hits.length, same };
}

/** Can more searches still change the outcome? (Saves the free search budget.) */
export function worthAsking(foundSoFar, asked, total) {
  return foundSoFar + (total - asked) >= NOTE_FOUND;
}

/**
 * Up to 3 distinctive phrases of about 12 words, taken from the start,
 * middle and end of a part, in its original spelling, for an exact web search.
 */
export function pickPhrases(text, count = PHRASES) {
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

/**
 * Monthly search budget per search service, kept in the checker's state.
 * name "search" is the original (Brave) budget, kept for older state files.
 */
export function budget(state, now, monthlyLimit, name = "search") {
  const month = now.toISOString().slice(0, 7);
  if (!state[name] || state[name].month !== month) state[name] = { month, used: 0 };
  return {
    left: () => Math.max(0, monthlyLimit - state[name].used),
    spend: () => { state[name].used += 1; },
  };
}

/**
 * Turn one search service's answer into [{ url, title, description }],
 * the shape resultMatches() reads.
 *   books:  Google Books API volumes search (searches inside the books)
 *   tavily: Tavily web search
 *   brave:  Brave web search
 */
export function normalizeResults(service, body) {
  const b = body || {};
  if (service === "books") {
    return (b.items || []).map((item) => {
      const info = item.volumeInfo || {};
      const by = (info.authors || []).join(", ");
      return {
        url: info.infoLink || info.canonicalVolumeLink || ("https://books.google.com/books?id=" + encodeURIComponent(item.id || "")),
        title: info.title || "",
        description: String((item.searchInfo && item.searchInfo.textSnippet) || ""),
        label: "\u201c" + (info.title || "untitled") + "\u201d" + (by ? " by " + by : ""),
        source: { title: info.title || "", author: by },
      };
    });
  }
  if (service === "tavily") {
    return (b.results || []).map((r) => ({ url: r.url || "", title: r.title || "", description: r.content || "" }));
  }
  return ((b.web && b.web.results) || []).map((r) => ({ url: r.url || "", title: r.title || "", description: r.description || "" }));
}
