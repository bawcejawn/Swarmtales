/**
 * SwarmTales copy checker: the pure parts (no network), so they can be tested.
 *
 * Text fingerprints: every run of 8 words is hashed (FNV-1a, 32 bits).
 * About half of the hashes are kept (those with an even value). Both sides
 * keep the same half, so comparing the kept sets estimates how much of a
 * part also appears in another part, without storing whole texts.
 */

import { createHash } from "crypto";

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
export const REASON = { COPYRIGHT: 1, DUPLICATE: 2 };
export const NOTE_MAX = 200;             // the contract's limit for notes, in UTF-16 units

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

/** A short key for a text, to notice when a part's text or citation changes (AB-067). */
export function textKey(text) {
  return createHash("sha256").update(String(text || "")).digest("base64").slice(0, 16);
}

/**
 * When a part's text last changed: its last edit, or when it was added
 * (segment times are wall-clock seconds).
 */
export function textAt(seg) {
  const created = Number(seg.created_at || 0);
  const edited = Number(seg.last_edited_at || 0);
  return edited > created ? edited : created;
}

/**
 * When one hash of an indexed part was first written: `newer` holds the hashes
 * a later edit or change added, each with its own time; every other hash is as
 * old as the entry's `at` (AB-076).
 */
export function dateOf(entry, h) {
  return (entry.newer && entry.newer[h]) || entry.at || 0;
}

/** `at` as a function of a hash: a part's own dated hashes, or one time for all of them. */
function datesOf(at) {
  return typeof at === "function" ? at : () => Number(at) || 0;
}

/** An inverted index: hash -> set of part keys ("story:seq"). */
export class Index {
  constructor() {
    this.byHash = new Map();
    this.parts = new Map(); // key -> { author, hashes, at, newer?, copyOf?, skip? }
  }

  static fromJSON(obj) {
    const idx = new Index();
    for (const [key, entry] of Object.entries(obj || {})) {
      idx.add(key, entry.author, entry.hashes, entry.at, entry.copyOf, { newer: entry.newer, skip: entry.skip });
    }
    return idx;
  }

  toJSON() {
    const out = {};
    for (const [key, entry] of this.parts) out[key] = entry;
    return out;
  }

  /**
   * `at`: when the text was first written (segment.created_at for a part
   * nobody edited); 0 if unknown. `newer`: hash -> time, for the hashes a
   * later edit or change added (AB-076). Adding a key again replaces its text.
   * `copyOf`: the part this one was found to copy, when it is indexed anyway
   * (its opener restored it); that part is never flagged for matching it.
   * `skip`: kept only to remember when its words were written (a copy, or a
   * part with a source note): never matched against.
   */
  add(key, author, hashes, at = 0, copyOf = undefined, { newer = undefined, skip = false } = {}) {
    this.remove(key);
    const entry = { author, hashes, at: Number(at) || 0 };
    if (newer && Object.keys(newer).length) entry.newer = newer;
    if (copyOf) entry.copyOf = copyOf;
    if (skip) entry.skip = true;
    this.parts.set(key, entry);
    if (skip) return;
    for (const h of hashes) {
      let set = this.byHash.get(h);
      if (!set) this.byHash.set(h, (set = new Set()));
      set.add(key);
    }
  }

  remove(key) {
    const old = this.parts.get(key);
    if (!old) return;
    for (const h of old.hashes) {
      const set = this.byHash.get(h);
      if (!set) continue;
      set.delete(key);
      if (!set.size) this.byHash.delete(h);
    }
    this.parts.delete(key);
  }

  /**
   * The other part that shares the most fingerprint with `hashes`, ignoring
   * parts by `author` (a writer may reuse their own words). With `at`, only
   * words written earlier count (AB-005): the later of two matching texts is
   * the copy, so the original is never flagged for a copy made after it. Each
   * shared hash is dated on both sides (AB-076), so an edit elsewhere in a
   * part never makes its older words look new. `at` is a time, or a function
   * giving the time of each of `hashes`. Words with the same time do not
   * count either (AB-024): see tieMatch. A word with no known time on
   * either side never counts: an unknown date can't prove who was first.
   */
  bestMatch(hashes, author, exceptKey, at) {
    const mine = datesOf(at);
    return this.match(hashes, author, exceptKey, (entry, h) => {
      const m = mine(h);
      const theirs = dateOf(entry, h);
      return !!m && !!theirs && theirs < m;
    });
  }

  /**
   * The best match among words written at the same time as this part's (same
   * block or second, AB-024). Nobody can tell which came first, so such a
   * match only ever gets a source note on both parts, never a hide.
   */
  tieMatch(hashes, author, exceptKey, at) {
    const mine = datesOf(at);
    return this.match(hashes, author, exceptKey, (entry, h) => {
      const m = mine(h);
      return !!m && dateOf(entry, h) === m;
    });
  }

  match(hashes, author, exceptKey, include) {
    const counts = new Map();
    for (const h of hashes) {
      const keys = this.byHash.get(h);
      if (!keys) continue;
      for (const key of keys) {
        if (key === exceptKey) continue;
        const entry = this.parts.get(key);
        if (!entry || entry.skip || entry.author === author || entry.copyOf === exceptKey || !include(entry, h)) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    let best = null;
    for (const [key, shared] of counts) if (!best || shared > best.shared) best = { key, shared };
    if (!best) return null;
    const at = this.parts.get(best.key).at;
    return { key: best.key, shared: best.shared, ratio: hashes.length ? best.shared / hashes.length : 0, at };
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

/** Monthly search budget per search service, kept in the checker's state. */
export function budget(state, now, monthlyLimit, name) {
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
    return (Array.isArray(b.items) ? b.items : []).map((item) => {
      const info = (item && item.volumeInfo) || {};
      const title = String(info.title || "");
      const by = (Array.isArray(info.authors) ? info.authors : []).map(String).join(", ");
      // Shown on-chain in a note: cleaned to the contract's text rules and kept short (O1-08).
      const shortTitle = cleanNote(title, "untitled", 90);
      const shortBy = cleanNote(by, "", 60);
      return {
        kind: "book",
        url: String(info.infoLink || info.canonicalVolumeLink || ("https://books.google.com/books?id=" + encodeURIComponent(String(item.id || "")))),
        title,
        description: String((item.searchInfo && item.searchInfo.textSnippet) || ""),
        label: "\u201c" + shortTitle + "\u201d" + (shortBy ? " by " + shortBy : ""),
        source: { title, author: by },
        published: String(info.publishedDate || ""),
      };
    });
  }
  const list = service === "tavily" ? b.results : b.web && b.web.results;
  return (Array.isArray(list) ? list : []).map((r) => ({ kind: "web", url: String(r.url || ""), title: String(r.title || ""),
    description: String((service === "tavily" ? r.content : r.description) || "") }));
}

// ---------------------------------------------------------------- dates (M-11)

/**
 * The first second after the period a Google Books publishedDate names
 * ("2011", "2011-09" or "2011-09-13", read as UTC; negative before 1970),
 * or null when it can't be read.
 */
export function publishedEnd(date) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(date || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 12;
  const d = m[3] ? Number(m[3]) : 1;
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const end = m[3] ? Date.UTC(y, mo - 1, d + 1) : Date.UTC(y, mo, 1);
  return Math.floor(end / 1000);
}

/**
 * Was a book provably published before a part was written? Its whole
 * publication period, plus a day for time zones, must end before the part's
 * created_at. An unknown date on either side proves nothing.
 */
export function provablyOlder(published, partSeconds) {
  const end = publishedEnd(published);
  const part = Number(partSeconds) || 0;
  return end !== null && part > 0 && end + 86400 <= part;
}

// ---------------------------------------------------------------- on-chain notes (O1-08)

// What Stories' requireText refuses in a note, besides control characters:
// invisible and direction-control characters, lone surrogates and U+FFFD.
const FORBIDDEN = /[\u200B\uFEFF\u2028\u2029\u2060-\u2064\u202A-\u202E\u2066-\u2069\uFFFD]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// Characters requireText doesn't count as visible.
const NOT_VISIBLE = /^[\u0020\u00A0\u3000\u2000-\u200A\u200C\u200D\uFE0E\uFE0F]*$/;

/**
 * Text made safe for a Stories note (set_segment_hidden, set_source_note):
 * one line, no control, invisible or direction-control characters, no
 * broken characters, at most `max` UTF-16 units (cut at a whole character,
 * with "…"), and at least one visible character. Text left with nothing
 * visible becomes `fallback` (cleaned the same way; "" if there is none),
 * so a note can never make the chain refuse a hide every hour.
 */
export function cleanNote(text, fallback = "", max = NOTE_MAX) {
  let s = String(text ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(FORBIDDEN, "")
    .replace(LONE_SURROGATE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) {
    s = s.slice(0, max - 1);
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
    s = s.trimEnd() + "\u2026";
  }
  if (!s || NOT_VISIBLE.test(s)) return fallback ? cleanNote(fallback, "", max) : "";
  return s;
}

/** The contract's note rule (Stories.ts requireNote/requireText), for tests and a last check before signing. */
export function noteAllowed(s) {
  s = String(s);
  if (s.length > NOTE_MAX) return false;
  if (!s.length) return true;
  let visible = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
      visible = true;
      continue;
    }
    if ((c >= 0xdc00 && c <= 0xdfff) || c === 0xfffd) return false;
    if (c === 0x200b || c === 0xfeff || c === 0x2028 || c === 0x2029 || (c >= 0x2060 && c <= 0x2064) ||
        (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (!(c === 0x20 || c === 0xa0 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a) || c === 0x200c || c === 0x200d ||
          c === 0xfe0e || c === 0xfe0f)) visible = true;
  }
  return visible;
}

// ---------------------------------------------------------------- run summary (Info)

/**
 * Text for one cell of the GitHub run summary table: one line, and every
 * character Markdown or HTML could act on escaped, so a citation or book
 * title can't add links, images, HTML or break the table.
 */
export function mdCell(text) {
  return cleanNote(text, "", 300).replace(/[\\`*_{}[\]()<>#+\-.!|~&"']/g, (c) => "\\" + c);
}

/** A fenced code block that no line of `text` can close (CommonMark: a longer fence). */
export function mdFence(text) {
  const runs = String(text).match(/`+/g) || [];
  const fence = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return fence + "\n" + text + "\n" + fence + "\n";
}

/**
 * A log line made safe for the Actions log and summary: user text (titles,
 * citations) can't start a new line, so it can never form a "::command::".
 */
export function logLine(text) {
  return String(text).replace(/[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029]+/g, " ");
}

// ---------------------------------------------------------------- reading parts (M-5)

/**
 * Parts from..to of a story, in order, as [{ seq, seg }]. Reads `perRead`
 * parts per get_segments call and goes on from the result's `next`; a page
 * stops early when its text is long (the contract's byte budget). If a
 * page read fails (a node's read limit, say), those parts are read one at
 * a time with get_segment. A part that can't be read even alone throws, so
 * the story is retried next run and never marked done past it.
 */
export async function readParts(read, storyId, from, to, perRead = 3) {
  const out = [];
  const id = String(storyId);
  let start = from;
  while (start <= to) {
    let page = null;
    try {
      page = await read("get_segments", { story_id: id, start: String(start), limit: perRead });
    } catch {
      page = null;
    }
    const values = page && Array.isArray(page.values) ? page.values : [];
    if (!values.length) {
      out.push({ seq: start, seg: (await read("get_segment", { story_id: id, seq: String(start) })) || {} });
      start += 1;
      continue;
    }
    values.forEach((seg, i) => { if (start + i <= to) out.push({ seq: start + i, seg: seg || {} }); });
    const after = start + values.length;
    const next = Number(page.next || 0);
    // Parts come back in order from `start`, so `next` is the part after the
    // last one returned (0: the story ends there). Anything else would skip
    // or repeat parts: stop and retry the story next run.
    if (next !== 0 && next !== after) throw new Error("get_segments returned next " + next + " after parts " + start + " to " + (after - 1));
    start = after;
  }
  return out;
}

// ---------------------------------------------------------------- what a sent action changes

/**
 * Records in the state what a planned action did once the chain accepted
 * it (only then: AB-061). A hide becomes the checker's own, so a citation
 * naming its source can lift it; an unhide on a citation is kept as "cited",
 * so clearing the citation hides it again (AB-067).
 */
export function recordSent(state, action) {
  const key = action.story + ":" + action.seq;
  state.hiddenByChecker = state.hiddenByChecker || {};
  state.seen = state.seen || {};
  if (action.kind === "hide") {
    state.hiddenByChecker[key] = { source: action.src || null, label: action.label || "", t: action.t };
  } else if (action.kind === "unhide") {
    delete state.hiddenByChecker[key];
    const seen = state.seen[key];
    state.seen[key] = { reason: REASON.COPYRIGHT, why: "copied text from " + (action.label || "a source"),
      note: action.label ? "Parts of this text also appear in " + action.label + "." : "",
      ...(seen || {}), v: "cited", c: undefined, src: action.src || null, label: action.label || "" };
  }
}

// Chain ids of the nodes the checker knows (the same as deploy/lib.js).
const KNOWN_CHAINS = {
  "https://testnet.koinosfoundation.org": "EiAIKVvm6-V2qmsmUvPJy09vCCLbtn9lHFpwrJbcTIEWRQ==",
  "https://api.koinos.io": "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==",
  "https://koinos.armana.io": "EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA==",
};

/**
 * The chain id the moderator key may sign for (AB-015): EXPECTED_CHAIN_ID if
 * set, else the known id for the node. Any other node must say which chain
 * it serves, so a swapped RPC variable can't make the key sign elsewhere.
 */
export function expectedChainId(rpc, fromEnv) {
  const set = String(fromEnv || "").trim();
  if (set) return set;
  const known = KNOWN_CHAINS[String(rpc || "").replace(/\/+$/, "")];
  if (!known) throw new Error("Set EXPECTED_CHAIN_ID for the node at " + rpc + " (the chain id it serves).");
  return known;
}

/** Stop before anything is signed if the node serves another chain. */
export function checkChainId(expected, actual) {
  if (actual !== expected) {
    throw new Error("The node's chain id is " + actual + " but the checker expects " + expected + ". Nothing was signed.");
  }
}
